import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

import { createDatabase } from '@crm-silmer/database';
import { hashPassword } from '@crm-silmer/identity-access';

/**
 * Creates a commercial administrator straight in PostgreSQL, deliberately
 * bypassing the HTTP surface: the first administrator must exist before
 * anyone can sign in, and the application offers no public way to make one.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/create-admin.mjs \
 *     --name "Rômulo Sutil" --email romulo@silmer.com.br --password '...'
 */
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    password: { type: 'string' },
  },
});

for (const field of ['name', 'email', 'password']) {
  if (!values[field]?.trim()) {
    throw new Error(`--${field} is required`);
  }
}

const email = values.email.trim();
const name = values.name.trim();

if (!email.includes('@')) {
  throw new Error('--email must contain @');
}

const database = createDatabase({
  applicationName: 'crm-silmer-create-admin',
  connectionString: requireConnectionString(),
  max: 2,
});

try {
  const id = `user-${randomBytes(16).toString('hex')}`;
  const passwordHash = await hashPassword(values.password);

  await database.transaction(async (client) => {
    const existing = await client.query(
      'SELECT id FROM crm.users WHERE lower(email) = lower($1)',
      [email],
    );
    if (existing.rows[0]) {
      throw new Error(`An account already uses ${email}`);
    }
    await client.query(
      `INSERT INTO crm.users (id, email, name, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [id, email, name, passwordHash],
    );
    await client.query(
      `INSERT INTO crm.user_functions (user_id, function_name)
       VALUES ($1, 'Vendedor')`,
      [id],
    );
    await client.query(
      `INSERT INTO crm.user_capabilities (user_id, capability, granted_by)
       VALUES ($1, 'COMMERCIAL_ADMIN', NULL)`,
      [id],
    );
  });

  console.log(JSON.stringify({ email, id, name, status: 'created' }));
} finally {
  await database.close();
}

function requireConnectionString() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return connectionString;
}
