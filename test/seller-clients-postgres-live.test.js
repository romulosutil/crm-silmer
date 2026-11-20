import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { createOperationReadRuntime } from '../apps/api/src/operation-runtime.js';
import { PostgresAuditTrail } from '../modules/audit-privacy/src/index.js';
import {
  PostgresContactIdentityRepository,
  contactPhoneHash,
  createContactIdentityService,
  decryptContactDetails,
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
import { PostgresOrderConversationPort } from '../modules/orders/src/adapters/postgres-order-conversation-port.js';
import { PostgresOrderRepository } from '../modules/orders/src/adapters/postgres-order-repository.js';
import { encryptJson } from '../modules/orders/src/adapters/envelope.js';
import { createOrderService } from '../modules/orders/src/application/order-service.js';
import { briefingToFicha } from '../modules/orders/src/domain/ficha.js';

const URL = process.env.TEST_DATABASE_URL;
const A = 'clients-seller-a';
const B = 'clients-seller-b';
const ADMIN = 'clients-admin';
const FINANCE = 'clients-finance';
const KEY = Buffer.alloc(32, 71);
const LOOKUP = Buffer.alloc(32, 72);
const ENV = {
  CONTACT_IDENTITY_ENVELOPE_KEY: KEY.toString('base64url'),
  CONTACT_IDENTITY_LOOKUP_KEY: LOOKUP.toString('base64url'),
  HANDOFF_ENVELOPE_KEY: Buffer.alloc(32, 73).toString('base64url'),
  INBOX_MESSAGE_ENVELOPE_KEY: Buffer.alloc(32, 74).toString('base64url'),
  IDEMPOTENCY_ENVELOPE_KEY: Buffer.alloc(32, 75).toString('base64url'),
  OPERATION_CURSOR_HMAC_KEY: Buffer.alloc(32, 76).toString('base64url'),
  SELLER_CLIENTS_ENABLED: 'true',
  SELLER_CLIENTS_SELLER_IDS: JSON.stringify([A, B, ADMIN]),
};
/** @param {string} id */
const access = (id) => ({
  actorId: id,
  capabilities: id === ADMIN ? ['COMMERCIAL_ADMIN'] : [],
});
/** @param {string} code */
const rejects = (code) => (/** @type {any} */ error) => error.code === code;

if (!URL) {
  test(
    'Seller clients runtime PostgreSQL cases require TEST_DATABASE_URL',
    { skip: true },
    () => {},
  );
} else {
  assert.equal(new globalThis.URL(URL).pathname, '/crm_silmer_test');
  test('WAP-E03 portfolio registration, scoped reads, shared policy and concurrent authorization', async (t) => {
    const pool = new Pool({ connectionString: URL, max: 12 });
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    const operations = createOperationReadRuntime(database, {
      environment: ENV,
    });
    const audit = new PostgresAuditTrail(database);
    let phoneSequence = 100;
    /** @param {string} sellerId */
    async function personalAccount(sellerId) {
      const current = (
        await pool.query(
          'SELECT account_id FROM crm.seller_whatsapp_lines WHERE seller_id=$1',
          [sellerId],
        )
      ).rows[0];
      if (current) return current.account_id;
      const accountId = randomUUID(),
        lineId = randomUUID(),
        number = `55119990000${sellerId === A ? '88' : '89'}`;
      await database.transaction(async (/** @type {any} */ tx) => {
        const digest = contactPhoneHash(number, LOOKUP);
        await tx.query(
          `INSERT INTO crm.seller_whatsapp_lines
          (id,seller_id,account_id,instance_name,number_digest,number_envelope,state,generation,version,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,'disconnected',1,1,now(),now())`,
          [
            lineId,
            sellerId,
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
      return accountId;
    }
    /** @param {string} accountId @param {string} phone */
    async function personalIdentity(accountId, phone) {
      const identities = createContactIdentityService({
        auditPort: audit,
        repository: new PostgresContactIdentityRepository({
          database,
          envelopeKey: KEY,
          lookupKey: LOOKUP,
        }),
      });
      return identities.resolveInboundIdentity({
        provider: 'evolution',
        providerAccountId: accountId,
        channel: 'whatsapp',
        identityKind: 'phone',
        phoneStatus: 'confirmed',
        externalIdentityId: phone,
        displayHandle: null,
        correlationId: randomUUID(),
        occurredAt: new Date().toISOString(),
      });
    }
    /** @param {string} applicationName @param {RegExp} queryPattern */
    async function waitForLock(applicationName, queryPattern) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await pool.query(
          "SELECT query FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
          [applicationName],
        );
        if (result.rows.length) {
          assert.match(result.rows[0].query, queryPattern);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail(`Expected PostgreSQL lock waiter ${applicationName}`);
    }
    /** @param {string} [actorId] @param {string} [displayName] @param {any} [fields] */
    const createInput = (
      actorId = A,
      displayName = 'Synthetic client',
      fields = {},
    ) => ({
      actor: { id: actorId },
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      displayName,
      phone: `5511988${String(phoneSequence++).padStart(6, '0')}`,
      email: 'synthetic@example.test',
      ...fields,
    });
    /** @param {string} [actorId] @param {string} [displayName] */
    const legacy = (actorId = A, displayName = 'Synthetic legacy') =>
      operations.createContact(createInput(actorId, displayName));
    /** @param {string} [actorId] @param {string} [displayName] */
    const personal = (actorId = A, displayName = 'Synthetic portfolio') =>
      operations.createMyClient(createInput(actorId, displayName));
    /** @param {string} contactId @param {string} actorId @param {any} [fields] */
    const linkInput = (contactId, actorId, fields = {}) => ({
      actor: { id: actorId },
      contactId,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      ...fields,
    });
    /** @param {string} contactId @param {string} actorId @param {any} [fields] */
    async function transition(contactId, actorId, fields = {}) {
      return database.transaction(async (/** @type {any} */ tx) => {
        const actor = await requireSellerClientActor(tx, actorId);
        await lockSellerClientContact(tx, contactId);
        return setSellerClientLink(
          tx,
          {
            actor,
            contactId,
            provenance: 'explicit_link',
            correlationId: randomUUID(),
            ...fields,
          },
          audit,
        );
      });
    }
    /** @param {string} contactId @param {string} actorId @param {number} version @param {any} registration @param {any} [fields] */
    const registrationInput = (
      contactId,
      actorId,
      version,
      registration,
      fields = {},
    ) => ({
      actor: { id: actorId },
      contactId,
      expectedVersion: version,
      registration,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      ...fields,
    });
    /** @param {string} table */
    const count = async (table) =>
      (await pool.query(`SELECT count(*)::int n FROM crm.${table}`)).rows[0].n;
    /** @param {string} contactId */
    const version = async (contactId) =>
      Number(
        (
          await pool.query('SELECT version FROM crm.contacts WHERE id=$1', [
            contactId,
          ])
        ).rows[0].version,
      );
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });
      for (const id of [A, B, ADMIN, FINANCE]) {
        await pool.query(
          "INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,'$argon2id$synthetic','Synthetic seller')",
          [id, id === ADMIN ? 'admin@crm-silmer.local' : `${id}@example.test`],
        );
        await pool.query(
          'INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,$2)',
          [id, id === FINANCE ? 'Financeiro' : 'Vendedor'],
        );
      }
      await pool.query(
        "INSERT INTO crm.user_capabilities(user_id,capability) VALUES($1,'COMMERCIAL_ADMIN')",
        [ADMIN],
      );

      await t.test(
        'default off, explicit allowlist and current active seller guard each new entry',
        async () => {
          const off = createOperationReadRuntime(database, {
            environment: { ...ENV, SELLER_CLIENTS_ENABLED: 'false' },
          });
          await assert.rejects(
            off.createMyClient(createInput()),
            rejects('SELLER_CLIENTS_DISABLED'),
          );
          await assert.rejects(
            off.listMyClients({}, access(A)),
            rejects('SELLER_CLIENTS_DISABLED'),
          );
          await assert.rejects(
            off.linkMyClient(linkInput('missing', A)),
            rejects('SELLER_CLIENTS_DISABLED'),
          );
          await assert.rejects(
            operations.createMyClient(createInput(FINANCE)),
            rejects('FORBIDDEN'),
          );
          await assert.rejects(
            operations.listMyClients({}, access(FINANCE)),
            rejects('FORBIDDEN'),
          );
          const restricted = createOperationReadRuntime(database, {
            environment: {
              ...ENV,
              SELLER_CLIENTS_SELLER_IDS: JSON.stringify([A]),
            },
          });
          await assert.rejects(
            restricted.createMyClient(createInput(B)),
            rejects('FORBIDDEN'),
          );
          assert.equal(await count('contacts'), 0);
        },
      );

      await t.test(
        'new official Contact and own link commit together without identity, conversation, order or send',
        async () => {
          const command = createInput(A, 'Atomic portfolio');
          const before = await Promise.all(
            [
              'contact_identities',
              'conversations',
              'orders',
              'outbox_jobs',
            ].map(count),
          );
          const result = await operations.createMyClient(command);
          assert.equal(result.created, true);
          assert.equal(result.link.contactId, result.contact.id);
          assert.equal(result.link.version, 1);
          assert.equal(result.contact.version, 1);
          const replay = await operations.createMyClient(command);
          assert.equal(replay.created, false);
          assert.equal(replay.contact.id, result.contact.id);
          assert.equal(await count('contacts'), 1);
          assert.equal(await count('seller_client_links'), 1);
          assert.deepEqual(
            await Promise.all(
              [
                'contact_identities',
                'conversations',
                'orders',
                'outbox_jobs',
              ].map(count),
            ),
            before,
          );
          const mine = await operations.listMyClients(
            { q: 'Atomic portfolio' },
            access(A),
          );
          assert.equal(mine.totalCount, 1);
          assert.equal(mine.items[0].id, result.contact.id);
          assert.equal(mine.items[0].link.version, 1);
          assert.equal(
            (
              await operations.listContacts(
                { q: 'Atomic portfolio' },
                access(B),
              )
            ).totalCount,
            0,
          );
          await assert.rejects(
            operations.getContact({ contactId: result.contact.id }, access(B)),
            rejects('CONTACT_NOT_FOUND'),
          );
          await assert.rejects(
            operations.linkMyClient(linkInput(result.contact.id, B)),
            rejects('CONTACT_NOT_FOUND'),
          );
          await assert.rejects(
            operations.createMyClient({
              ...createInput(B),
              phone: command.phone,
            }),
            rejects('CONTACT_PHONE_MATCH'),
          );
          assert.equal(await count('contacts'), 1);
        },
      );

      await t.test(
        'link failure rolls back the entire new registration',
        async () => {
          const failingDatabase = {
            ...database,
            transaction: (/** @type {any} */ work) =>
              withTransaction(pool, (tx) =>
                work({
                  query: (
                    /** @type {string} */ sql,
                    /** @type {any[]} */ values,
                  ) => {
                    if (sql.includes('INSERT INTO crm.seller_client_links'))
                      throw new Error('synthetic link failure');
                    return tx.query(sql, values);
                  },
                }),
              ),
          };
          const failing = createOperationReadRuntime(failingDatabase, {
            environment: ENV,
          });
          const before = await Promise.all(
            [
              'contacts',
              'seller_client_links',
              'audit_events',
              'domain_events',
            ].map(count),
          );
          await assert.rejects(
            failing.createMyClient(createInput()),
            /synthetic link failure/u,
          );
          assert.deepEqual(
            await Promise.all(
              [
                'contacts',
                'seller_client_links',
                'audit_events',
                'domain_events',
              ].map(count),
            ),
            before,
          );
        },
      );

      await t.test(
        'legacy accessible selection keeps contactId, atomically deduplicates and reauthorizes replay',
        async () => {
          const { contact } = await legacy(A, 'Shared selected legacy');
          const command = linkInput(contact.id, A);
          const [first, second] = await Promise.all([
            operations.linkMyClient(command),
            operations.linkMyClient({
              ...command,
              idempotencyKey: randomUUID(),
            }),
          ]);
          assert.equal(first.contactId, contact.id);
          assert.equal(first.link.id, second.link.id);
          assert.equal(
            (await operations.linkMyClient(command)).link.id,
            first.link.id,
          );
          await operations.linkMyClient(linkInput(contact.id, B));
          const general = await operations.listContacts(
            { q: 'Shared selected legacy' },
            access(B),
          );
          assert.equal(general.totalCount, 1);
          assert.equal(general.items[0].shared, true);
          await transition(contact.id, A, {
            state: 'revoked',
            expectedVersion: 1,
          });
          await assert.rejects(
            operations.linkMyClient(command),
            rejects('CLIENT_LINK_VERSION_CONFLICT'),
          );
          assert.equal(
            (
              await operations.listMyClients(
                { q: 'Shared selected legacy' },
                access(A),
              )
            ).totalCount,
            0,
          );
          const restoreCommand = linkInput(contact.id, A, {
            expectedLinkVersion: 2,
          });
          const restored = await operations.linkMyClient(restoreCommand);
          assert.equal(restored.link.id, first.link.id);
          assert.equal(restored.link.version, 3);
          await transition(contact.id, A, {
            state: 'revoked',
            expectedVersion: 3,
          });
          await assert.rejects(
            operations.linkMyClient(restoreCommand),
            rejects('CLIENT_LINK_VERSION_CONFLICT'),
          );
          const current = (
            await pool.query(
              'SELECT status,version FROM crm.seller_client_links WHERE id=$1',
              [first.link.id],
            )
          ).rows[0];
          assert.equal(current.status, 'revoked');
          assert.equal(Number(current.version), 4);
        },
      );

      await t.test(
        'scoping precedes search, count and cursor; reader, wallet and membership revisions cannot cross',
        async () => {
          await personal(A, 'Paging visible one');
          await personal(A, 'Paging visible two');
          await personal(B, 'Paging invisible B');
          const page = await operations.listMyClients(
            { q: 'Paging', limit: 1 },
            access(A),
          );
          assert.equal(page.totalCount, 2);
          assert.ok(page.nextCursor);
          assert.equal(page.items.length, 1);
          assert.equal(
            (await operations.listContacts({ q: 'Paging' }, access(B)))
              .totalCount,
            1,
          );
          const next = await operations.listMyClients(
            { q: 'Paging', limit: 1, cursor: page.nextCursor },
            access(A),
          );
          assert.notEqual(next.items[0].id, page.items[0].id);
          assert.equal(next.totalCount, 2);
          await assert.rejects(
            operations.listMyClients(
              { q: 'Paging', limit: 1, cursor: page.nextCursor },
              access(B),
            ),
            rejects('INVALID_CURSOR'),
          );
          await assert.rejects(
            operations.listContacts(
              { q: 'Paging', limit: 1, cursor: page.nextCursor },
              access(A),
            ),
            rejects('INVALID_CURSOR'),
          );
          await transition(page.items[0].id, A, {
            state: 'revoked',
            expectedVersion: 1,
          });
          await assert.rejects(
            operations.listMyClients(
              { q: 'Paging', limit: 1, cursor: page.nextCursor },
              access(A),
            ),
            rejects('INVALID_CURSOR'),
          );
          await assert.rejects(
            operations.getContact({ contactId: page.items[0].id }, access(A)),
            rejects('CONTACT_NOT_FOUND'),
          );
        },
      );

      await t.test(
        'shared registration compares normalized fields, allows empty fiscal and common edits, requires Admin review for critical changes',
        async () => {
          const { contact } = await legacy(A, 'Shared registration');
          await operations.linkMyClient(linkInput(contact.id, A));
          await operations.linkMyClient(linkInput(contact.id, B));
          const fiscal = {
            personType: 'individual',
            document: '529.982.247-25',
            city: 'Synthetic city',
          };
          const initial = await operations.setContactRegistration(
            registrationInput(contact.id, A, 1, fiscal),
          );
          assert.equal(initial.version, 2);
          const changed = await operations.setContactRegistration(
            registrationInput(contact.id, B, 2, {
              ...fiscal,
              document: '52998224725',
              city: 'Other synthetic city',
            }),
          );
          assert.equal(changed.registration.city, 'Other synthetic city');
          assert.equal(changed.registration.document, '52998224725');
          await assert.rejects(
            operations.setContactRegistration(
              registrationInput(contact.id, A, 3, { city: 'Clears fiscal' }),
            ),
            rejects('CONTACT_FIELD_RESTRICTED'),
          );
          await assert.rejects(
            operations.setContactRegistration(
              registrationInput(contact.id, ADMIN, 3, {
                city: 'Admin review missing',
              }),
            ),
            rejects('CONTACT_REVIEW_REQUIRED'),
          );
          const reviewed = await operations.setContactRegistration(
            registrationInput(
              contact.id,
              ADMIN,
              3,
              { city: 'Admin reviewed' },
              {
                review: {
                  confirmed: true,
                  reason: 'REVIEW_CANARY_PII synthetic restricted change',
                },
              },
            ),
          );
          assert.equal(reviewed.version, 4);
          assert.equal(reviewed.registration.document, null);
          const reasons = await pool.query(
            'SELECT reason_envelope FROM crm.contact_change_reviews WHERE contact_id=$1',
            [contact.id],
          );
          assert.equal(reasons.rows.length, 1);
          assert.doesNotMatch(
            JSON.stringify(reasons.rows),
            /REVIEW_CANARY_PII/u,
          );
          const metadata = await pool.query(
            'SELECT reason FROM crm.audit_events WHERE target_id=$1',
            [contact.id],
          );
          assert.doesNotMatch(
            JSON.stringify(metadata.rows),
            /REVIEW_CANARY_PII|52998224725|Other synthetic city/u,
          );
          const events = await pool.query(
            'SELECT payload FROM crm.domain_events WHERE aggregate_id=$1',
            [contact.id],
          );
          assert.doesNotMatch(
            JSON.stringify(events.rows),
            /REVIEW_CANARY_PII|52998224725|Other synthetic city/u,
          );
          assert.ok(
            events.rows.some((row) => row.payload.fields?.includes('city')),
          );
        },
      );

      await t.test(
        'shared phone no-op allows email, phone changes require reviewed Admin and preserve channel identity',
        async () => {
          const created = await legacy(A, 'Shared phone');
          const contact = created.contact;
          await operations.linkMyClient(linkInput(contact.id, A));
          await operations.linkMyClient(linkInput(contact.id, B));
          const base = {
            actor: { id: B },
            contactId: contact.id,
            expectedVersion: 1,
            phone: contact.phone,
            email: 'changed@example.test',
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          };
          const email = await operations.setContactDetails(base);
          assert.equal(email.email, 'changed@example.test');
          const newPhone = createInput().phone;
          await assert.rejects(
            operations.setContactDetails({
              ...base,
              phone: newPhone,
              expectedVersion: 2,
              idempotencyKey: randomUUID(),
            }),
            rejects('CONTACT_FIELD_RESTRICTED'),
          );
          await assert.rejects(
            operations.setContactDetails({
              ...base,
              actor: { id: ADMIN },
              phone: newPhone,
              expectedVersion: 2,
              idempotencyKey: randomUUID(),
            }),
            rejects('CONTACT_REVIEW_REQUIRED'),
          );
          const admin = await operations.setContactDetails({
            ...base,
            actor: { id: ADMIN },
            phone: newPhone,
            expectedVersion: 2,
            idempotencyKey: randomUUID(),
            review: { confirmed: true, reason: 'Synthetic phone verification' },
          });
          assert.equal(admin.phone, newPhone);
          assert.equal(admin.version, 3);
          assert.equal(
            (await operations.listContacts({ q: contact.phone }, access(A)))
              .totalCount,
            0,
          );
          assert.equal(
            (await operations.listContacts({ q: newPhone }, access(A)))
              .totalCount,
            1,
          );
        },
      );

      await t.test(
        'CAS preserves the losing registration draft and revoked private membership rejects stored replay',
        async () => {
          const { contact } = await personal(A, 'Private CAS');
          const first = registrationInput(contact.id, A, 1, {
            city: 'Winning city',
          });
          const other = registrationInput(contact.id, A, 1, {
            city: 'Losing city',
          });
          const outcomes = await Promise.allSettled([
            operations.setContactRegistration(first),
            operations.setContactRegistration(other),
          ]);
          assert.equal(
            outcomes.filter((x) => x.status === 'fulfilled').length,
            1,
          );
          const failed = /** @type {PromiseRejectedResult} */ (
            outcomes.find((x) => x.status === 'rejected')
          );
          assert.equal(failed.reason.code, 'CONTACT_CONFLICT');
          assert.deepEqual(other.registration, { city: 'Losing city' });
          const winner = outcomes[0].status === 'fulfilled' ? first : other;
          await transition(contact.id, A, {
            state: 'revoked',
            expectedVersion: 1,
          });
          await assert.rejects(
            operations.setContactRegistration(winner),
            rejects('CONTACT_NOT_FOUND'),
          );
          assert.equal(await version(contact.id), 2);
        },
      );

      await t.test(
        'a second membership committed before an editor lock is rechecked as shared',
        async () => {
          const { contact } = await legacy(A, 'Concurrent sharing');
          await operations.linkMyClient(linkInput(contact.id, A));
          const blocker = await pool.connect();
          try {
            await blocker.query('BEGIN');
            const actor = await requireSellerClientActor(blocker, B);
            await lockSellerClientContact(blocker, contact.id);
            const editing = operations.setContactDetails({
              actor: { id: A },
              contactId: contact.id,
              phone: createInput().phone,
              email: 'race@example.test',
              expectedVersion: 1,
              idempotencyKey: randomUUID(),
              correlationId: randomUUID(),
            });
            const rejected = assert.rejects(
              editing,
              rejects('CONTACT_FIELD_RESTRICTED'),
            );
            await setSellerClientLink(
              blocker,
              {
                actor,
                contactId: contact.id,
                provenance: 'explicit_link',
                correlationId: randomUUID(),
              },
              audit,
            );
            await blocker.query('COMMIT');
            await rejected;
            assert.equal(await version(contact.id), 1);
          } finally {
            await blocker.query('ROLLBACK');
            blocker.release();
          }
        },
      );

      await t.test(
        'confirmed snapshots stay byte-identical while pending names follow the Contact',
        async () => {
          const { contact } = await legacy(A, 'Original synthetic name');
          await operations.linkMyClient(linkInput(contact.id, A));
          await operations.linkMyClient(linkInput(contact.id, B));
          const pendingId = randomUUID(),
            confirmedId = randomUUID();
          for (const [index, orderId, status] of [
            [100, pendingId, 'pendente'],
            [101, confirmedId, 'confirmado'],
          ]) {
            const ficha = briefingToFicha(null);
            ficha.summary.cliente = 'Immutable synthetic snapshot';
            const confirmed = status === 'confirmado';
            await pool.query(
              `INSERT INTO crm.orders
            (id,number_sequence,number,conversation_id,contact_id,manual_owner_id,manual_create_key,
             status,fab_code,ficha_envelope,created_by_kind,created_by,created_at,updated_at,
             final_amount_cents,payment_condition,order_date,confirmed_at,confirmed_by)
            VALUES($1,$2,$3,NULL,$4,$5,$6,$7,'SYNTHETIC',$8::jsonb,'user',$5,now(),now(),
              $9,$10,$11,$12,$13)`,
              [
                orderId,
                index,
                `${index}-CRM`,
                contact.id,
                A,
                randomUUID(),
                status,
                JSON.stringify(
                  encryptJson(ficha, `order-ficha:${orderId}`, KEY),
                ),
                confirmed ? 1000 : null,
                confirmed ? 'pix' : null,
                confirmed ? '2026-11-17' : null,
                confirmed ? new Date().toISOString() : null,
                confirmed ? A : null,
              ],
            );
          }
          const before = (
            await pool.query(
              'SELECT id,ficha_envelope,version,final_amount_cents,payment_condition,confirmed_at,confirmed_by FROM crm.orders ORDER BY id',
            )
          ).rows;
          await operations.renameContact({
            actor: { id: B },
            contactId: contact.id,
            displayName: 'Current synthetic name',
            expectedVersion: 1,
            reason: 'Synthetic rename reason',
            correlationId: randomUUID(),
          });
          await operations.setContactRegistration(
            registrationInput(contact.id, A, 2, {
              city: 'Current common city',
            }),
          );
          assert.deepEqual(
            (
              await pool.query(
                'SELECT id,ficha_envelope,version,final_amount_cents,payment_condition,confirmed_at,confirmed_by FROM crm.orders ORDER BY id',
              )
            ).rows,
            before,
          );
          const orders = createOrderService({
            repository: new PostgresOrderRepository({
              database,
              envelopeKey: KEY,
            }),
            conversations: new PostgresOrderConversationPort({
              database,
              envelopeKey: KEY,
              contactEnvelopeKey: KEY,
              contactLookupKey: LOOKUP,
            }),
            authorizeOwnership: async () => {},
            fabCode: 'SYNTHETIC',
          });
          assert.equal(
            (await orders.get(pendingId)).ficha.summary.cliente,
            'Current synthetic name',
          );
          assert.equal(
            (await orders.get(confirmedId)).ficha.summary.cliente,
            'Immutable synthetic snapshot',
          );
        },
      );

      await t.test(
        'membership revoked while a writer waits is reauthorized before returning an old receipt',
        async () => {
          const { contact } = await personal(A, 'Revocation race');
          const command = registrationInput(contact.id, A, 1, {
            city: 'Original saved draft',
          });
          await operations.setContactRegistration(command);
          const revoker = await pool.connect();
          try {
            await revoker.query('BEGIN');
            const actor = await requireSellerClientActor(revoker, A);
            await lockSellerClientContact(revoker, contact.id);
            const pending = operations.setContactRegistration(command);
            const denied = assert.rejects(
              pending,
              rejects('CONTACT_NOT_FOUND'),
            );
            await setSellerClientLink(
              revoker,
              {
                actor,
                contactId: contact.id,
                provenance: 'manual_create',
                state: 'revoked',
                expectedVersion: 1,
                correlationId: randomUUID(),
              },
              audit,
            );
            await revoker.query('COMMIT');
            await denied;
            assert.equal(await version(contact.id), 2);
          } finally {
            await revoker.query('ROLLBACK');
            revoker.release();
          }
        },
      );

      await t.test(
        'rollout is an Admin count-only dry-run by default, applies allowlisted proof and preserves revocation',
        async () => {
          const adminInput = {
            actor: { id: ADMIN },
            correlationId: randomUUID(),
          };
          const before = await count('seller_client_links');
          assert.deepEqual(
            await operations.reconcileSellerClients(adminInput),
            { dryRun: true, candidates: 0, linked: 0 },
          );
          assert.deepEqual(
            await operations.reconcileSellerClients({
              ...adminInput,
              apply: true,
            }),
            { dryRun: false, candidates: 0, linked: 0 },
          );
          assert.equal(await count('seller_client_links'), before);
          await assert.rejects(
            operations.reconcileSellerClients({
              actor: { id: A },
              correlationId: randomUUID(),
            }),
            rejects('FORBIDDEN'),
          );
          const { contact } = await legacy(
            B,
            'RECONCILIATION_PRIVATE_NAME_CANARY',
          );
          const { contact: unproved } = await legacy(
            A,
            'Creator is not portfolio proof',
          );
          const outsider = 'clients-outside-allowlist';
          await pool.query(
            "INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,'$argon2id$synthetic','Synthetic outsider')",
            [outsider, `${outsider}@example.test`],
          );
          await pool.query(
            "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
            [outsider],
          );
          for (const [sequence, contactId, owner] of [
            [200, contact.id, A],
            [201, unproved.id, outsider],
          ]) {
            await pool.query(
              `INSERT INTO crm.orders
            (id,number_sequence,number,conversation_id,contact_id,manual_owner_id,manual_create_key,
             status,fab_code,ficha_envelope,created_by_kind,created_by,created_at,updated_at)
            VALUES($1,$2,$3,NULL,$4,$5,$6,'pendente','SYNTHETIC','{}'::jsonb,'user',$7,now(),now())`,
              [
                `reconciliation-${sequence}`,
                sequence,
                `${sequence}-CRM`,
                contactId,
                owner,
                randomUUID(),
                B,
              ],
            );
          }
          const dryRun = await operations.reconcileSellerClients(adminInput);
          assert.deepEqual(dryRun, { dryRun: true, candidates: 1, linked: 0 });
          assert.doesNotMatch(
            JSON.stringify(dryRun),
            new RegExp(
              `${contact.id}|${unproved.id}|PRIVATE_NAME|reconciliation-200`,
              'u',
            ),
          );
          assert.equal(await count('seller_client_links'), before);
          let transactions = 0;
          const racedDatabase = {
            ...database,
            transaction: async (/** @type {any} */ work) => {
              const result = await withTransaction(pool, work);
              if (++transactions === 1)
                await pool.query(
                  "UPDATE crm.orders SET manual_owner_id=$1 WHERE id='reconciliation-200'",
                  [outsider],
                );
              return result;
            },
          };
          const raced = createOperationReadRuntime(racedDatabase, {
            environment: ENV,
          });
          await assert.rejects(
            raced.reconcileSellerClients({ ...adminInput, apply: true }),
            rejects('CLIENT_LINK_PROVENANCE_INVALID'),
          );
          assert.equal(await count('seller_client_links'), before);
          await pool.query(
            "UPDATE crm.orders SET manual_owner_id=$1 WHERE id='reconciliation-200'",
            [A],
          );
          assert.deepEqual(
            await operations.reconcileSellerClients({
              ...adminInput,
              apply: true,
            }),
            { dryRun: false, candidates: 1, linked: 1 },
          );
          assert.deepEqual(
            await operations.reconcileSellerClients({
              ...adminInput,
              apply: true,
            }),
            { dryRun: false, candidates: 0, linked: 0 },
          );
          assert.equal(
            (
              await operations.listMyClients(
                { q: 'RECONCILIATION_PRIVATE_NAME_CANARY' },
                access(A),
              )
            ).items[0].id,
            contact.id,
          );
          assert.equal(
            (
              await operations.listMyClients(
                { q: 'Creator is not portfolio proof' },
                access(A),
              )
            ).totalCount,
            0,
          );
          await transition(contact.id, A, {
            state: 'revoked',
            expectedVersion: 1,
          });
          assert.deepEqual(
            await operations.reconcileSellerClients({
              ...adminInput,
              apply: true,
            }),
            { dryRun: false, candidates: 0, linked: 0 },
          );
          assert.equal(
            (
              await operations.listMyClients(
                { q: 'RECONCILIATION_PRIVATE_NAME_CANARY' },
                access(A),
              )
            ).totalCount,
            0,
          );
        },
      );

      await t.test(
        'details and manual-create replay share user, phone advisory and Contact lock order without deadlock',
        async () => {
          const createCommand = createInput(A, 'Lock order replay');
          const { contact } = await operations.createContact(createCommand);
          await operations.linkMyClient(linkInput(contact.id, A));
          await operations.linkMyClient(linkInput(contact.id, B));
          /** @param {string} name */
          const namedRuntime = (name) =>
            createOperationReadRuntime(
              {
                ...database,
                transaction: (/** @type {any} */ work) =>
                  withTransaction(pool, async (tx) => {
                    await tx.query(
                      "SELECT set_config('application_name',$1,true)",
                      [name],
                    );
                    return work(tx);
                  }),
              },
              { environment: ENV },
            );
          const blocker = await pool.connect();
          /** @type {Promise<any>[]} */
          const pending = [];
          try {
            await blocker.query('BEGIN');
            await blocker.query(
              'SELECT id FROM crm.contacts WHERE id=$1 FOR UPDATE',
              [contact.id],
            );
            const details = namedRuntime('wap-e03-details-race')
              .setContactDetails({
                actor: { id: B },
                contactId: contact.id,
                expectedVersion: 1,
                phone: contact.phone,
                email: 'lock-order-updated@example.test',
                idempotencyKey: randomUUID(),
                correlationId: randomUUID(),
              })
              .then(
                (value) => ({ ok: true, value }),
                (error) => ({ ok: false, error }),
              );
            pending.push(details);
            await waitForLock(
              'wap-e03-details-race',
              /crm\.contacts[\s\S]*FOR UPDATE/u,
            );
            const replay = namedRuntime('wap-e03-create-race')
              .createContact(createCommand)
              .then(
                (value) => ({ ok: true, value }),
                (error) => ({ ok: false, error }),
              );
            pending.push(replay);
            await waitForLock('wap-e03-create-race', /pg_advisory_xact_lock/u);
            await blocker.query('COMMIT');
            const outcomes = await Promise.all(pending);
            assert.equal(outcomes[0].ok, true);
            assert.equal(
              outcomes[0].value.email,
              'lock-order-updated@example.test',
            );
            if (!outcomes[1].ok)
              assert.equal(outcomes[1].error.code, 'CONTACT_CONFLICT');
            for (const outcome of outcomes)
              assert.notEqual(outcome.error?.code, '40P01');
            assert.equal(await version(contact.id), 2);
            assert.equal(
              (
                await pool.query(
                  'SELECT count(*)::int n FROM crm.contacts WHERE manual_create_key=$1',
                  [createCommand.idempotencyKey],
                )
              ).rows[0].n,
              1,
            );
          } finally {
            await blocker.query('ROLLBACK');
            blocker.release();
            await Promise.all(pending);
          }
        },
      );

      await t.test(
        'editing email via a scoped personal phone fallback never promotes it to a shared principal without Admin review',
        async () => {
          const phoneA = '5511999000061',
            phoneB = '5511999000062';
          const identityA = await personalIdentity(
            await personalAccount(A),
            phoneA,
          );
          const identityB = await personalIdentity(
            await personalAccount(B),
            phoneB,
          );
          const contactId = identityA.contact.id;
          // The common Contact is approved independently of its private channel
          // relationships. This is fixture composition, not a merge endpoint.
          await pool.query(
            'UPDATE crm.contact_identities SET current_contact_id=$1 WHERE id=$2',
            [contactId, identityB.identity.id],
          );
          await transition(contactId, A);
          await transition(contactId, B);
          assert.equal(
            (await operations.getContact({ contactId }, access(A))).contact
              .phone,
            phoneA,
          );
          assert.equal(
            (await operations.getContact({ contactId }, access(B))).contact
              .phone,
            phoneB,
          );
          const updated = await operations.setContactDetails({
            actor: { id: A },
            contactId,
            expectedVersion: 1,
            phone: phoneA,
            email: 'common-email-one@example.test',
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          assert.equal(updated.email, 'common-email-one@example.test');
          const stored = (
            await pool.query(
              'SELECT contact_phone_hash,contact_details_envelope FROM crm.contacts WHERE id=$1',
              [contactId],
            )
          ).rows[0];
          assert.equal(stored.contact_phone_hash, null);
          assert.equal(
            decryptContactDetails(stored.contact_details_envelope, KEY).phone,
            null,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM crm.contact_phone_lookup WHERE contact_id=$1 AND source='manual'",
                [contactId],
              )
            ).rows[0].n,
            0,
          );
          const readerB = await operations.getContact({ contactId }, access(B));
          assert.equal(readerB.contact.phone, phoneB);
          assert.equal(readerB.contact.email, 'common-email-one@example.test');
          assert.doesNotMatch(JSON.stringify(readerB), new RegExp(phoneA, 'u'));
          await operations.setContactDetails({
            actor: { id: B },
            contactId,
            expectedVersion: 2,
            phone: phoneB,
            email: 'common-email-two@example.test',
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          const promoted = await operations.setContactDetails({
            actor: { id: ADMIN },
            contactId,
            expectedVersion: 3,
            phone: phoneA,
            email: 'common-email-two@example.test',
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
            review: {
              confirmed: true,
              reason: 'Synthetic principal phone verification',
            },
          });
          assert.equal(promoted.phone, phoneA);
          const principal = (
            await pool.query(
              'SELECT contact_phone_hash,contact_details_envelope FROM crm.contacts WHERE id=$1',
              [contactId],
            )
          ).rows[0];
          assert.equal(
            principal.contact_phone_hash,
            contactPhoneHash(phoneA, LOOKUP),
          );
          assert.equal(
            decryptContactDetails(principal.contact_details_envelope, KEY)
              .phone,
            phoneA,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM crm.contact_phone_lookup WHERE contact_id=$1 AND source='manual'",
                [contactId],
              )
            ).rows[0].n,
            1,
          );
          const after = await operations.getContact({ contactId }, access(B));
          assert.equal(after.identities.length, 1);
          assert.equal(after.identities[0].externalId, phoneB);
        },
      );

      await t.test(
        'registration completeness never discloses the existence of another personal channel phone',
        async () => {
          const resolved = await personalIdentity(
            await personalAccount(B),
            '5511999000063',
          );
          const contactId = resolved.contact.id;
          await transition(contactId, A);
          await transition(contactId, B);
          await pool.query(
            'UPDATE crm.contacts SET contact_details_envelope=$2::jsonb WHERE id=$1',
            [
              contactId,
              JSON.stringify(
                encryptContactDetails(
                  { phone: null, email: 'completeness@example.test' },
                  KEY,
                ),
              ),
            ],
          );
          const registration = {
            personType: 'individual',
            document: '52998224725',
            legalName: 'Complete synthetic person',
            postalCode: '01310100',
            city: 'Synthetic city',
            state: 'SP',
            street: 'Synthetic street',
            district: 'Synthetic district',
            number: '100',
          };
          const result = await operations.setContactRegistration(
            registrationInput(contactId, A, 1, registration),
          );
          assert.equal(result.registrationStatus, 'incomplete');
          const readerA = await operations.getContact({ contactId }, access(A));
          assert.equal(readerA.contact.phone, null);
          assert.equal(readerA.contact.registrationStatus, 'incomplete');
          const readerB = await operations.getContact({ contactId }, access(B));
          assert.equal(readerB.contact.phone, '5511999000063');
          assert.equal(readerB.contact.registrationStatus, 'complete');
        },
      );

      await t.test(
        'name searches treat underscore, percent and backslash as literal characters in page and count',
        async () => {
          const { contact } = await legacy(A, 'Search literal _ % \\ marker');
          for (const label of [
            'Search literal X % \\ marker',
            'Search literal _ W \\ marker',
            'Search literal _ % / marker',
          ])
            await legacy(A, label);
          const exact = await operations.listContacts(
            { q: 'Search literal _ % \\ marker' },
            access(A),
          );
          assert.equal(exact.totalCount, 1);
          assert.equal(exact.items.length, 1);
          assert.equal(exact.items[0].id, contact.id);
        },
      );

      await t.test(
        'personal channel identity, history and phone lookup stay private on a shared Contact',
        async () => {
          const accountId = await personalAccount(B);
          const phone = '5511999000077';
          const resolved = await personalIdentity(accountId, phone);
          const contactId = resolved.contact.id;
          await pool.query(
            "UPDATE crm.contacts SET display_name='Personal identity canary',display_name_source='manual' WHERE id=$1",
            [contactId],
          );
          await transition(contactId, B);
          await pool.query(
            `INSERT INTO crm.conversations
          (id,contact_identity_id,provider,provider_account_id,external_conversation_id,cycle_number,state,automation_state,assigned_user_id,opened_at,last_message_at)
          VALUES('personal-hidden-conversation',$1,'evolution',$2,'synthetic-external-conversation',1,'em_atendimento','human',$3,now(),now())`,
            [resolved.identity.id, accountId, B],
          );
          assert.equal(
            (
              await operations.listContacts(
                { q: 'Personal identity canary' },
                access(A),
              )
            ).totalCount,
            0,
          );
          assert.equal(
            (await operations.listContacts({ q: phone }, access(A))).totalCount,
            0,
          );
          await assert.rejects(
            operations.getContact({ contactId }, access(A)),
            rejects('CONTACT_NOT_FOUND'),
          );
          await pool.query(
            "INSERT INTO crm.user_capabilities(user_id,capability) VALUES($1,'COMMERCIAL_ADMIN')",
            [A],
          );
          try {
            assert.equal(
              (await operations.listContacts({ q: phone }, access(A)))
                .totalCount,
              0,
            );
            await assert.rejects(
              operations.getContact({ contactId }, access(A)),
              rejects('CONTACT_NOT_FOUND'),
            );
          } finally {
            await pool.query(
              "DELETE FROM crm.user_capabilities WHERE user_id=$1 AND capability='COMMERCIAL_ADMIN'",
              [A],
            );
          }
          await assert.rejects(
            operations.createMyClient({ ...createInput(A), phone }),
            rejects('CONTACT_PHONE_MATCH'),
          );
          // An authorized internal fixture grant models an explicitly approved
          // common Contact, without granting the other account's relationships.
          await transition(contactId, A);
          const shared = await operations.getContact({ contactId }, access(A));
          assert.equal(shared.contact.shared, true);
          assert.deepEqual(shared.identities, []);
          assert.deepEqual(shared.conversations, []);
          assert.equal(shared.contact.phone, null);
          assert.equal(
            (await operations.listContacts({ q: phone }, access(A))).totalCount,
            0,
          );
          const owner = await operations.getContact({ contactId }, access(B));
          assert.equal(owner.identities[0].id, resolved.identity.id);
          assert.equal(
            owner.conversations[0].id,
            'personal-hidden-conversation',
          );
          const admin = await operations.getContact(
            { contactId },
            access(ADMIN),
          );
          assert.equal(admin.identities[0].id, resolved.identity.id);
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
