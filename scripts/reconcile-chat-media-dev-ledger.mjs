import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

// MERGE-MASTER / MED-06/26: explicit repair of synthetic DEV history only.
// Published master history and all migration SQL remain immutable.
/** @typedef {{version:string,name:string,phase:string,checksum:string,applied_at?:Date}} LedgerRow */
/** @type {ReadonlyArray<readonly [string,string,string,string]>} */
export const chatLedgerMoves = Object.freeze([
  [
    '0030',
    '0033',
    'chat_media_cleanup',
    '5fcbd08d30bd0baccb81c388c85ccc68ce8e969975a21038ad2a339eb8fb14b1',
  ],
  [
    '0029',
    '0032',
    'chat_media_admissions',
    'e077091e7667ab488a033c58e9132f6a09311e3104314b7d2c0a3a4ca90ce8ea',
  ],
  [
    '0028',
    '0031',
    'chat_media_processing',
    'bc5508b797017fab78796a1cd8782045af3c6818bb806eaf030ef6200bd51779',
  ],
  [
    '0027',
    '0030',
    'chat_media',
    'eac97c2f66be5111d448d79c82f622768731986145d3526ab1492f535b0f961e',
  ],
]);

/** @param {string} connectionString */
export function assertLocalDevDatabase(connectionString) {
  const url = new URL(connectionString);
  assert.ok(
    ['postgres:', 'postgresql:'].includes(url.protocol),
    'PostgreSQL required',
  );
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'Local DEV host required',
  );
  assert.equal(url.search, '', 'Connection query overrides are forbidden');
  assert.match(
    url.pathname,
    /^\/(?:crm_silmer_media|crm_silmer_test_merge_[a-z0-9_]+)$/u,
    'Dedicated DEV database required',
  );
}

/** @param {LedgerRow[]} rows */
export function planChatLedgerReconciliation(rows) {
  const byVersion = new Map(rows.map((row) => [row.version, row]));
  assert.equal(byVersion.size, rows.length, 'Duplicate ledger version');
  /** @param {LedgerRow|undefined} row @param {string} name @param {string} checksum */
  const matches = (row, name, checksum) =>
    row?.name === name && row.phase === 'expand' && row.checksum === checksum;
  if (
    chatLedgerMoves.every(([, target, name, checksum]) =>
      matches(byVersion.get(target), name, checksum),
    )
  ) {
    assert.ok(
      !rows.some(
        (row) => Number(row.version) < 30 && row.name.startsWith('chat_media'),
      ),
      'Mixed chat history',
    );
    return [];
  }
  for (const [source, , name, checksum] of chatLedgerMoves) {
    assert.ok(
      matches(byVersion.get(source), name, checksum),
      'DEV chat history does not match approved checksums',
    );
  }
  for (const target of ['0031', '0032', '0033']) {
    assert.ok(!byVersion.has(target), 'Destination version already occupied');
  }
  return chatLedgerMoves.map(([source, target]) => ({ source, target }));
}

/** @param {string} connectionString @param {{apply?:boolean}} [options] */
export async function reconcileChatMediaDevLedger(
  connectionString,
  { apply = false } = {},
) {
  assertLocalDevDatabase(connectionString);
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query('SELECT pg_advisory_xact_lock($1)', [0x43524d53]);
    await client.query(
      'LOCK TABLE crm_meta.schema_migrations IN EXCLUSIVE MODE',
    );
    const before = (
      await client.query(
        'SELECT version,name,phase,checksum,applied_at FROM crm_meta.schema_migrations ORDER BY version',
      )
    ).rows;
    const moves = planChatLedgerReconciliation(before);
    if (apply) {
      for (const { source, target } of moves) {
        /** @type {{rowCount:number|null}} */
        const result = await client.query(
          'UPDATE crm_meta.schema_migrations SET version=$1 WHERE version=$2',
          [target, source],
        );
        assert.equal(result.rowCount, 1, 'Exactly one ledger row must move');
      }
      const after = (
        await client.query(
          'SELECT version,name,phase,checksum,applied_at FROM crm_meta.schema_migrations ORDER BY version',
        )
      ).rows;
      const expected = before
        .map((row) => ({
          ...row,
          version:
            moves.find(({ source }) => source === row.version)?.target ??
            row.version,
        }))
        .sort((a, b) => a.version.localeCompare(b.version));
      assert.deepEqual(after, expected, 'Only ledger versions may change');
      assert.deepEqual(
        planChatLedgerReconciliation(after),
        [],
        'Reconciliation must be idempotent',
      );
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
    return { apply, moves, preservedRows: before.length };
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  assert.ok(
    args.length === 0 || (args.length === 1 && args[0] === '--apply'),
    'Use no arguments for dry-run, or --apply',
  );
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required');
  try {
    console.log(
      JSON.stringify(
        await reconcileChatMediaDevLedger(process.env.DATABASE_URL, {
          apply: args[0] === '--apply',
        }),
      ),
    );
  } catch {
    console.error(
      'DEV ledger reconciliation refused; verify local target and approved migration history.',
    );
    process.exitCode = 1;
  }
}
