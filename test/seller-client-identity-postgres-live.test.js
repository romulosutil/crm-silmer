import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { createOperationReadRuntime } from '../apps/api/src/operation-runtime.js';

import { PostgresAuditTrail } from '../modules/audit-privacy/src/index.js';
import {
  PostgresContactIdentityRepository,
  PostgresContactReadRepository,
  contactPhoneHash,
  createContactIdentityService,
  encryptContactDetails,
} from '../modules/contacts/src/index.js';
import {
  lockSellerClientContact,
  requireSellerClientActor,
  setSellerClientLink,
} from '../modules/contacts/src/adapters/postgres-seller-client-links.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';

const URL = process.env.TEST_DATABASE_URL;
const A = 'identity-seller-a',
  B = 'identity-seller-b',
  ADMIN = 'identity-admin';
const KEY = Buffer.alloc(32, 81),
  LOOKUP = Buffer.alloc(32, 82);
const PRIVATE_REASON = 'Motivo privado sintetico cliente 5511998877665';
/** @param {string} id */
const actor = (id) => ({ id, functionName: 'Vendedor', kind: 'human' });

if (!URL) {
  test(
    'WAP-E03 identity ACL requires synthetic PostgreSQL',
    { skip: true },
    () => {},
  );
} else {
  assert.equal(new globalThis.URL(URL).pathname, '/crm_silmer_test');
  test('WAP-E03 PostgreSQL identity mutation and replay cannot bypass portfolio or line access', async (t) => {
    const pool = new Pool({ connectionString: URL, max: 8 });
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    const auditPort = new PostgresAuditTrail(database);
    const identities = createContactIdentityService({
      auditPort,
      repository: new PostgresContactIdentityRepository({
        database,
        envelopeKey: KEY,
        lookupKey: LOOKUP,
      }),
    });
    const reads = new PostgresContactReadRepository({
      database,
      envelopeKey: KEY,
      lookupKey: LOOKUP,
    });
    const accountId = randomUUID();
    /** @param {string} [account] */
    const resolve = (account = 'synthetic-general') =>
      identities.resolveInboundIdentity({
        channel: 'whatsapp',
        provider: 'evolution',
        providerAccountId: account,
        identityKind: 'phone',
        phoneStatus: 'confirmed',
        displayHandle: null,
        externalIdentityId: `55119${randomUUID().replace(/\D/gu, '').padEnd(8, '0').slice(0, 8)}`,
        correlationId: randomUUID(),
        occurredAt: new Date().toISOString(),
      });
    /** @param {any} source @param {any} target @param {string} [id] */
    const mergeInput = (source, target, id = A) => ({
      actor: actor(id),
      identityId: source.identity.id,
      targetContactId: target.contact.id,
      expectedVersion: source.identity.version,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      reason: PRIVATE_REASON,
    });
    /** @param {string} contactId @param {string} sellerId @param {any} [extra] */
    async function link(contactId, sellerId, extra = {}) {
      return database.transaction(async (/** @type {any} */ tx) => {
        const principal = await requireSellerClientActor(tx, sellerId);
        await lockSellerClientContact(tx, contactId);
        return setSellerClientLink(
          tx,
          {
            actor: principal,
            contactId,
            provenance: 'explicit_link',
            correlationId: randomUUID(),
            ...extra,
          },
          auditPort,
        );
      });
    }
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      for (const id of [A, B, ADMIN]) {
        await pool.query(
          "INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,'$argon2id$synthetic','Synthetic seller')",
          [id, id === ADMIN ? 'admin@crm-silmer.local' : `${id}@example.test`],
        );
        await pool.query(
          "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
          [id],
        );
      }
      await pool.query(
        "INSERT INTO crm.user_capabilities(user_id,capability) VALUES($1,'COMMERCIAL_ADMIN')",
        [ADMIN],
      );
      await database.transaction(async (/** @type {any} */ tx) => {
        const lineId = randomUUID(),
          number = '5511999000066';
        const digest = contactPhoneHash(number, LOOKUP);
        await tx.query(
          `INSERT INTO crm.seller_whatsapp_lines
          (id,seller_id,account_id,instance_name,number_digest,number_envelope,state,generation,version,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,'disconnected',1,1,now(),now())`,
          [
            lineId,
            A,
            accountId,
            'wap_' + lineId.replaceAll('-', ''),
            digest,
            JSON.stringify(
              encryptContactDetails({ phone: number, email: null }, KEY),
            ),
          ],
        );
        await tx.query(
          "INSERT INTO crm.whatsapp_number_reservations(number_digest,kind,line_id,created_at) VALUES($1,'personal',$2,now())",
          [digest, lineId],
        );
      });
      const personal = await resolve(accountId),
        general = await resolve(),
        other = await resolve();
      await t.test(
        'identity mutation waits for Contact before locking identity, matching Olist readers',
        async () => {
          const origin = await resolve(),
            destination = await resolve();
          let contactQuery = /** @type {() => void} */ (() => {});
          const waiting = new Promise((resolveWaiting) => {
            contactQuery = () => resolveWaiting(undefined);
          });
          const instrumented = {
            query: database.query,
            transaction: (/** @type {any} */ work) =>
              withTransaction(pool, async (client) =>
                work({
                  query: (
                    /** @type {string} */ sql,
                    /** @type {any[]} */ values,
                  ) => {
                    const result = client.query(sql, values);
                    if (sql.includes('SELECT id,version FROM crm.contacts'))
                      contactQuery();
                    return result;
                  },
                }),
              ),
          };
          const raced = createContactIdentityService({
            auditPort,
            repository: new PostgresContactIdentityRepository({
              database: instrumented,
              envelopeKey: KEY,
              lookupKey: LOOKUP,
            }),
          });
          const olistReader = await pool.connect();
          let pending = /** @type {Promise<any>|undefined} */ (undefined);
          try {
            await olistReader.query('BEGIN');
            await olistReader.query("SET LOCAL statement_timeout='2s'");
            await olistReader.query(
              'SELECT id FROM crm.contacts WHERE id=$1 FOR SHARE',
              [origin.contact.id],
            );
            pending = raced.mergeIdentity(
              mergeInput(origin, destination, ADMIN),
            );
            await waiting;
            // This must finish while merge is waiting for the Contact. Acquiring
            // identity first would deadlock against this existing Olist order.
            await olistReader.query(
              'SELECT id FROM crm.contact_identities WHERE id=$1 FOR SHARE',
              [origin.identity.id],
            );
            await olistReader.query('COMMIT');
            assert.equal(
              (await pending).identity.contactId,
              destination.contact.id,
            );
          } finally {
            await olistReader.query('ROLLBACK');
            olistReader.release();
            if (pending) await pending.catch(() => {});
          }
        },
      );
      const initialLink = await link(personal.contact.id, A);
      await t.test(
        'official identity resolution indexes private phone collisions atomically',
        async () => {
          const key = KEY.toString('base64url');
          const operations = createOperationReadRuntime(database, {
            environment: {
              CONTACT_IDENTITY_ENVELOPE_KEY: key,
              CONTACT_IDENTITY_LOOKUP_KEY: LOOKUP.toString('base64url'),
              HANDOFF_ENVELOPE_KEY: key,
              INBOX_MESSAGE_ENVELOPE_KEY: key,
              IDEMPOTENCY_ENVELOPE_KEY: key,
              OPERATION_CURSOR_HMAC_KEY: key,
              SELLER_CLIENTS_ENABLED: 'true',
              SELLER_CLIENTS_SELLER_IDS: JSON.stringify([A, B]),
            },
          });
          const before = (
            await pool.query('SELECT count(*)::integer n FROM crm.contacts')
          ).rows[0].n;
          await assert.rejects(
            operations.createMyClient({
              actor: actor(B),
              displayName: 'Synthetic collision',
              phone: personal.identity.externalIdentityId,
              idempotencyKey: randomUUID(),
              correlationId: randomUUID(),
            }),
            { code: 'CONTACT_PHONE_MATCH', statusCode: 409 },
          );
          assert.equal(
            (await pool.query('SELECT count(*)::integer n FROM crm.contacts'))
              .rows[0].n,
            before,
          );
          await assert.rejects(
            reads.get(personal.contact.id, { visibilityActorId: B }),
            { code: 'CONTACT_NOT_FOUND' },
          );
        },
      );
      await t.test(
        'private source and target IDs fail without exposing existence or versions',
        async () => {
          for (const input of [
            mergeInput(personal, general, B),
            { ...mergeInput(personal, general, B), expectedVersion: 900 },
            mergeInput(general, personal, B),
          ]) {
            await assert.rejects(identities.mergeIdentity(input), {
              code: 'CONTACT_IDENTITY_NOT_FOUND',
              statusCode: 404,
            });
          }
        },
      );
      const command = mergeInput(personal, general);
      /** @type {any} */
      let merged;
      await t.test(
        'authorized merge preserves private origin, line ownership and protected reasons',
        async () => {
          merged = await identities.mergeIdentity(command);
          assert.equal(merged.identity.contactId, general.contact.id);
          assert.equal(merged.link.sourceContactId, personal.contact.id);
          assert.equal(
            (
              await pool.query(
                'SELECT wallet_created FROM crm.contacts WHERE id=$1',
                [personal.contact.id],
              )
            ).rows[0].wallet_created,
            true,
          );
          await assert.rejects(
            reads.get(personal.contact.id, { visibilityActorId: B }),
            { code: 'CONTACT_NOT_FOUND' },
          );
          const audit = await pool.query(`SELECT
          (SELECT json_agg(t) FROM crm.audit_events t) audit,
          (SELECT json_agg(t) FROM crm.domain_events t) events,
          (SELECT json_agg(t) FROM crm.identity_links t) identity_links,
          (SELECT json_agg(t) FROM crm.contact_change_reviews t) reviews`);
          assert.doesNotMatch(
            JSON.stringify(audit.rows),
            /Motivo privado|5511998877665/u,
          );
          assert.equal(audit.rows[0].reviews.length, 2);
          assert.equal(
            audit.rows[0].identity_links[0].merge_reason,
            'CONTACT_IDENTITY_MERGE',
          );
          assert.deepEqual(await identities.mergeIdentity(command), merged);
        },
      );
      await t.test(
        'sharing the Contact never grants another seller its personal identity',
        async () => {
          await link(general.contact.id, B);
          const attempted = {
            ...mergeInput(personal, other, B),
            expectedVersion: 2,
          };
          await assert.rejects(identities.mergeIdentity(attempted), {
            code: 'CONTACT_IDENTITY_NOT_FOUND',
          });
        },
      );
      await t.test(
        'merge replay reauthorizes a revoked source portfolio',
        async () => {
          const revoked = await link(personal.contact.id, A, {
            state: 'revoked',
            expectedVersion: initialLink.version,
          });
          await assert.rejects(identities.mergeIdentity(command), {
            code: 'CONTACT_IDENTITY_NOT_FOUND',
          });
          await link(personal.contact.id, A, {
            expectedVersion: revoked.version,
          });
        },
      );
      const inverse = {
        actor: actor(A),
        linkId: merged.link.id,
        expectedVersion: merged.identity.version,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        reason: PRIVATE_REASON,
      };
      await t.test(
        'unmerge cannot be called by another portfolio, and locks serialize competing identity commands',
        async () => {
          await assert.rejects(
            identities.unmergeIdentity({
              ...inverse,
              actor: actor(B),
              idempotencyKey: randomUUID(),
            }),
            { code: 'CONTACT_IDENTITY_NOT_FOUND' },
          );
          const settled = await Promise.allSettled([
            identities.unmergeIdentity(inverse),
            identities.mergeIdentity({
              ...mergeInput(personal, other, ADMIN),
              expectedVersion: 2,
            }),
          ]);
          assert.equal(settled[0].status, 'fulfilled');
          assert.equal(settled[1].status, 'rejected');
          assert.equal(
            /** @type {PromiseRejectedResult} */ (settled[1]).reason.code,
            'CONTACT_IDENTITY_CONFLICT',
          );
          assert.equal(
            (await identities.unmergeIdentity(inverse)).identity.contactId,
            personal.contact.id,
          );
        },
      );
      await t.test(
        'unmerge replay rechecks disabled users, roles and revoked portfolio grants',
        async () => {
          await pool.query(
            'UPDATE crm.users SET disabled_at=now() WHERE id=$1',
            [A],
          );
          await assert.rejects(identities.unmergeIdentity(inverse), {
            code: 'FORBIDDEN',
          });
          await pool.query(
            'UPDATE crm.users SET disabled_at=NULL WHERE id=$1',
            [A],
          );
          await pool.query(
            "UPDATE crm.user_functions SET function_name='Financeiro' WHERE user_id=$1",
            [A],
          );
          await assert.rejects(identities.unmergeIdentity(inverse), {
            code: 'FORBIDDEN',
          });
          await pool.query(
            "UPDATE crm.user_functions SET function_name='Vendedor' WHERE user_id=$1",
            [A],
          );
          await link(personal.contact.id, A, {
            state: 'revoked',
            expectedVersion: 3,
          });
          await assert.rejects(identities.unmergeIdentity(inverse), {
            code: 'CONTACT_IDENTITY_NOT_FOUND',
          });
        },
      );
    } finally {
      await pool.query('UPDATE crm.users SET email=$2 WHERE id=$1', [
        ADMIN,
        ADMIN + '@example.test',
      ]);
      await pool.end();
    }
  });
}
