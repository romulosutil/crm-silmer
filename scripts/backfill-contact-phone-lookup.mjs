import { Pool } from 'pg';

import { backfillContactPhoneLookup } from '../modules/contacts/src/index.js';
import { withTransaction } from '../modules/database/src/index.js';

const args = process.argv.slice(2);
const allowed = new Set(['--apply', '--dry-run']);
for (const arg of args) {
  if (!allowed.has(arg) && !/^--(after|batch-size|max-batches)=/u.test(arg)) {
    throw new Error('Unsupported backfill option');
  }
}
/** @param {string} name */
const option = (name) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const after = option('after') ?? '';
if (after && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(after)) {
  throw new Error('Invalid cursor');
}
/** @param {string} name */
const readKey = (name) => {
  const value = process.env[name];
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value))
    throw new Error('Missing backfill key');
  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32) throw new Error('Invalid backfill key');
  return key;
};
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({
  application_name: 'crm-silmer-phone-backfill',
  connectionString,
  max: 2,
});
let lastCommitted = after;
try {
  const result = await backfillContactPhoneLookup(
    {
      query: pool.query.bind(pool),
      transaction: (
        /** @type {(client: import('pg').PoolClient) => Promise<any>} */ work,
      ) => withTransaction(pool, work),
    },
    {
      after,
      apply: args.includes('--apply'),
      batchSize: Number(option('batch-size') ?? 200),
      envelopeKey: readKey('CONTACT_IDENTITY_ENVELOPE_KEY'),
      lookupKey: readKey('CONTACT_IDENTITY_LOOKUP_KEY'),
      maxBatches: Number(option('max-batches') ?? Number.MAX_SAFE_INTEGER),
      onBatch(progress) {
        lastCommitted = String(progress.after);
        console.log(JSON.stringify({ status: 'batch', ...progress }));
      },
    },
  );
  console.log(JSON.stringify({ status: 'ok', ...result }));
} catch {
  // Errors may contain driver parameters. Only a technical resume cursor is printed.
  console.error(
    JSON.stringify({
      status: 'error',
      code: 'PHONE_BACKFILL_FAILED',
      after: lastCommitted,
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
