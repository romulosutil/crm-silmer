import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { contactPhoneHash } from '@crm-silmer/contacts';
import test from 'node:test';
import { Pool } from 'pg';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { PostgresSellerWhatsAppRepository } from '../modules/inbox-channels/src/adapters/postgres-seller-whatsapp.js';

const url = process.env.TEST_DATABASE_URL;
const KEY = Buffer.alloc(32, 17);
const LOOKUP = Buffer.alloc(32, 29);
const GENERAL = '5511990000099';
const A = 'wap-seller-a';
const B = 'wap-seller-b';
const ADMIN = 'wap-admin';
const FINANCE = 'wap-finance';
const NUMBER = '5511990000001';
/** @param {string} value */
const digest = (value) => contactPhoneHash(value, LOOKUP);
/** @param {string} code */
const rejects = (code) => (/** @type {any} */ error) => error.code === code;

if (!url) {
  test(
    'Seller WhatsApp constraints/races require a dedicated TEST_DATABASE_URL',
    { skip: true },
    () => {},
  );
} else {
  assert.equal(
    new URL(url).pathname,
    '/crm_silmer_test',
    'Only the dedicated synthetic PostgreSQL database can be reset',
  );
  test('WAP-E02 PostgreSQL upgrade, uniqueness, generations and effect fences', async (t) => {
    const pool = new Pool({ connectionString: url, max: 10 });
    const database = {
      query: pool.query.bind(pool),
      transaction: (/** @type {any} */ work) => withTransaction(pool, work),
    };
    let now = new Date('2026-11-16T12:00:00.000Z');
    const options = {
      envelopeKey: KEY,
      lookupKey: LOOKUP,
      enabled: true,
      sellerAllowlist: [A, B, ADMIN],
      generalNumberDigest: digest(GENERAL),
      clock: () => now,
    };
    const repository = new PostgresSellerWhatsAppRepository(database, options);
    /** @param {any} [extra] */
    const submit = (extra = {}) =>
      repository.submit({
        actorId: A,
        action: 'connect',
        expectedNumber: NUMBER,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        ...extra,
      });
    /** @param {any} op @param {string} [action] */
    const envelope = (op, action = op.action) => ({
      operationId: op.id,
      lineId: op.lineId,
      generation: op.generation,
      action,
      reference: op.reference,
    });
    /** @param {any} op @param {any} [fields] */
    async function reserve(op, fields = {}) {
      return repository.reserveControl({
        ...envelope(op, fields.action ?? op.action),
        executionId: 'synthetic-execution',
        ...fields,
      });
    }
    /** @param {any} dispatch @param {any} [fields] */
    async function result(dispatch, fields = {}) {
      return repository.result({
        operationId: dispatch.operationId,
        lineId: dispatch.lineId,
        generation: dispatch.generation,
        resultId: dispatch.resultId,
        effect: dispatch.action,
        outcome: dispatch.action === 'reconcile' ? 'reconciled' : 'succeeded',
        providerState: 'close',
        webhookVerified: true,
        executionId: 'synthetic-execution',
        ...fields,
      });
    }
    /** @param {any} [fields] */
    async function prepared(fields = {}) {
      const created = await submit(fields);
      const dispatch = await reserve(created.operation);
      await result(dispatch);
      const current = await repository.get({ actorId: fields.actorId ?? A });
      return { ...current, dispatch };
    }
    /** @param {any} current @param {any} [fields] */
    const challenge = (current, fields = {}) =>
      repository.beginChallenge({
        actorId: A,
        operationId: current.operation.id,
        expectedVersion: current.line.version,
        generation: current.line.generation,
        mode: 'qr',
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        ...fields,
      });
    async function armed() {
      const current = await prepared();
      const pending = await challenge(current);
      await repository.reserveChallenge(pending);
      await repository.finishChallenge({ ...pending, delivered: true });
      return {
        current: await repository.get({ actorId: A }),
        dispatch: await reserve(current.operation, { action: 'reconcile' }),
      };
    }
    async function reset() {
      await pool.query('TRUNCATE crm.seller_whatsapp_lines CASCADE');
      await pool.query(
        'UPDATE crm.users SET disabled_at=NULL WHERE id=ANY($1::text[])',
        [[A, B, ADMIN, FINANCE]],
      );
      await pool.query(
        "UPDATE crm.user_functions SET function_name=CASE WHEN user_id=$1 THEN 'Financeiro' ELSE 'Vendedor' END WHERE user_id=ANY($2::text[])",
        [FINANCE, [A, B, ADMIN, FINANCE]],
      );
      now = new Date('2026-11-16T12:00:00.000Z');
    }
    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      const migrations = await loadMigrations();
      await migrate(pool, {
        migrations: migrations.filter((m) => m.version < '0077'),
      });
      for (const seller of [A, B, ADMIN, FINANCE]) {
        await pool.query(
          "INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,'$argon2id$v=19$synthetic','Synthetic seller')",
          [seller, `${seller}@example.test`],
        );
        await pool.query(
          'INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,$2)',
          [seller, seller === FINANCE ? 'Financeiro' : 'Vendedor'],
        );
      }
      await pool.query(
        "INSERT INTO crm.user_capabilities(user_id,capability) VALUES($1,'COMMERCIAL_ADMIN')",
        [ADMIN],
      );
      const existingUsers = (
        await pool.query('SELECT id,email FROM crm.users ORDER BY id')
      ).rows;
      const applied = await migrate(pool, { migrations });
      assert.deepEqual(applied.applied, [
        '0077',
        '0078',
        '0079',
        '0080',
        '0082',
        '0083',
        '0084',
      ]);
      assert.deepEqual((await migrate(pool, { migrations })).applied, []);
      assert.deepEqual(
        (await pool.query('SELECT id,email FROM crm.users ORDER BY id')).rows,
        existingUsers,
      );

      await t.test(
        'GET has no effect; disabled control and role guards fail closed',
        async () => {
          await reset();
          assert.equal(
            (await repository.get({ actorId: A })).line.state,
            'not_configured',
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM crm.seller_whatsapp_lines',
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM crm.seller_whatsapp_operations',
              )
            ).rows[0].n,
            0,
          );
          const disabled = new PostgresSellerWhatsAppRepository(database, {
            ...options,
            enabled: false,
          });
          await assert.rejects(
            disabled.submit({
              actorId: A,
              action: 'connect',
              expectedNumber: NUMBER,
              expectedVersion: 0,
              idempotencyKey: randomUUID(),
              correlationId: randomUUID(),
            }),
            rejects('WHATSAPP_CONTROL_DISABLED'),
          );
          await assert.rejects(
            submit({ actorId: FINANCE }),
            rejects('FORBIDDEN'),
          );
          assert.throws(
            () =>
              new PostgresSellerWhatsAppRepository(database, {
                ...options,
                generalNumberDigest: undefined,
              }),
          );
          const noAllowlist = new PostgresSellerWhatsAppRepository(database, {
            ...options,
            sellerAllowlist: [],
          });
          await assert.rejects(
            noAllowlist.submit({
              actorId: A,
              action: 'connect',
              expectedNumber: NUMBER,
              expectedVersion: 0,
              idempotencyKey: randomUUID(),
              correlationId: randomUUID(),
            }),
            rejects('WHATSAPP_CONTROL_DISABLED'),
          );
        },
      );

      await t.test(
        'two tabs reserve exactly one line, operation and metadata-only job',
        async () => {
          await reset();
          const attempts = await Promise.allSettled([submit(), submit()]);
          assert.equal(
            attempts.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            attempts.filter((r) => r.status === 'rejected').length,
            1,
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM crm.seller_whatsapp_lines',
              )
            ).rows[0].n,
            1,
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM crm.seller_whatsapp_operations',
              )
            ).rows[0].n,
            1,
          );
          const jobs = (
            await pool.query(
              "SELECT * FROM crm.outbox_jobs WHERE job_type='whatsapp.control.deliver'",
            )
          ).rows;
          assert.equal(jobs.length, 1);
          assert.equal(jobs[0].max_attempts, 1);
          assert.equal(jobs[0].effect_policy, 'manual');
          assert.equal(JSON.stringify(jobs).includes(NUMBER), false);
        },
      );

      await t.test(
        'two PostgreSQL transactions cannot reserve the same normalized number',
        async () => {
          await reset();
          const attempts = await Promise.allSettled([
            submit(),
            submit({ actorId: B, expectedNumber: `+${NUMBER}` }),
          ]);
          assert.equal(
            attempts.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          const failure = attempts.find((r) => r.status === 'rejected');
          assert.equal(
            /** @type {any} */ (failure).reason.code,
            'WHATSAPP_LINE_CONFLICT',
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.whatsapp_number_reservations WHERE kind='personal'",
              )
            ).rows[0].n,
            1,
          );
        },
      );

      await t.test(
        'general number conflict and durable disconnected reservation',
        async () => {
          await reset();
          await assert.rejects(
            submit({ expectedNumber: GENERAL }),
            rejects('WHATSAPP_LINE_CONFLICT'),
          );
          const current = await prepared();
          const disconnected = await repository.submit({
            actorId: A,
            action: 'disconnect',
            expectedVersion: current.line.version,
            expectedGeneration: current.line.generation,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          const dispatch = await reserve(disconnected.operation);
          await result(dispatch);
          assert.equal(
            (await repository.get({ actorId: A })).line.state,
            'disconnected',
          );
          await assert.rejects(
            submit({ actorId: B }),
            rejects('WHATSAPP_LINE_CONFLICT'),
          );
          const own = await repository.get({ actorId: A });
          await assert.rejects(
            submit({
              expectedNumber: '5511990000002',
              expectedVersion: own.line.version,
            }),
            rejects('WHATSAPP_LINE_CONFLICT'),
          );
        },
      );

      await t.test(
        'WAP-E12 reconnects the stored number without retyping it; first connection still needs one',
        async () => {
          await reset();
          // First connection without a number is a malformed request.
          await assert.rejects(
            submit({ expectedNumber: undefined }),
            (/** @type {any} */ error) =>
              error.code === 'INVALID_REQUEST' && error.statusCode === 400,
          );
          assert.equal(
            (await repository.get({ actorId: A })).line.state,
            'not_configured',
          );
          const current = await prepared();
          const disconnected = await repository.submit({
            actorId: A,
            action: 'disconnect',
            expectedVersion: current.line.version,
            expectedGeneration: current.line.generation,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          await result(await reserve(disconnected.operation));
          const own = await repository.get({ actorId: A });
          assert.equal(own.line.state, 'disconnected');
          // A present but different number still conflicts, as before.
          await assert.rejects(
            submit({
              expectedNumber: '5511990000002',
              expectedVersion: own.line.version,
            }),
            rejects('WHATSAPP_LINE_CONFLICT'),
          );
          const key = randomUUID();
          const reconnect = {
            expectedNumber: undefined,
            expectedVersion: own.line.version,
            idempotencyKey: key,
          };
          const reconnected = await submit(reconnect);
          assert.equal(reconnected.line.state, 'preparing');
          assert.equal(reconnected.line.generation, own.line.generation + 1);
          assert.equal(reconnected.line.maskedNumber, own.line.maskedNumber);
          assert.equal(JSON.stringify(reconnected).includes(NUMBER), false);
          // Same key and same body (no number) replays without a new effect.
          assert.equal(
            (await submit(reconnect)).operation.id,
            reconnected.operation.id,
          );
          // Same key with a body that now carries the number is another body.
          await assert.rejects(
            submit({ ...reconnect, expectedNumber: NUMBER }),
            rejects('IDEMPOTENCY_KEY_REUSED'),
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.seller_whatsapp_operations WHERE action='connect' AND idempotency_key=$1",
                [key],
              )
            ).rows[0].n,
            1,
          );
          // n8n still receives the stored number, decrypted only server-side.
          const dispatch = await reserve(reconnected.operation);
          assert.equal(dispatch.expectedNumber, NUMBER);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.whatsapp_number_reservations WHERE kind='personal'",
              )
            ).rows[0].n,
            1,
          );
        },
      );

      await t.test(
        'idempotent replay revalidates current actor, conflicts on changed body and never dispatches twice',
        async () => {
          await reset();
          const key = randomUUID();
          const created = await submit({ idempotencyKey: key });
          assert.equal(
            (await submit({ idempotencyKey: key })).operation.id,
            created.operation.id,
          );
          await assert.rejects(
            submit({ idempotencyKey: key, expectedNumber: '5511990000002' }),
            rejects('IDEMPOTENCY_KEY_REUSED'),
          );
          const e = envelope(created.operation);
          assert.deepEqual(
            await repository.verifyEnvelope({ kind: 'control', envelope: e }),
            e,
          );
          await reserve(created.operation);
          await assert.rejects(
            reserve(created.operation),
            rejects('WHATSAPP_OPERATION_UNCERTAIN'),
          );
          await pool.query(
            'UPDATE crm.users SET disabled_at=now() WHERE id=$1',
            [A],
          );
          await assert.rejects(
            submit({ idempotencyKey: key }),
            rejects('FORBIDDEN'),
          );
          assert.equal(
            (await pool.query('SELECT state FROM crm.seller_whatsapp_lines'))
              .rows[0].state,
            'blocked',
          );
        },
      );

      await t.test(
        'binding is immutable and validates account, instance, token and original generation',
        async () => {
          await reset();
          const created = await submit();
          const dispatch = await reserve(created.operation);
          const bindingInput = {
            source: dispatch.source,
            instance: dispatch.instanceName,
            token: dispatch.generationToken,
          };
          assert.deepEqual(await repository.verifyIngress(bindingInput), {
            source: dispatch.source,
            instance: dispatch.instanceName,
          });
          await assert.rejects(
            repository.verifyIngress({
              ...bindingInput,
              token: 'z'.repeat(43),
            }),
            rejects('FORBIDDEN'),
          );
          await assert.rejects(
            repository.verifyIngress({
              ...bindingInput,
              instance: 'wap_other',
            }),
            rejects('FORBIDDEN'),
          );
          await assert.rejects(
            repository.verifyIngress({
              ...bindingInput,
              source: { ...dispatch.source, accountId: randomUUID() },
            }),
            rejects('FORBIDDEN'),
          );
          await assert.rejects(
            pool.query(
              'UPDATE crm.seller_whatsapp_bindings SET generation=generation+1 WHERE id=$1',
              [dispatch.source.bindingId],
            ),
          );
          await result(dispatch);
          const current = await repository.get({ actorId: A });
          await repository.submit({
            actorId: A,
            action: 'disconnect',
            expectedVersion: current.line.version,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          await assert.rejects(
            repository.verifyIngress(bindingInput),
            rejects('FORBIDDEN'),
          );
        },
      );

      await t.test(
        'activation requires verified number and webhook, not browser input or provider open alone',
        async () => {
          await reset();
          const created = await submit();
          const dispatch = await reserve(created.operation);
          await assert.rejects(
            result({ ...dispatch, resultId: randomUUID() }),
            rejects('FORBIDDEN'),
          );
          await assert.rejects(
            result(dispatch, { executionId: 'another-execution' }),
            rejects('FORBIDDEN'),
          );
          await result(dispatch, {
            providerState: 'open',
            confirmedNumber: '5511990000002',
          });
          assert.equal(
            (await repository.get({ actorId: A })).line.state,
            'blocked',
          );
          await reset();
          const second = await submit();
          const secondDispatch = await reserve(second.operation);
          await result(secondDispatch, {
            providerState: 'open',
            confirmedNumber: NUMBER,
            webhookVerified: false,
          });
          assert.equal(
            (await repository.get({ actorId: A })).line.state,
            'blocked',
          );
          await reset();
          const third = await armed();
          const thirdDispatch = third.dispatch;
          const receipt = await result(thirdDispatch, {
            providerState: 'open',
            confirmedNumber: NUMBER,
            bindingVerified: true,
          });
          assert.equal(receipt.stale, false);
          assert.equal(
            (await repository.get({ actorId: A })).line.state,
            'connected',
          );
          assert.equal(
            (
              await result(thirdDispatch, {
                providerState: 'open',
                confirmedNumber: NUMBER,
                bindingVerified: true,
              })
            ).duplicate,
            true,
          );
          await assert.rejects(
            result(thirdDispatch, { providerState: 'close' }),
            rejects('IDEMPOTENCY_KEY_REUSED'),
          );
        },
      );

      await t.test(
        'old callback cannot restore a disconnected generation; inactive effects keep a metadata receipt',
        async () => {
          await reset();
          const current = await prepared();
          const oldRead = await reserve(current.operation, {
            action: 'reconcile',
          });
          const disconnected = await repository.submit({
            actorId: A,
            action: 'disconnect',
            expectedVersion: current.line.version,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          assert.equal(
            (
              await result(oldRead, {
                providerState: 'open',
                confirmedNumber: NUMBER,
              })
            ).stale,
            true,
          );
          const state = await repository.get({ actorId: A });
          assert.equal(state.line.generation, disconnected.line.generation);
          assert.equal(state.line.state, 'disconnecting');
          const disconnectDispatch = await reserve(disconnected.operation);
          await pool.query(
            'UPDATE crm.users SET disabled_at=now() WHERE id=$1',
            [A],
          );
          assert.equal((await result(disconnectDispatch)).stale, true);
          assert.equal(
            (await pool.query('SELECT state FROM crm.seller_whatsapp_lines'))
              .rows[0].state,
            'blocked',
          );
        },
      );

      await t.test(
        'uncertain connect only permits read reconciliation and preserves its instance/account',
        async () => {
          await reset();
          const created = await submit();
          const dispatch = await reserve(created.operation);
          await repository.markUnknown(created.operation.id);
          const unknown = await repository.get({ actorId: A });
          assert.equal(unknown.line.state, 'unknown');
          await assert.rejects(
            submit({ expectedVersion: unknown.line.version }),
            rejects('WHATSAPP_OPERATION_UNCERTAIN'),
          );
          await assert.rejects(
            reserve(created.operation),
            rejects('WHATSAPP_OPERATION_UNCERTAIN'),
          );
          const read = await reserve(created.operation, {
            action: 'reconcile',
          });
          assert.equal(read.instanceName, dispatch.instanceName);
          assert.equal(read.source.accountId, dispatch.source.accountId);
          await result(read, { providerState: 'connecting' });
          const resolved = await repository.get({ actorId: A });
          assert.equal(resolved.line.state, 'awaiting_pairing');
          assert.equal(resolved.operation.state, 'reconciled');
        },
      );

      await t.test(
        'challenge races/replay, owner isolation and expiry never regenerate a secret',
        async () => {
          await reset();
          const current = await prepared();
          const key = randomUUID();
          const pending = await challenge(current, { idempotencyKey: key });
          await assert.rejects(
            challenge(current, { idempotencyKey: key }),
            rejects('WHATSAPP_CHALLENGE_REPLAY'),
          );
          await assert.rejects(challenge(current), rejects('VERSION_CONFLICT'));
          await assert.rejects(
            challenge(current, { actorId: ADMIN }),
            rejects('WHATSAPP_LINE_NOT_FOUND'),
          );
          const authoritative = {
            operationId: pending.operationId,
            lineId: pending.lineId,
            generation: pending.generation,
            challengeId: pending.challengeId,
            mode: pending.mode,
            reference: pending.reference,
          };
          assert.deepEqual(
            await repository.verifyEnvelope({
              kind: 'challenge',
              envelope: authoritative,
            }),
            authoritative,
          );
          const reserved = await repository.reserveChallenge(authoritative);
          assert.equal(reserved.challengeId, pending.challengeId);
          await assert.rejects(
            repository.reserveChallenge(authoritative),
            rejects('WHATSAPP_OPERATION_UNCERTAIN'),
          );
          now = new Date(now.getTime() + 60_001);
          const finished = await repository.finishChallenge({
            operationId: pending.operationId,
            challengeId: pending.challengeId,
            generation: pending.generation,
            delivered: true,
          });
          assert.equal(finished.deliverable, false);
          const currentState = await repository.get({ actorId: A });
          await assert.rejects(
            challenge(currentState, { renewChallengeId: pending.challengeId }),
            rejects('WHATSAPP_OPERATION_UNCERTAIN'),
          );
        },
      );

      await t.test(
        'challenge timeout requires reconciliation; explicit versioned renewal invalidates the previous challenge',
        async () => {
          await reset();
          const current = await prepared();
          const pending = await challenge(current);
          await repository.reserveChallenge(pending);
          assert.equal(
            (
              await repository.finishChallenge({
                operationId: pending.operationId,
                challengeId: pending.challengeId,
                generation: pending.generation,
                delivered: false,
                uncertain: true,
              })
            ).deliverable,
            false,
          );
          const unknown = await repository.get({ actorId: A });
          assert.equal(unknown.line.state, 'unknown');
          await assert.rejects(
            challenge(unknown, { renewChallengeId: pending.challengeId }),
            rejects('WHATSAPP_OPERATION_UNCERTAIN'),
          );
          const read = await reserve(current.operation, {
            action: 'reconcile',
          });
          await result(read, { providerState: 'connecting' });
          const resolved = await repository.get({ actorId: A });
          await assert.rejects(
            challenge(resolved),
            rejects('WHATSAPP_OPERATION_UNCERTAIN'),
          );
          const renewed = await challenge(resolved, {
            renewChallengeId: pending.challengeId,
          });
          assert.notEqual(renewed.challengeId, pending.challengeId);
          assert.equal(
            (
              await pool.query(
                'SELECT state FROM crm.seller_whatsapp_challenges WHERE id=$1',
                [pending.challengeId],
              )
            ).rows[0].state,
            'revoked',
          );
          assert.equal(
            (await repository.reserveChallenge(renewed)).renewal,
            true,
          );
          await pool.query(
            'UPDATE crm.users SET disabled_at=now() WHERE id=$1',
            [A],
          );
          const discarded = await repository.finishChallenge({
            operationId: renewed.operationId,
            challengeId: renewed.challengeId,
            generation: renewed.generation,
            delivered: true,
          });
          assert.equal(discarded.deliverable, false);
        },
      );

      await t.test(
        'a reconcile observing no change keeps the line version and the shown challenge; real changes still bump',
        async () => {
          await reset();
          /** @param {string} challengeId */
          const challengeRow = async (challengeId) =>
            (
              await pool.query(
                'SELECT state,expires_at FROM crm.seller_whatsapp_challenges WHERE id=$1',
                [challengeId],
              )
            ).rows[0];
          const current = await prepared();
          const pending = await challenge(current);
          await repository.reserveChallenge(pending);
          const finished = await repository.finishChallenge({
            ...pending,
            delivered: true,
          });
          assert.equal(finished.deliverable, true);
          const shown = await repository.get({ actorId: A });
          assert.equal(shown.line.state, 'awaiting_pairing');
          assert.equal(shown.line.version, pending.version);
          const before = await challengeRow(pending.challengeId);
          // finishChallenge queues a read at once; the provider still pairs.
          const first = await reserve(current.operation, {
            action: 'reconcile',
          });
          await result(first, { providerState: 'connecting' });
          const afterFirst = await repository.get({ actorId: A });
          assert.equal(afterFirst.line.state, 'awaiting_pairing');
          assert.equal(afterFirst.line.version, shown.line.version);
          assert.equal(afterFirst.line.generation, shown.line.generation);
          const resolved = await challengeRow(pending.challengeId);
          assert.equal(resolved.state, 'resolved');
          assert.equal(
            new Date(resolved.expires_at).getTime(),
            new Date(before.expires_at).getTime(),
          );
          // A later sweep read observing the same pairing is also a no-op.
          await pool.query(
            "UPDATE crm.outbox_jobs SET status='completed',completed_at=now() WHERE whatsapp_operation_id=$1",
            [current.operation.id],
          );
          now = new Date(now.getTime() + 31_000);
          assert.equal(
            (await repository.scheduleReconciliations()).scheduled,
            1,
          );
          const swept = await reserve(current.operation, {
            action: 'reconcile',
          });
          await result(swept, { providerState: 'connecting' });
          const afterSweep = await repository.get({ actorId: A });
          assert.equal(afterSweep.line.state, 'awaiting_pairing');
          assert.equal(afterSweep.line.version, shown.line.version);
          assert.equal(
            (await challengeRow(pending.challengeId)).state,
            'resolved',
          );
          // The unchanged version is still the one a renewal must present.
          const renewed = await challenge(afterSweep, {
            renewChallengeId: pending.challengeId,
          });
          assert.equal(renewed.version, shown.line.version + 1);
          await repository.reserveChallenge(renewed);
          await repository.finishChallenge({ ...renewed, delivered: true });
          // Connected is a real change and bumps.
          const open = await reserve(current.operation, {
            action: 'reconcile',
          });
          await result(open, {
            providerState: 'open',
            confirmedNumber: NUMBER,
            bindingVerified: true,
          });
          const connected = await repository.get({ actorId: A });
          assert.equal(connected.line.state, 'connected');
          assert.equal(connected.line.version, renewed.version + 1);

          // A wrong number observed while pairing blocks and bumps.
          await reset();
          const wrong = await armed();
          await result(wrong.dispatch, {
            providerState: 'open',
            confirmedNumber: '5511990000002',
            bindingVerified: true,
          });
          const blocked = await repository.get({ actorId: A });
          assert.equal(blocked.line.state, 'blocked');
          assert.equal(blocked.line.version, wrong.current.line.version + 1);

          // A provider that dropped the pairing disconnects and bumps.
          await reset();
          const dropped = await armed();
          await result(dropped.dispatch, { providerState: 'close' });
          const lost = await repository.get({ actorId: A });
          assert.equal(lost.line.state, 'disconnected');
          assert.equal(lost.line.version, dropped.current.line.version + 1);

          // A seller disconnect while pairing still bumps through submit.
          await reset();
          const paired = await armed();
          await result(paired.dispatch, { providerState: 'connecting' });
          const still = await repository.get({ actorId: A });
          assert.equal(still.line.version, paired.current.line.version);
          const leaving = await repository.submit({
            actorId: A,
            action: 'disconnect',
            expectedVersion: still.line.version,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          assert.equal(leaving.line.version, still.line.version + 1);
        },
      );

      await t.test(
        'GET exposes only the latest challenge metadata; a reloaded client renews with it once reconciled',
        async () => {
          await reset();
          const current = await prepared();
          assert.equal(current.challenge, null);
          const pending = await challenge(current);
          /** @param {any} view */
          const metadata = (view) => {
            assert.deepEqual(Object.keys(view.challenge).sort(), [
              'expiresAt',
              'id',
              'state',
            ]);
            return view.challenge;
          };
          assert.deepEqual(metadata(await repository.get({ actorId: A })), {
            id: pending.challengeId,
            state: 'reserved',
            expiresAt: pending.expiresAt,
          });
          await repository.reserveChallenge(pending);
          await repository.finishChallenge({ ...pending, delivered: true });
          // The tab that showed the QR is gone; a reload knows only the GET.
          now = new Date(now.getTime() + 61_000);
          const reloaded = await repository.get({ actorId: A });
          assert.equal(reloaded.line.state, 'awaiting_pairing');
          assert.equal(metadata(reloaded).id, pending.challengeId);
          assert.equal(reloaded.challenge.state, 'delivered');
          // Expired but not yet confirmed by a read: still uncertain.
          await assert.rejects(
            challenge(reloaded, { renewChallengeId: reloaded.challenge.id }),
            rejects('WHATSAPP_OPERATION_UNCERTAIN'),
          );
          // The read queued by finishChallenge was lost; the sweep re-queues it.
          await pool.query(
            "UPDATE crm.outbox_jobs SET status='completed',completed_at=now() WHERE whatsapp_operation_id=$1",
            [current.operation.id],
          );
          assert.equal(
            (await repository.scheduleReconciliations()).scheduled,
            1,
          );
          await result(
            await reserve(current.operation, { action: 'reconcile' }),
            { providerState: 'connecting' },
          );
          const confirmed = await repository.get({ actorId: A });
          assert.deepEqual(metadata(confirmed), {
            id: pending.challengeId,
            state: 'resolved',
            expiresAt: pending.expiresAt,
          });
          // Without the id from the GET the renewal is still refused.
          await assert.rejects(
            challenge(confirmed),
            rejects('WHATSAPP_OPERATION_UNCERTAIN'),
          );
          const renewed = await challenge(confirmed, {
            renewChallengeId: confirmed.challenge.id,
          });
          const after = await repository.get({ actorId: A });
          assert.equal(metadata(after).id, renewed.challengeId);
          assert.equal(after.challenge.state, 'reserved');
          // Another seller never sees this seller's challenge metadata.
          assert.equal((await repository.get({ actorId: B })).challenge, null);
          // A new generation starts without challenge metadata.
          const leaving = await repository.submit({
            actorId: A,
            action: 'disconnect',
            expectedVersion: after.line.version,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          assert.equal(
            (await repository.get({ actorId: A })).line.generation,
            leaving.line.generation,
          );
          assert.equal((await repository.get({ actorId: A })).challenge, null);
        },
      );

      await t.test(
        'disconnect cancels an unreserved connect before its effect fence',
        async () => {
          await reset();
          const created = await submit();
          const disconnected = await repository.submit({
            actorId: A,
            action: 'disconnect',
            expectedVersion: created.line.version,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          assert.equal(
            disconnected.line.generation,
            created.line.generation + 1,
          );
          assert.equal(disconnected.line.state, 'disconnecting');
          assert.equal(
            (
              await pool.query(
                'SELECT state FROM crm.seller_whatsapp_operations WHERE id=$1',
                [created.operation.id],
              )
            ).rows[0].state,
            'failed_before_effect',
          );
          await assert.rejects(
            repository.loadDelivery(created.operation.id),
            rejects('WHATSAPP_GENERATION_STALE'),
          );
        },
      );

      await t.test(
        'disconnect revokes an in-flight generation immediately and waits for a read before logout',
        async () => {
          await reset();
          const created = await submit();
          const dispatch = await reserve(created.operation);
          const key = randomUUID();
          const command = {
            actorId: A,
            action: 'disconnect',
            expectedVersion: created.line.version,
            idempotencyKey: key,
            correlationId: randomUUID(),
          };
          const revoked = await repository.submit(command);
          assert.equal(revoked.line.generation, created.line.generation + 1);
          assert.equal(revoked.line.state, 'disconnecting');
          assert.equal(revoked.revocation.state, 'waiting_reconciliation');
          assert.equal(
            (await repository.submit(command)).revocation.id,
            revoked.revocation.id,
          );
          await assert.rejects(
            repository.verifyIngress({
              source: dispatch.source,
              instance: dispatch.instanceName,
              token: dispatch.generationToken,
            }),
            rejects('FORBIDDEN'),
          );
          assert.equal(
            (
              await result(dispatch, {
                providerState: 'open',
                confirmedNumber: NUMBER,
              })
            ).stale,
            true,
          );
          assert.equal(
            (await repository.get({ actorId: A })).line.state,
            'disconnecting',
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.seller_whatsapp_operations WHERE line_id=$1 AND state IN ('pending','dispatching','unknown')",
                [created.line.id],
              )
            ).rows[0].n,
            1,
          );
          const read = await reserve(created.operation, {
            action: 'reconcile',
          });
          await result(read, {
            providerState: 'open',
            confirmedNumber: NUMBER,
          });
          const queued = await repository.get({ actorId: A });
          assert.equal(queued.revocation.state, 'queued');
          assert.equal(queued.operation.action, 'disconnect');
          assert.equal(queued.operation.generation, revoked.line.generation);
          const logout = await reserve(queued.operation);
          await result(logout);
          const complete = await repository.get({ actorId: A });
          assert.equal(complete.line.state, 'disconnected');
          assert.equal(complete.revocation.state, 'completed');
        },
      );

      await t.test(
        'old read receipts in the same generation cannot restore a newer disconnected observation',
        async () => {
          await reset();
          const current = await prepared();
          const oldRead = await reserve(current.operation, {
            action: 'reconcile',
          });
          const newRead = await reserve(current.operation, {
            action: 'reconcile',
          });
          await result(newRead, { providerState: 'close' });
          assert.equal(
            (
              await result(oldRead, {
                providerState: 'open',
                confirmedNumber: NUMBER,
              })
            ).stale,
            true,
          );
          assert.equal(
            (await repository.get({ actorId: A })).line.state,
            'disconnected',
          );
        },
      );

      await t.test(
        'a failed read never proves absence or releases an uncertain connect',
        async () => {
          await reset();
          const current = await submit();
          await reserve(current.operation);
          await repository.markUnknown(current.operation.id);
          const read = await reserve(current.operation, {
            action: 'reconcile',
          });
          await assert.rejects(
            result(read, {
              outcome: 'failed_before_effect',
              providerState: undefined,
            }),
            rejects('INVALID_REQUEST'),
          );
          const unknown = await repository.get({ actorId: A });
          assert.equal(unknown.line.state, 'unknown');
          await assert.rejects(
            submit({ expectedVersion: unknown.line.version }),
            rejects('WHATSAPP_OPERATION_UNCERTAIN'),
          );
        },
      );

      await t.test(
        'disable and reactivation reconcile the revoked old generation before a new connection',
        async () => {
          await reset();
          const created = await submit();
          const original = await reserve(created.operation);
          await pool.query(
            'UPDATE crm.users SET disabled_at=now() WHERE id=$1',
            [A],
          );
          await assert.rejects(
            repository.verifyIngress({
              source: original.source,
              instance: original.instanceName,
              token: original.generationToken,
            }),
            rejects('FORBIDDEN'),
          );
          assert.equal(
            (
              await result(original, {
                providerState: 'open',
                confirmedNumber: NUMBER,
              })
            ).stale,
            true,
          );
          // Cleanup is read-only and may conclude an effect without granting
          // the inactive user a connection, challenge, or mutating dispatch.
          const inactiveRead = await reserve(created.operation, {
            action: 'reconcile',
          });
          await result(inactiveRead, {
            providerState: 'open',
            confirmedNumber: NUMBER,
          });
          assert.equal(
            (await pool.query('SELECT state FROM crm.seller_whatsapp_lines'))
              .rows[0].state,
            'blocked',
          );
          await pool.query(
            'UPDATE crm.users SET disabled_at=NULL WHERE id=$1',
            [A],
          );
          const read = await reserve(created.operation, {
            action: 'reconcile',
          });
          await result(read, { providerState: 'close' });
          const closed = await repository.get({ actorId: A });
          assert.equal(closed.line.state, 'disconnected');
          const next = await submit({ expectedVersion: closed.line.version });
          assert.equal(next.line.generation, closed.line.generation + 1);
          assert.equal(next.line.state, 'preparing');
        },
      );

      await t.test(
        'disconnect waits for an in-flight pairing challenge before preparing a single logout',
        async () => {
          await reset();
          const current = await prepared();
          const pending = await challenge(current);
          await repository.reserveChallenge(pending);
          const before = await repository.get({ actorId: A });
          const revoked = await repository.submit({
            actorId: A,
            action: 'disconnect',
            expectedVersion: before.line.version,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
          });
          assert.equal(revoked.line.state, 'disconnecting');
          assert.equal(revoked.revocation.state, 'waiting_reconciliation');
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.seller_whatsapp_operations WHERE action='disconnect'",
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (await repository.finishChallenge({ ...pending, delivered: true }))
              .deliverable,
            false,
          );
          const read = await reserve(current.operation, {
            action: 'reconcile',
          });
          await result(read, { providerState: 'connecting' });
          const queued = await repository.get({ actorId: A });
          assert.equal(queued.revocation.state, 'queued');
          assert.equal(queued.operation.action, 'disconnect');
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM crm.outbox_jobs WHERE whatsapp_action='disconnect'",
              )
            ).rows[0].n,
            1,
          );
        },
      );

      await t.test(
        'socket binding proof and active DB binding are both required before connected',
        async () => {
          await reset();
          const noSocket = await armed();
          await result(noSocket.dispatch, {
            providerState: 'open',
            confirmedNumber: NUMBER,
            bindingVerified: false,
          });
          assert.equal(
            (await repository.get({ actorId: A })).line.state,
            'blocked',
          );
          const blocked = await repository.get({ actorId: A });
          await assert.rejects(
            submit({ expectedVersion: blocked.line.version }),
            rejects('WHATSAPP_LINE_CONFLICT'),
          );
          await reset();
          const connected = await armed();
          await result(connected.dispatch, {
            providerState: 'open',
            confirmedNumber: NUMBER,
            bindingVerified: true,
          });
          const closeRead = await reserve(connected.current.operation, {
            action: 'reconcile',
          });
          await result(closeRead, { providerState: 'close' });
          assert.equal(
            (await repository.get({ actorId: A })).line.state,
            'disconnected',
          );
          const laterOpen = await reserve(connected.current.operation, {
            action: 'reconcile',
          });
          await result(laterOpen, {
            providerState: 'open',
            confirmedNumber: NUMBER,
            bindingVerified: true,
          });
          assert.equal(
            (await repository.get({ actorId: A })).line.state,
            'blocked',
          );
        },
      );

      await t.test(
        'disable a completed connected line or an in-flight challenge fences reconnection until cleanup',
        async () => {
          for (const connected of [false, true]) {
            await reset();
            const current = await prepared();
            const pending = await challenge(current);
            await repository.reserveChallenge(pending);
            if (connected) {
              await repository.finishChallenge({ ...pending, delivered: true });
              const read = await reserve(current.operation, {
                action: 'reconcile',
              });
              await result(read, {
                providerState: 'open',
                confirmedNumber: NUMBER,
                bindingVerified: true,
              });
              assert.equal(
                (await repository.get({ actorId: A })).line.state,
                'connected',
              );
            }
            await pool.query(
              'UPDATE crm.users SET disabled_at=now() WHERE id=$1',
              [A],
            );
            await pool.query(
              'UPDATE crm.users SET disabled_at=NULL WHERE id=$1',
              [A],
            );
            const revoked = await repository.get({ actorId: A });
            assert.equal(revoked.revocation.state, 'waiting_reconciliation');
            await assert.rejects(
              submit({ expectedVersion: revoked.line.version }),
              rejects('WHATSAPP_OPERATION_UNCERTAIN'),
            );
            const cleanup = await reserve(current.operation, {
              action: 'reconcile',
            });
            await result(cleanup, { providerState: 'close' });
            const closed = await repository.get({ actorId: A });
            const next = await submit({ expectedVersion: closed.line.version });
            assert.equal(next.line.state, 'preparing');
            assert.equal(next.line.generation, closed.line.generation + 1);
          }
        },
      );

      await t.test(
        'SQL lifecycle constraints, inactivation and crash recovery retain no QR/code/raw result',
        async () => {
          await reset();
          const current = await prepared();
          await assert.rejects(
            database.transaction(async (/** @type {any} */ client) => {
              await client.query(
                `INSERT INTO crm.seller_whatsapp_lines
              (id,seller_id,account_id,instance_name,number_digest,number_envelope,state,generation,version,created_at,updated_at)
              SELECT $1,$2,$3,$4,$5,number_envelope,'preparing',1,1,created_at,updated_at
              FROM crm.seller_whatsapp_lines WHERE id=$6`,
                [
                  randomUUID(),
                  B,
                  randomUUID(),
                  `wap_${randomUUID().replaceAll('-', '')}`,
                  digest(GENERAL),
                  current.line.id,
                ],
              );
            }),
          );
          await assert.rejects(
            pool.query(
              'UPDATE crm.seller_whatsapp_lines SET generation=generation-1,version=version+1 WHERE id=$1',
              [current.line.id],
            ),
          );
          await assert.rejects(
            pool.query(
              'DELETE FROM crm.whatsapp_number_reservations WHERE line_id=$1',
              [current.line.id],
            ),
          );
          // PostgreSQL CHECK accepts NULL, so the target guard must explicitly
          // require an action for both personal-control job types.
          for (const [jobType, policy, attempts] of [
            ['whatsapp.control.deliver', 'manual', 1],
            ['whatsapp.control.reconcile', 'queryable', 8],
          ])
            await assert.rejects(
              pool.query(
                `INSERT INTO crm.outbox_jobs
                  (id,job_type,idempotency_key,queue,effect_policy,max_attempts,
                   whatsapp_operation_id,whatsapp_action,available_at,created_at,updated_at)
                 VALUES($1,$2,$1,'whatsapp_control',$3,$4,$5,NULL,now(),now(),now())`,
                [randomUUID(), jobType, policy, attempts, current.operation.id],
              ),
              { code: '23514', constraint: 'outbox_jobs_target_check' },
            );
          const pending = await challenge(current);
          await repository.reserveChallenge(pending);
          now = new Date(now.getTime() + 31_000);
          assert.equal(
            (await repository.scheduleReconciliations()).scheduled,
            1,
          );
          assert.equal(
            (await repository.scheduleReconciliations()).scheduled,
            0,
          );
          const jobs = (
            await pool.query(
              "SELECT * FROM crm.outbox_jobs WHERE job_type='whatsapp.control.reconcile'",
            )
          ).rows;
          assert.equal(jobs.length, 1);
          const persisted = (
            await pool.query(`SELECT table_name,column_name FROM information_schema.columns
          WHERE table_schema='crm' AND table_name IN ('seller_whatsapp_operations','seller_whatsapp_challenges','seller_whatsapp_results','seller_whatsapp_dispatches')`)
          ).rows;
          assert.equal(
            persisted.some((r) =>
              /^(?:payload|qr|code|value|number|token|secret|response|request)$/u.test(
                r.column_name,
              ),
            ),
            false,
          );
          const ledger = (
            await pool.query(
              'SELECT row_to_json(o) AS row FROM crm.seller_whatsapp_operations o',
            )
          ).rows;
          assert.equal(JSON.stringify(ledger).includes(NUMBER), false);
          const number = (
            await pool.query(
              'SELECT number_envelope,confirmed_number_envelope,number_digest FROM crm.seller_whatsapp_lines',
            )
          ).rows[0];
          assert.equal(JSON.stringify(number).includes(NUMBER), false);
          assert.equal(number.number_digest, digest(NUMBER));
          await pool.query(
            "UPDATE crm.user_functions SET function_name='Financeiro' WHERE user_id=$1",
            [A],
          );
          assert.equal(
            (await pool.query('SELECT state FROM crm.seller_whatsapp_lines'))
              .rows[0].state,
            'blocked',
          );
          await assert.rejects(
            repository.get({ actorId: A }),
            rejects('FORBIDDEN'),
          );
        },
      );
    } finally {
      await pool.end();
    }
  });
}
