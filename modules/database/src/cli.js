import { Pool } from 'pg';

import { loadMigrations, migrate } from './index.js';

function readPhase() {
  const phaseArgument = process.argv.find((argument) =>
    argument.startsWith('--phase='),
  );
  const value = phaseArgument
    ? phaseArgument.slice('--phase='.length)
    : process.argv.indexOf('--phase') === -1
      ? 'expand'
      : process.argv[process.argv.indexOf('--phase') + 1];
  if (value !== 'expand' && value !== 'contract') {
    throw new Error('Migration phase must be expand or contract');
  }
  return value;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({
  application_name: 'crm-silmer-migrate',
  connectionString,
  max: 2,
});

try {
  const migrations = await loadMigrations();
  const result = await migrate(pool, {
    migrations,
    phase: readPhase(),
  });
  console.log(
    JSON.stringify({
      applied_count: result.applied.length,
      phase: result.phase,
      status: 'ok',
    }),
  );
} finally {
  await pool.end();
}
