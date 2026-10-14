import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import test from 'node:test';

import { createOperationReadRuntime } from '../apps/api/src/operation-runtime.js';
import { createApi } from '../apps/api/src/app.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

import {
  contactPhoneHash,
  decryptContactDetails,
  encryptContactDetails,
  normalizeContactEmail,
  normalizeContactPhone,
  PostgresContactReadRepository,
} from '../modules/contacts/src/index.js';

test('manual phone accepts Brazilian numbers and rejects incomplete input', () => {
  assert.equal(normalizeContactPhone('(11) 99999-9999'), '5511999999999');
  assert.equal(normalizeContactPhone('+55 11 99999-9999'), '5511999999999');
  assert.equal(normalizeContactPhone('119999999'), null);
  assert.equal(normalizeContactPhone('abc11999999999'), null);
});

test('private contact details round trip with no plaintext in the stored envelope', () => {
  const key = Buffer.alloc(32, 4);
  const details = { email: 'cliente@example.test', phone: '5511999999999' };
  const encrypted = encryptContactDetails(details, key);
  assert.doesNotMatch(
    JSON.stringify(encrypted),
    /cliente@example|5511999999999/u,
  );
  assert.deepEqual(decryptContactDetails(encrypted, key), details);
  assert.equal(contactPhoneHash(details.phone, key).length, 64);
  assert.equal(
    normalizeContactEmail(' CLIENTE@EXAMPLE.TEST '),
    'cliente@example.test',
  );
  assert.equal(normalizeContactEmail('invalido'), undefined);
});

test('phone search uses a keyed hash and never sends plaintext to SQL', async () => {
  /** @type {Array<{sql: string, values: unknown[]}>} */
  const queries = [];
  const lookupKey = Buffer.alloc(32, 8);
  const repository = new PostgresContactReadRepository({
    database: {
      async query(/** @type {string} */ sql, /** @type {unknown[]} */ values) {
        queries.push({ sql, values });
        return { rows: sql.includes('count(*)') ? [{ count: 0 }] : [] };
      },
    },
    envelopeKey: Buffer.alloc(32, 7),
    lookupKey,
  });
  await repository.list({ after: null, limit: 10, q: '(11) 98765-4321' });
  assert.equal(queries.length, 2);
  assert.ok(
    queries.every(
      ({ sql, values }) =>
        !`${sql} ${JSON.stringify(values)}`.includes('98765'),
    ),
  );
  assert.ok(
    queries.every(({ values }) =>
      values.includes(contactPhoneHash('5511987654321', lookupKey)),
    ),
  );
  assert.ok(
    queries.every(({ sql }) =>
      sql.includes('phone_identity.current_contact_id = contact.id'),
    ),
  );
});

test('manual creation rejects missing phone and invalid email before writing', async () => {
  const key = Buffer.alloc(32, 7).toString('base64url');
  const database = {
    query: async () => {
      throw new Error('unexpected query');
    },
    transaction: async () => {
      throw new Error('unexpected transaction');
    },
  };
  const operations = createOperationReadRuntime(database, {
    environment: {
      CONTACT_IDENTITY_ENVELOPE_KEY: key,
      CONTACT_IDENTITY_LOOKUP_KEY: key,
      HANDOFF_ENVELOPE_KEY: key,
      INBOX_MESSAGE_ENVELOPE_KEY: key,
      IDEMPOTENCY_ENVELOPE_KEY: key,
      OPERATION_CURSOR_HMAC_KEY: key,
    },
  });
  const base = {
    actor: { id: 'seller-1' },
    correlationId: 'request-1',
    displayName: 'Cliente',
    idempotencyKey: 'create-1',
    phone: undefined,
  };
  await assert.rejects(operations.createContact(base), {
    code: 'INVALID_PHONE',
  });
  await assert.rejects(
    operations.createContact({ ...base, phone: '11987654321', email: 'bad' }),
    {
      code: 'INVALID_EMAIL',
    },
  );
});

test('direct contact creation rejects a phone already claimed on site, without writing', async () => {
  const key = Buffer.alloc(32, 7).toString('base64url');
  /** @type {string[]} */
  const statements = [];
  const database = {
    /** @param {string} sql */
    async query(sql) {
      statements.push(sql);
      if (sql.includes('manual_create_key = $1')) return { rows: [] };
      if (sql.includes('crm.site_contact_claims'))
        return { rows: [{ found: true }] };
      return { rows: [] };
    },
    /** @param {(client: any) => Promise<any>} work */
    async transaction(work) {
      return work(database);
    },
  };
  const operations = createOperationReadRuntime(database, {
    environment: {
      CONTACT_IDENTITY_ENVELOPE_KEY: key,
      CONTACT_IDENTITY_LOOKUP_KEY: key,
      HANDOFF_ENVELOPE_KEY: key,
      INBOX_MESSAGE_ENVELOPE_KEY: key,
      IDEMPOTENCY_ENVELOPE_KEY: key,
      OPERATION_CURSOR_HMAC_KEY: key,
    },
  });
  const api = createApi(
    {},
    {
      logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
      operations: {
        ...operations,
        async authorizeWrite() {
          return { actor: { id: 'seller-1' } };
        },
      },
    },
  );
  const response = await api.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    headers: {
      cookie: 'crm_session=session',
      origin: 'https://crm.example.test',
      'x-csrf-token': 'csrf-test',
      'idempotency-key': 'new-contact-1',
    },
    payload: { displayName: 'Ana', phone: '11987654321' },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'CONTACT_PHONE_MATCH');
  assert.ok(statements.some((sql) => sql.includes('crm.site_contact_claims')));
  assert.ok(
    statements.every((sql) => !sql.includes('INSERT INTO crm.contacts')),
  );
  assert.doesNotMatch(response.body, /98765/u);
  await api.close();
});

test('a synthetic site-chat identity does not block adding a real phone to its contact', async () => {
  const keyBytes = Buffer.alloc(32, 7);
  const key = keyBytes.toString('base64url');
  const lookupHash = 'a'.repeat(64);
  const iv = Buffer.alloc(12, 3);
  /** @param {string} externalIdentityId */
  const envelopeFor = (externalIdentityId) => {
    const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
    cipher.setAAD(
      Buffer.from(JSON.stringify(['crm.contact_identities', 1, lookupHash])),
    );
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify({ externalIdentityId }), 'utf8'),
      cipher.final(),
    ]);
    return {
      algorithm: 'AES-256-GCM',
      keyVersion: 1,
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  };
  let identityEnvelope = envelopeFor('999123456789012');
  let updated = false;
  let currentVersion = 1;
  let contactReads = 0;
  const receipts = new Map();
  const query = async (
    /** @type {string} */ sql,
    /** @type {any[]} */ values = [],
  ) => {
    if (sql.includes('INSERT INTO crm.idempotency_records')) {
      const [
        scope,
        idempotency_key,
        fingerprint,
        actor_id,
        action,
        target_type,
        target_id,
        version,
        reason,
        correlation_id,
      ] = values;
      const recordKey = `${scope}:${idempotency_key}`;
      if (receipts.has(recordKey)) return { rows: [] };
      receipts.set(recordKey, {
        fingerprint,
        actor_id,
        action,
        target_type,
        target_id,
        version,
        reason,
        correlation_id,
        status: 'pending',
        response: null,
      });
      return { rows: [{ inserted: true }] };
    }
    if (sql.includes('FROM crm.idempotency_records'))
      return { rows: [receipts.get(`${values[0]}:${values[1]}`)] };
    if (sql.includes('UPDATE crm.idempotency_records')) {
      const receipt = receipts.get(`${values[0]}:${values[1]}`);
      receipt.status = 'completed';
      receipt.response = JSON.parse(values[2]);
      return { rows: [{ completed: true }] };
    }
    if (sql.includes('FROM crm.contacts WHERE id = $1 FOR UPDATE')) {
      contactReads += 1;
      return {
        rows: [
          {
            id: 'contact-1',
            display_name: 'Cliente',
            version: currentVersion,
            contact_phone_hash: null,
            contact_details_key: null,
          },
        ],
      };
    }
    if (sql.includes('FROM crm.contact_identities')) {
      return {
        rows: [
          {
            identity_envelope: identityEnvelope,
            external_identity_lookup_hash: lookupHash,
          },
        ],
      };
    }
    if (sql.includes('UPDATE crm.contacts')) {
      updated = true;
      return {
        rows: [{ id: 'contact-1', display_name: 'Cliente', version: 2 }],
      };
    }
    return { rows: [] };
  };
  const database = {
    query,
    transaction: async (/** @type {(client: any) => Promise<any>} */ work) =>
      work({ query }),
  };
  const operations = createOperationReadRuntime(database, {
    environment: {
      CONTACT_IDENTITY_ENVELOPE_KEY: key,
      CONTACT_IDENTITY_LOOKUP_KEY: key,
      HANDOFF_ENVELOPE_KEY: key,
      INBOX_MESSAGE_ENVELOPE_KEY: key,
      IDEMPOTENCY_ENVELOPE_KEY: key,
      OPERATION_CURSOR_HMAC_KEY: key,
    },
  });
  const contact = await operations.setContactDetails({
    actor: { id: 'seller-1' },
    contactId: 'contact-1',
    correlationId: 'request-2',
    expectedVersion: 1,
    idempotencyKey: 'details-1',
    phone: '11987654321',
  });
  assert.equal(updated, true);
  assert.equal(contact.phone, '5511987654321');
  updated = false;
  identityEnvelope = envelopeFor('5511988887777');
  await assert.rejects(
    operations.setContactDetails({
      actor: { id: 'seller-1' },
      contactId: 'contact-1',
      correlationId: 'request-3',
      expectedVersion: 1,
      idempotencyKey: 'details-2',
      phone: '11987654321',
    }),
    { code: 'CONTACT_CONFLICT' },
  );
  assert.equal(updated, false);
  // A later human mutation changes the contact version. The original command
  // still replays its encrypted receipt without touching the current row.
  currentVersion = 3;
  const readsBeforeReplay = contactReads;
  const replay = await operations.setContactDetails({
    actor: { id: 'seller-1' },
    contactId: 'contact-1',
    correlationId: 'request-2-retry',
    expectedVersion: 1,
    idempotencyKey: 'details-1',
    phone: '11987654321',
  });
  assert.deepEqual(replay, contact);
  assert.equal(contactReads, readsBeforeReplay);
});
