import { randomUUID } from 'node:crypto';
import { createOperationReadRuntime } from '../apps/api/src/operation-runtime.js';
import { createDatabase } from '../modules/database/src/index.js';

// WAP-E03 rollout: offline operator command, dry-run by default. No contact,
// seller, order IDs, URLs or error details are printed.
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--apply') || args.length > 1)
  throw new Error('Use no arguments for dry-run, or --apply');
const database = createDatabase({
  connectionString: process.env.DATABASE_URL ?? '',
  applicationName: 'crm-seller-client-reconciliation',
});
try {
  const operations = createOperationReadRuntime(database);
  const result = await operations.reconcileSellerClients({
    actor: { id: process.env.SELLER_CLIENTS_ROLLOUT_ACTOR_ID ?? '' },
    apply: args.includes('--apply'),
    correlationId: randomUUID(),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write('SELLER_CLIENTS_RECONCILIATION_FAILED\n');
  process.exitCode = 1;
} finally {
  await database.close();
}
