import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PostgresInboxRepository } from '../modules/inbox-channels/src/adapters/postgres-inbox-repository.js';
import test from 'node:test';
import { createSubjectApiRuntime } from '../apps/api/src/subject-runtime.js';
import { createConversationHandoffRuntime } from '../apps/api/src/conversation-handoff-runtime.js';
import { PostgresOrderAssistanceRepository } from '../modules/inbox-channels/src/adapters/postgres-order-assistance.js';

const seller = {
  id: 'seller',
  kind: 'human',
  functionName: 'Vendedor',
  capabilities: [],
};
const admin = { ...seller, id: 'admin', capabilities: ['COMMERCIAL_ADMIN'] };

/** Model the current database actor, independently of the request projection.
 * @param {string} sql @param {any} actor */
function actorRows(sql, actor) {
  if (sql.includes('FROM crm.users'))
    return { rows: [{ id: actor.id, disabled_at: actor.disabledAt ?? null }] };
  if (sql.includes('FROM crm.user_functions'))
    return { rows: [{ function_name: actor.functionName }] };
  if (sql.includes('FROM crm.user_capabilities'))
    return {
      rows: actor.capabilities.includes('COMMERCIAL_ADMIN') ? [{}] : [],
    };
  return null;
}

/** @param {string|null|undefined} owner @param {any} [actor] */
function readDatabase(owner, actor = seller) {
  /** @type {string[]} */ const calls = [];
  const database = {
    async query(/** @type {string} */ sql) {
      calls.push(sql);
      const user = actorRows(sql, actor);
      if (user) return user;
      if (sql.includes('SELECT identity.current_contact_id'))
        return { rows: [{ current_contact_id: 'contact' }] };
      if (
        /FROM crm.conversation_subjects|FROM crm.orders|FROM crm.order_assistance/u.test(
          sql,
        )
      )
        return { rows: [] };
      if (sql.startsWith('SELECT conversation.id FROM crm.conversations'))
        return {
          rows:
            owner !== undefined &&
            (owner === null ||
              owner === actor.id ||
              actor.capabilities.includes('COMMERCIAL_ADMIN'))
              ? [{ id: 'conversation' }]
              : [],
        };
      if (sql.includes('FROM crm.conversations')) {
        return {
          rows:
            owner === undefined
              ? []
              : [
                  {
                    id: 'conversation',
                    current_contact_id: 'contact',
                    provider_account_id: 'general',
                    assigned_user_id: owner,
                    contact_id: 'contact',
                    contact_identity_id: 'identity',
                    version: 1,
                    inbound_revision: 1,
                  },
                ],
        };
      }
      return { rows: [] };
    },
    async transaction(/** @type {(tx:any)=>Promise<any>} */ work) {
      return work(database);
    },
  };
  return { database, calls };
}

for (const [actor, owner] of /** @type {Array<[any,string|null]>} */ ([
  [seller, null],
  [seller, seller.id],
  [admin, 'other-seller'],
])) {
  test(`CONV-ACL-01: subjects and purchase suggestions remain readable for ${actor.id} with owner ${owner}`, async () => {
    const subjects = readDatabase(owner, actor);
    const result = await createSubjectApiRuntime(subjects.database, {}).list(
      'conversation',
      '',
      actor,
    );
    assert.deepEqual(result.subjects, []);
    assert.match(subjects.calls[0], /FROM crm.users.*FOR UPDATE/u);
    const assistance = readDatabase(owner, actor);
    const repository = new PostgresOrderAssistanceRepository({
      database: assistance.database,
      envelopeKey: Buffer.alloc(32, 1),
      createPending: async () => {},
    });
    assert.deepEqual(
      (await repository.list({ conversationId: 'conversation', actor }))
        .suggestions,
      [],
    );
  });
}

for (const actor of [
  seller,
  { ...seller, functionName: 'Financeiro' },
  { ...seller, disabledAt: '2026-11-01T00:00:00Z' },
]) {
  test(`CONV-ACL-01: denied ${actor.functionName} cannot read subject evidence or purchase suggestions`, async () => {
    const subjects = readDatabase('other-seller', actor);
    await assert.rejects(
      createSubjectApiRuntime(subjects.database, {}).list(
        'conversation',
        '',
        actor,
      ),
      { statusCode: 403 },
    );
    assert.equal(
      subjects.calls.some((sql) =>
        /FROM crm.conversation_subjects|FROM crm.orders/u.test(sql),
      ),
      false,
    );
    const assistance = readDatabase('other-seller', actor);
    const repository = new PostgresOrderAssistanceRepository({
      database: assistance.database,
      envelopeKey: Buffer.alloc(32, 1),
      createPending: async () => {},
    });
    await assert.rejects(
      repository.list({ conversationId: 'conversation', actor }),
      { statusCode: 403 },
    );
    assert.equal(
      assistance.calls.some((sql) => /FROM crm.order_assistance/u.test(sql)),
      false,
    );
  });
}

test('CONV-ACL-01: missing subject conversation returns no evidence', async () => {
  const { database, calls } = readDatabase(undefined);
  await assert.rejects(
    createSubjectApiRuntime(database, {}).list('missing', '', seller),
    { statusCode: 404, code: 'CONVERSATION_NOT_FOUND' },
  );
  assert.equal(
    calls.some((sql) =>
      /FROM crm.conversation_subjects|FROM crm.orders/u.test(sql),
    ),
    false,
  );
});

test('CONV-ACL-01: a stale unclaimed handoff cannot steal another seller conversation', async () => {
  /** @type {string[]} */ const calls = [];
  const database = {
    async query(/** @type {string} */ sql) {
      calls.push(sql);
      const user = actorRows(sql, seller);
      if (user) return user;
      if (sql.includes('SELECT identity.current_contact_id'))
        return { rows: [{ current_contact_id: 'contact' }] };
      if (
        sql.includes('FROM crm.seller_whatsapp_lines') ||
        sql.includes('SELECT id FROM crm.contacts')
      )
        return { rows: [] };
      if (sql.includes('$3::boolean')) return { rows: [] };
      if (sql.includes('INSERT INTO crm.idempotency_records'))
        return { rows: [{ inserted: true }] };
      if (sql.includes('SELECT conversation_id FROM crm.handoffs'))
        return { rows: [{ conversation_id: 'conversation' }] };
      if (sql.includes('FROM crm.conversations'))
        return {
          rows: [
            {
              id: 'conversation',
              current_contact_id: 'contact',
              provider_account_id: 'general',
              assigned_user_id: 'other-seller',
              automation_state: 'human',
              terminal_at: null,
              version: 1,
            },
          ],
        };
      throw new Error('Unauthorized handoff reached a domain effect');
    },
    async transaction(/** @type {(tx:any)=>Promise<any>} */ work) {
      return work(database);
    },
  };
  const runtime = createConversationHandoffRuntime(database, {
    environment: {
      IDEMPOTENCY_ENVELOPE_KEY: Buffer.alloc(32, 9).toString('base64url'),
    },
  });
  await assert.rejects(
    runtime.claimHandoff({
      actor: seller,
      handoffId: 'handoff',
      expectedHandoffVersion: 1,
      expectedConversationVersion: 1,
      correlationId: 'synthetic-correlation',
      idempotencyKey: 'synthetic-claim',
    }),
    { statusCode: 403, code: 'HANDOFF_FORBIDDEN' },
  );
  assert.equal(
    calls.some((sql) => sql.startsWith('UPDATE crm.conversations')),
    false,
  );
  assert.equal(
    calls.some((sql) => sql.includes('SELECT * FROM crm.handoffs')),
    false,
  );
});

for (const kind of ['send', 'takeover', 'transfer']) {
  test(`CONV-ACL-01: ${kind} receipt cannot expose a conversation after transfer`, async () => {
    const input = {
      actor: seller,
      conversationId: 'conversation',
      idempotencyKey: 'old-command',
      correlationId: 'synthetic',
      expectedVersion: 1,
      reason: 'Synthetic',
      messageType: 'text',
      content: { text: 'Synthetic' },
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    /** @type {string[]} */ const calls = [];
    const database = {
      async query(/** @type {string} */ sql) {
        calls.push(sql);
        const user = actorRows(sql, seller);
        if (user) return user;
        if (sql.includes('SELECT identity.current_contact_id'))
          return { rows: [{ current_contact_id: 'contact' }] };
        if (sql.includes('$3::boolean')) return { rows: [] };
        if (sql.includes('FROM crm.inbox_commands'))
          return {
            rows: [
              {
                fingerprint,
                result: { entityType: 'message', entityId: 'old-message' },
              },
            ],
          };
        if (sql.includes('FROM crm.conversations'))
          return {
            rows: [
              {
                assigned_user_id: 'new-owner',
                current_contact_id: 'contact',
                provider_account_id: 'general',
              },
            ],
          };
        if (sql.includes('FROM crm.messages'))
          throw new Error('Receipt exposed message content');
        return { rows: [] };
      },
      async transaction(/** @type {(tx:any)=>Promise<any>} */ work) {
        return work(database);
      },
    };
    const repository = new PostgresInboxRepository({
      database,
      envelopeKey: Buffer.alloc(32, 1),
      outboundMessageOutbox: { enqueueChannelMessage: async () => {} },
    });
    await assert.rejects(repository.mutateConversation(kind, input, {}), {
      statusCode: 403,
      code: 'INBOX_FORBIDDEN',
    });
    assert.equal(
      calls.some((sql) => sql.includes('FROM crm.messages')),
      false,
    );
    assert.match(calls.at(-1) ?? '', /seller_client_links/u);
  });
}
