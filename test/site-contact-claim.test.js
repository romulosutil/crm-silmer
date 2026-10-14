import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contactPhoneHash,
  decryptSiteContactClaim,
  encryptSiteContactClaim,
  PostgresContactIdentityRepository,
  PostgresContactReadRepository,
} from '../modules/contacts/src/index.js';

test('site claim encrypts name and phone with claim version as authenticated context', () => {
  const key = Buffer.alloc(32, 19);
  const encrypted = encryptSiteContactClaim(
    { name: '  Ana  ', phone: '(11) 98765-4321' },
    'claim-1',
    1,
    key,
  );
  assert.doesNotMatch(JSON.stringify(encrypted), /Ana|98765/u);
  assert.deepEqual(decryptSiteContactClaim(encrypted, 'claim-1', 1, key), {
    name: 'Ana',
    phone: '5511987654321',
  });
  assert.throws(() => decryptSiteContactClaim(encrypted, 'claim-1', 2, key));
  assert.throws(() => decryptSiteContactClaim(encrypted, 'claim-2', 1, key));
});

test('site chat identity cannot be merged by an ordinary human command', async () => {
  /** @type {string[]} */
  const statements = [];
  const database = {
    /** @param {string} sql */
    async query(sql) {
      statements.push(sql);
      if (sql.includes('WHERE l.merge_idempotency_key')) return { rows: [] };
      if (sql.includes('WHERE ci.id = $1'))
        return {
          rows: [
            {
              identity_id: 'site-identity',
              channel: 'site_chat',
              current_contact_id: 'site-contact',
              identity_version: 1,
            },
          ],
        };
      return { rows: [] };
    },
    /** @param {(client: any) => Promise<any>} work */
    async transaction(work) {
      return work(database);
    },
  };
  const repository = new PostgresContactIdentityRepository({
    database,
    envelopeKey: Buffer.alloc(32, 2),
    lookupKey: Buffer.alloc(32, 3),
  });
  await assert.rejects(
    repository.mergeIdentity(
      {
        actor: { id: 'seller-1' },
        correlationId: 'request-1',
        expectedVersion: 1,
        fingerprint: 'a'.repeat(64),
        idempotencyKey: 'merge-1',
        identityId: 'site-identity',
        targetContactId: 'verified-contact',
      },
      { append: async () => {} },
    ),
    { code: 'CONTACT_IDENTITY_FORBIDDEN' },
  );
  assert.ok(
    statements.every((sql) => !sql.includes('UPDATE crm.contact_identities')),
  );
});

test('human phone lookup returns separate site and confirmed candidates via current identity owner', async () => {
  const envelopeKey = Buffer.alloc(32, 21);
  const lookupKey = Buffer.alloc(32, 22);
  const claimEnvelope = encryptSiteContactClaim(
    { name: 'Ana Site', phone: '11987654321' },
    'claim-1',
    1,
    envelopeKey,
  );
  /** @type {Array<{sql: string, values: unknown[]}>} */
  const queries = [];
  const at = new Date('2026-10-14T12:00:00.000Z');
  const database = {
    async query(/** @type {string} */ sql, /** @type {unknown[]} */ values) {
      queries.push({ sql, values });
      if (sql.includes('count(*)')) return { rows: [{ count: 2 }] };
      return {
        rows: [
          {
            id: 'site-owner-after-merge',
            display_name: 'Ana Site',
            created_at: at,
            updated_at: at,
            latest_activity_at: at,
            version: 1,
            provisional: true,
            contact_details_envelope: null,
            site_claim_id: 'claim-1',
            site_claim_version: 1,
            site_claim_envelope: claimEnvelope,
          },
          {
            id: 'confirmed-other-contact',
            display_name: 'Ana WhatsApp',
            created_at: at,
            updated_at: at,
            latest_activity_at: at,
            version: 1,
            provisional: false,
            contact_details_envelope: null,
          },
        ],
      };
    },
  };
  const repository = new PostgresContactReadRepository({
    database,
    envelopeKey,
    lookupKey,
  });
  const result = await repository.list({
    after: null,
    limit: 10,
    q: '11987654321',
  });
  assert.equal(result.totalCount, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].phone, '5511987654321');
  assert.equal(result.items[0].phoneSource, 'site_unverified');
  assert.equal(result.items[0].id, 'site-owner-after-merge');
  assert.equal(result.items[1].id, 'confirmed-other-contact');
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
    queries.every(
      ({ sql }) =>
        sql.includes('site_identity.current_contact_id = contact.id') ||
        sql.includes('site_identity.current_contact_id = contact_page.id'),
    ),
  );
});
