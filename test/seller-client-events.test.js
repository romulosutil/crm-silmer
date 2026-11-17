import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationReadService } from '../apps/api/src/operation-runtime.js';

test('WAP-E03: Contact events reauthorize each reader and replay after portfolio revocation', async () => {
  let allowed = true;
  const readers = /** @type {string[]} */ ([]);
  const service = createOperationReadService({
    cursorKey: Buffer.alloc(32, 1),
    inboxRepository: {},
    handoffRepository: {},
    contactRepository: {
      async get(/** @type {string} */ id, /** @type {any} */ reader) {
        assert.equal(id, 'contact-common');
        readers.push(reader.visibilityActorId);
        if (!allowed || reader.visibilityActorId !== 'seller-a')
          throw Object.assign(new Error('CONTACT_NOT_FOUND'), {
            statusCode: 404,
          });
        return { contact: { id } };
      },
    },
  });
  const event = {
    cursor: 42,
    type: 'inbox.contact.changed',
    payload: { contactId: 'contact-common' },
  };
  const a = { id: 'seller-a', capabilities: [] };
  assert.deepEqual(await service.eventForReader(event, a), event);
  const reset = { cursor: 42, type: 'stream.reset', payload: {} };
  assert.deepEqual(
    await service.eventForReader(event, { id: 'seller-b', capabilities: [] }),
    reset,
  );
  allowed = false;
  assert.deepEqual(await service.eventForReader(event, a), reset);
  assert.deepEqual(readers, ['seller-a', 'seller-b', 'seller-a']);
  assert.doesNotMatch(JSON.stringify(reset), /contact-common|seller-a/u);
});
