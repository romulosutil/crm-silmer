import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

// Shard 0 runs on the canonical `crm_silmer_test` database and owns every suite
// that asserts an exact `crm_silmer_test` database name.
export const SHARD_0_EXACT_DB = [
  'test/migrations-live.test.js',
  'test/phase1-schema-live.test.js',
  'test/identity-postgres-live.test.js',
  'test/postgres-audit-live.test.js',
  'test/postgres-idempotency-live.test.js',
  'test/identity-api-live.test.js',
  'test/configuration-catalog-postgres-live.test.js',
  'test/postgres-webhook-inbox-live.test.js',
  'test/postgres-job-queue-live.test.js',
  'test/work-management-postgres-live.test.js',
  'test/finance-postgres-live.test.js',
  'test/identity-olist-postgres-live.test.js',
  'test/olist-connection-postgres-live.test.js',
  'test/olist-foundation-postgres-live.test.js',
  'test/olist-upgrade-compat-postgres-live.test.js',
  'test/olist-runtime-postgres-live.test.js',
  'test/orders-source-postgres-live.test.js',
  'test/olist-preview-postgres-live.test.js',
  'test/olist-resource-repository-postgres-live.test.js',
  'test/olist-export-command-repository-postgres-live.test.js',
  'test/olist-export-command-postgres-live.test.js',
  'test/olist-sale-repository-postgres-live.test.js',
  'test/olist-admin-repository-postgres-live.test.js',
  'test/olist-administration-postgres-live.test.js',
  'test/olist-export-invalidation-postgres-live.test.js',
  'test/olist-liveness-worker-postgres-live.test.js',
  'test/order-cancellation-postgres-live.test.js',
  'test/order-olist-guards-postgres-live.test.js',
  'test/olist-post-export-recovery-postgres-live.test.js',
  'test/order-billing-postgres-live.test.js',
  'test/order-billing-chat-postgres-live.test.js',
  'test/inbox-postgres-live.test.js',
  'test/chat-media-bind-postgres-live.test.js',
  'test/chat-media-upload-postgres-live.test.js',
  'test/contact-registration-postgres-live.test.js',
  'test/shipping-postgres-live.test.js',
  'test/health-errors-postgres-live.test.js',
  'test/operational-signals-postgres-live.test.js',
  'test/health-errors-retention.test.js',
  'test/operation-read-postgres-live.test.js',
  'test/seller-whatsapp-postgres-live.test.js',
  'test/seller-whatsapp-control-postgres-live.test.js',
  'test/seller-client-links-postgres-live.test.js',
  'test/seller-clients-postgres-live.test.js',
  'test/seller-client-identity-postgres-live.test.js',
  'test/seller-conversation-access-postgres-live.test.js',
];

// Shards 1 and 2 run on dedicated `crm_silmer_test_s1` and `crm_silmer_test_s2`
// databases in parallel with Shard 0 and with the WAP integration suites.
export const SHARD_1_PARALLEL = [
  'test/orders-postgres-live.test.js',
  'test/store-orders-postgres-live.test.js',
  'test/store-order-correction-postgres-live.test.js',
  'test/n8n-command-store-postgres-live.test.js',
  'test/cancelled-orders-dashboard-postgres-live.test.js',
  'test/cancelled-orders-lead-outcome-postgres-live.test.js',
  'test/cancelled-orders-billing-postgres-live.test.js',
  'test/cancelled-orders-shipping-postgres-live.test.js',
  'test/cancelled-orders-orders-repository-postgres-live.test.js',
  'test/cancelled-orders-n8n-postgres-live.test.js',
  'test/cancelled-orders-inbox-subject-postgres-live.test.js',
  'test/olist-operation-rehearsal-postgres-live.test.js',
];

export const SHARD_2_PARALLEL = [
  'test/order-billing-send-postgres-live.test.js',
  'test/order-billing-completion-postgres-live.test.js',
  'test/order-billing-upgrade-postgres-live.test.js',
  'test/inbound-media-postgres-live.test.js',
  'test/n8n-integration-postgres-live.test.js',
  'test/painel-summary-postgres-live.test.js',
  'test/vendedor-evolucao-postgres-live.test.js',
  'test/order-assistance-postgres-live.test.js',
  'test/dashboard-postgres-live.test.js',
  'test/dashboard-checkpoint-postgres-live.test.js',
  'test/dashboard-metrics-postgres-live.test.js',
  'test/lead-outcome-postgres-live.test.js',
  'test/inbox-buckets-postgres-live.test.js',
  'test/conversation-reminder-postgres-live.test.js',
  'test/seller-whatsapp-inbound-postgres-live.test.js',
  'test/order-subject-postgres-live.test.js',
];

/**
 * @param {string} label
 * @param {string[]} files
 * @param {Record<string, string | undefined>} env
 */
function runNodeTests(label, files, env) {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-concurrency=1', ...files],
      {
        env: { ...process.env, ...env },
        stdio: 'inherit',
      },
    );
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(
        1,
      );
      if (code === 0) {
        console.log(`[postgres-ci] ${label} passed in ${elapsedSeconds}s`);
        resolve(undefined);
      } else {
        reject(
          new Error(
            `[postgres-ci] ${label} failed after ${elapsedSeconds}s (code=${code}, signal=${signal})`,
          ),
        );
      }
    });
  });
}

async function main() {
  const baseUrlString = process.env.TEST_DATABASE_URL;
  if (!baseUrlString) {
    throw new Error('TEST_DATABASE_URL is required');
  }
  const baseUrl = new URL(baseUrlString);
  if (baseUrl.pathname !== '/crm_silmer_test') {
    throw new Error(
      `Expected TEST_DATABASE_URL to target /crm_silmer_test, got ${baseUrl.pathname}`,
    );
  }

  const dbUrlFor = (/** @type {string} */ dbName) => {
    const copy = new URL(baseUrlString);
    copy.pathname = `/${dbName}`;
    return copy.toString();
  };

  const extraDatabases = [
    'crm_silmer_test_s1',
    'crm_silmer_test_s2',
    'crm_silmer_test_wap_e08',
    'crm_silmer_test_wap_e10',
    'crm_silmer_test_e11',
    'crm_silmer_test_e11restore',
    'crm_silmer_test_wap_e12',
  ];

  const adminClient = new Client({ connectionString: baseUrlString });
  await adminClient.connect();
  try {
    for (const dbName of extraDatabases) {
      await adminClient.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await adminClient.query(`CREATE DATABASE ${dbName}`);
    }
  } finally {
    await adminClient.end();
  }

  // Run 4 independent database workers concurrently on the 4-vCPU runner:
  // - Worker A: exact-db suites on crm_silmer_test
  // - Worker B: regex-db shard 1 on crm_silmer_test_s1
  // - Worker C: regex-db shard 2 on crm_silmer_test_s2
  // - Worker D: dedicated WAP E08/E10/E11/E12 integration & recovery drill suites
  await Promise.all([
    runNodeTests('shard-0 (crm_silmer_test)', SHARD_0_EXACT_DB, {
      TEST_DATABASE_URL: dbUrlFor('crm_silmer_test'),
    }),
    runNodeTests('shard-1 (crm_silmer_test_s1)', SHARD_1_PARALLEL, {
      TEST_DATABASE_URL: dbUrlFor('crm_silmer_test_s1'),
    }),
    runNodeTests('shard-2 (crm_silmer_test_s2)', SHARD_2_PARALLEL, {
      TEST_DATABASE_URL: dbUrlFor('crm_silmer_test_s2'),
    }),
    (async () => {
      await runNodeTests(
        'wap-e08 (crm_silmer_test_wap_e08)',
        ['test/integration/seller-whatsapp-outbound.test.js'],
        { TEST_DATABASE_URL: dbUrlFor('crm_silmer_test_wap_e08') },
      );
      await runNodeTests(
        'wap-e10 (crm_silmer_test_wap_e10)',
        ['test/integration/seller-whatsapp-first-send.test.js'],
        { TEST_DATABASE_URL: dbUrlFor('crm_silmer_test_wap_e10') },
      );
      await runNodeTests(
        'wap-e11 (crm_silmer_test_e11)',
        ['test/integration/seller-whatsapp-recovery-drill.test.js'],
        {
          TEST_DATABASE_URL: dbUrlFor('crm_silmer_test_e11'),
          TEST_RESTORE_DATABASE_URL: dbUrlFor('crm_silmer_test_e11restore'),
        },
      );
      await runNodeTests(
        'wap-e12 (crm_silmer_test_wap_e12)',
        ['test/integration/seller-whatsapp-pilot-rehearsal.test.js'],
        { TEST_DATABASE_URL: dbUrlFor('crm_silmer_test_wap_e12') },
      );
    })(),
  ]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
