import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryOrderRepository } from '../modules/orders/src/adapters/in-memory-order-repository.js';
import { createOrderService } from '../modules/orders/src/application/order-service.js';

const OWNER = { id: 'seller-1', kind: 'human', capabilities: [] };
const OTHER = { id: 'seller-2', kind: 'human', capabilities: [] };

function setup() {
  const repository = new InMemoryOrderRepository();
  const names = new Map([['contact-1', 'Cliente Sintético']]);
  let sequence = 0;
  const service = createOrderService({
    authorizeOwnership: async () => undefined,
    authorizeManualOwnership: async ({ actor, ownerId }) => {
      if (actor.id !== ownerId) {
        throw Object.assign(new Error('not owner'), {
          statusCode: 403,
          code: 'FORBIDDEN',
        });
      }
    },
    conversations: {
      readContactNames: async (ids) =>
        new Map(
          ids
            .filter((id) => names.has(id))
            .map((id) => [id, names.get(id) ?? null]),
        ),
      readOrderContexts: async () => new Map(),
      searchContactIds: async () => ['contact-1'],
      searchConversationIds: async () => [],
    },
    fabCode: '01',
    idFactory: () => `manual-order-${++sequence}`,
    repository,
  });
  return { names, repository, service };
}

/**
 * @param {ReturnType<typeof setup>['service']} service
 * @param {string} key
 * @param {typeof OWNER} [actor]
 * @param {string} [contactId]
 */
function create(service, key, actor = OWNER, contactId = 'contact-1') {
  return service.createForContact({
    actor,
    contactId,
    correlationId: `correlation-${key}`,
    idempotencyKey: key,
  });
}

test('manual orders are independent drafts for the same contact and retry is stable', async () => {
  const { repository, service } = setup();
  const [first, second] = await Promise.all([
    create(service, 'request-1'),
    create(service, 'request-2'),
  ]);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.number, second.number);
  assert.equal(first.conversationId, null);
  assert.equal(first.contactId, 'contact-1');
  assert.equal(first.manualOwnerId, OWNER.id);
  assert.equal(first.status, 'pendente');
  assert.equal(first.ficha.summary.cliente, 'Cliente Sintético');
  assert.equal((await create(service, 'request-1')).id, first.id);
  const concurrent = await Promise.all([
    create(service, 'request-concurrent'),
    create(service, 'request-concurrent'),
  ]);
  assert.equal(concurrent[0].id, concurrent[1].id);
  assert.equal((await repository.list({ limit: 10 })).counts.pendente, 3);
});

test('manual draft follows contact name and refuses unknown contact or another owner', async () => {
  const { names, service } = setup();
  await assert.rejects(create(service, 'missing', OWNER, 'unknown'), {
    code: 'CONTACT_NOT_FOUND',
  });
  const created = await create(service, 'request-1');
  names.set('contact-1', 'Nome Corrigido');
  assert.equal(
    (await service.get(created.id)).ficha.summary.cliente,
    'Nome Corrigido',
  );
  await assert.rejects(
    service.patchSection({
      actor: OTHER,
      correlationId: 'correlation-edit',
      expectedVersion: created.version,
      orderId: created.id,
      section: 'summary',
      value: { data_entrega_confirmada: '2026-10-24', nome: 'Evento' },
    }),
    { code: 'FORBIDDEN' },
  );
});
