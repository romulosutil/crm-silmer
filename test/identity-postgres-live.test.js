import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../modules/database/src/index.js';
import { createPostgresIdentityRepository } from '../modules/identity-access/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
/** @param {string} character */
const hash = (character) => character.repeat(64);

if (connectionString) {
  test('PostgreSQL identity repository preserves concurrency and rollback invariants', async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.equal(
      databaseName,
      'crm_silmer_test',
      'live identity test only resets the dedicated crm_silmer_test database',
    );

    const pool = new Pool({ connectionString, max: 8 });
    /**
     * @template T
     * @param {(repository: ReturnType<typeof createPostgresIdentityRepository>) => Promise<T>} work
     */
    const transaction = (work) =>
      withTransaction(pool, (client) =>
        work(createPostgresIdentityRepository(client)),
      );

    try {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await migrate(pool, { migrations: await loadMigrations() });

      /** @type {Array<{
       *   capabilities: Array<'COMMERCIAL_ADMIN'>,
       *   email: string,
       *   functionName: 'Atendimento'|'Vendedor',
       *   id: string,
       *   passwordHash: string,
       * }>} */
      const bootstrapUsers = [
        {
          capabilities: ['COMMERCIAL_ADMIN'],
          email: 'admin-one@example.test',
          functionName: 'Atendimento',
          id: 'admin-one',
          passwordHash: '$argon2id$v=19$fixture-one',
        },
        {
          capabilities: ['COMMERCIAL_ADMIN'],
          email: 'admin-two@example.test',
          functionName: 'Vendedor',
          id: 'admin-two',
          passwordHash: '$argon2id$v=19$fixture-two',
        },
      ];
      const bootstrapResults = await Promise.all(
        bootstrapUsers.map((user) =>
          transaction((repository) => repository.insertInitialUser(user)),
        ),
      );
      assert.deepEqual(bootstrapResults.toSorted(), [false, true]);

      const bootstrapState = await pool.query(
        `SELECT u.id, f.function_name, c.capability
         FROM crm.users AS u
         JOIN crm.user_functions AS f ON f.user_id = u.id
         JOIN crm.user_capabilities AS c ON c.user_id = u.id`,
      );
      assert.equal(bootstrapState.rowCount, 1);
      assert.equal(bootstrapState.rows[0].capability, 'COMMERCIAL_ADMIN');
      const adminId = /** @type {string} */ (bootstrapState.rows[0].id);
      const adminEmail =
        adminId === 'admin-one'
          ? 'admin-one@example.test'
          : 'admin-two@example.test';

      const reader = createPostgresIdentityRepository(pool);
      assert.equal((await reader.findUserById(adminId))?.email, adminEmail);
      await pool.query(
        `UPDATE crm.users SET disabled_at = now() WHERE id = $1`,
        [adminId],
      );
      assert.equal(await reader.findUserByEmail(adminEmail), null);
      await pool.query(
        `UPDATE crm.users SET disabled_at = NULL WHERE id = $1`,
        [adminId],
      );

      const invitationConsumedAt = new Date(Date.now() + 60_000);
      const invitationExpiresAt = new Date(Date.now() + 86_400_000);
      await transaction((repository) =>
        repository.createInvitation({
          createdBy: adminId,
          email: 'invited@example.test',
          expiresAt: invitationExpiresAt,
          functionName: 'Vendedor',
          id: 'invitation-race',
          tokenHash: hash('a'),
        }),
      );
      const invitationResults = await Promise.all(
        Array.from({ length: 2 }, () =>
          transaction((repository) =>
            repository.consumeInvitation(hash('a'), invitationConsumedAt),
          ),
        ),
      );
      assert.equal(invitationResults.filter(Boolean).length, 1);
      assert.equal(
        invitationResults.filter((value) => value === null).length,
        1,
      );

      await transaction((repository) =>
        repository.createInvitation({
          createdBy: adminId,
          email: 'rollback@example.test',
          expiresAt: invitationExpiresAt,
          functionName: 'Atendimento',
          id: 'invitation-rollback',
          tokenHash: hash('b'),
        }),
      );
      const rollbackError = new Error('rollback identity transaction');
      await assert.rejects(
        transaction(async (repository) => {
          const invitation = await repository.consumeInvitation(
            hash('b'),
            invitationConsumedAt,
          );
          assert.ok(invitation);
          await repository.createUser({
            capabilities: [],
            email: invitation.email,
            functionName: invitation.functionName,
            id: 'rolled-back-user',
            passwordHash: '$argon2id$v=19$rollback-fixture',
          });
          throw rollbackError;
        }),
        (error) => error === rollbackError,
      );
      assert.equal(await reader.findUserById('rolled-back-user'), null);
      assert.equal(
        (
          await transaction((repository) =>
            repository.consumeInvitation(
              hash('b'),
              new Date(invitationConsumedAt.getTime() + 60_000),
            ),
          )
        )?.id,
        'invitation-rollback',
      );

      await transaction((repository) =>
        repository.createSession({
          absoluteExpiresAt: '2026-09-01T22:00:00.000Z',
          createdAt: '2026-09-01T10:00:00.000Z',
          csrfHash: hash('c'),
          lastSeenAt: '2026-09-01T10:00:00.000Z',
          mfaVerified: true,
          revokedAt: null,
          tokenHash: hash('d'),
          userId: adminId,
        }),
      );
      assert.equal(
        (
          await transaction((repository) =>
            repository.authenticateSession(
              hash('d'),
              '2026-09-01T10:05:00.000Z',
              '2026-09-01T09:35:00.000Z',
            ),
          )
        )?.lastSeenAt,
        '2026-09-01T10:05:00.000Z',
      );
      assert.equal(
        await transaction((repository) =>
          repository.validateCsrfSession(
            hash('d'),
            hash('0'),
            '2026-09-01T10:06:00.000Z',
            '2026-09-01T09:36:00.000Z',
          ),
        ),
        null,
      );
      assert.equal(
        (await reader.findSession(hash('d')))?.lastSeenAt,
        '2026-09-01T10:05:00.000Z',
      );
      assert.equal(
        (
          await transaction((repository) =>
            repository.validateCsrfSession(
              hash('d'),
              hash('c'),
              '2026-09-01T10:06:00.000Z',
              '2026-09-01T09:36:00.000Z',
            ),
          )
        )?.lastSeenAt,
        '2026-09-01T10:06:00.000Z',
      );
      await transaction((repository) =>
        repository.revokeSession(hash('d'), '2026-09-01T10:07:00.000Z'),
      );
      assert.equal(
        await transaction((repository) =>
          repository.authenticateSession(
            hash('d'),
            '2026-09-01T10:08:00.000Z',
            '2026-09-01T09:38:00.000Z',
          ),
        ),
        null,
      );
      assert.equal(
        (await reader.findSession(hash('d')))?.lastSeenAt,
        '2026-09-01T10:06:00.000Z',
      );

      await transaction((repository) =>
        repository.createSession({
          absoluteExpiresAt: '2026-09-01T22:00:00.000Z',
          createdAt: '2026-09-01T10:00:00.000Z',
          csrfHash: hash('e'),
          lastSeenAt: '2026-09-01T10:00:00.000Z',
          mfaVerified: true,
          revokedAt: null,
          tokenHash: hash('f'),
          userId: adminId,
        }),
      );
      await pool.query(
        `UPDATE crm.users SET disabled_at = now() WHERE id = $1`,
        [adminId],
      );
      assert.equal(
        await transaction((repository) =>
          repository.authenticateSession(
            hash('f'),
            '2026-09-01T10:05:00.000Z',
            '2026-09-01T09:35:00.000Z',
          ),
        ),
        null,
      );
      assert.equal(
        (await reader.findSession(hash('f')))?.lastSeenAt,
        '2026-09-01T10:00:00.000Z',
      );
      await pool.query(
        `UPDATE crm.users SET disabled_at = NULL WHERE id = $1`,
        [adminId],
      );

      const encryptedSecret = {
        authTag: 'auth-tag',
        ciphertext: 'ciphertext-value',
        iv: 'iv-value',
        keyVersion: 1,
      };
      await transaction((repository) =>
        repository.enrollFactor(adminId, {
          encryptedSecret,
          recoveryCodeHashes: [hash('8'), hash('9')],
        }),
      );
      assert.equal(
        (
          await pool.query(
            `SELECT encrypted_secret
             FROM crm.mfa_factors
             WHERE user_id = $1`,
            [adminId],
          )
        ).rows[0].encrypted_secret,
        'v1.iv-value.ciphertext-value.auth-tag',
      );
      const storedFactor = await reader.findFactor(adminId);
      assert.deepEqual(storedFactor?.encryptedSecret, encryptedSecret);
      assert.deepEqual(
        [...(storedFactor?.recoveryCodeHashes ?? [])].toSorted(),
        [hash('8'), hash('9')],
      );

      const recoveryResults = await Promise.all(
        Array.from({ length: 2 }, () =>
          transaction((repository) =>
            repository.consumeRecoveryCode(adminId, hash('8')),
          ),
        ),
      );
      assert.deepEqual(recoveryResults.toSorted(), [false, true]);
      const counterResults = await Promise.all(
        Array.from({ length: 2 }, () =>
          transaction((repository) => repository.useTotpCounter(adminId, 123)),
        ),
      );
      assert.deepEqual(counterResults.toSorted(), [false, true]);
      assert.equal((await reader.findFactor(adminId))?.lastCounter, 123);
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
      await pool.end();
    }
  });
}
