import assert from 'node:assert/strict';
import test from 'node:test';

import { createSubjectService } from '../modules/inbox-channels/src/application/subject-service.js';

const seller = { id: 'seller-1', kind: 'human', functionName: 'Vendedor' };
const command = {
  actor: seller,
  conversationId: 'conversation-1',
  correlationId: 'correlation-1',
  idempotencyKey: 'command-1',
  orderId: 'order-from-another-contact',
};

function serviceWith(/** @type {{closed?: boolean}} */ options = {}) {
  /** @type {string[]} */
  const queries = [];
  const database = {
    /** @param {string} sql */
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM crm.subject_commands')) return { rows: [] };
      if (sql.includes('FROM crm.conversations')) {
        return {
          rows: [
            {
              assigned_user_id: seller.id,
              contact_id: 'contact-1',
              contact_identity_id: 'identity-1',
              terminal_at: options.closed ? new Date() : null,
            },
          ],
        };
      }
      if (sql.includes('FROM crm.orders')) return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    /** @param {(client: any) => Promise<any>} work */
    async transaction(work) {
      return work(database);
    },
  };
  return { service: createSubjectService(database), queries };
}

test('subject commands reject a different contact before any subject or audit write', async () => {
  const { service, queries } = serviceWith();
  await assert.rejects(service.create(command), {
    code: 'ORDER_CONTACT_MISMATCH',
  });
  assert.equal(
    queries.some((sql) => sql.includes('INSERT INTO')),
    false,
  );
});

test('subject commands require the conversation owner and an open cycle', async () => {
  const wrongOwner = serviceWith();
  await assert.rejects(
    wrongOwner.service.create({
      ...command,
      actor: { ...seller, id: 'another-seller' },
    }),
    { code: 'FORBIDDEN' },
  );
  assert.equal(
    wrongOwner.queries.some((sql) => sql.includes('FROM crm.orders')),
    false,
  );

  const closed = serviceWith({ closed: true });
  await assert.rejects(closed.service.create(command), {
    code: 'CONVERSATION_CLOSED',
  });
});
