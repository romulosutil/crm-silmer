import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

/** @param {string} path */
async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('documents and exposes a local development workflow with automatic refresh', async () => {
  const [packageJson, guide, dev, seeder, watcher, edgeServer, compose] =
    await Promise.all([
      text('package.json'),
      text('README.md'),
      text('scripts/dev.mjs'),
      text('scripts/seed-dev-users.mjs'),
      text('scripts/watch-edge.mjs'),
      text('scripts/serve-dev.mjs'),
      text('docker-compose.dev.yml'),
    ]);

  assert.equal(JSON.parse(packageJson).scripts.dev, 'node scripts/dev.mjs');
  assert.equal(
    JSON.parse(packageJson).scripts['dev:down'],
    'docker compose -f docker-compose.dev.yml down',
  );
  assert.match(dev, /--watch/u);
  assert.match(dev, /runMigrations/u);
  assert.match(dev, /startLocalDatabase/u);
  assert.match(dev, /randomBytes/u);
  for (const secret of [
    'IDEMPOTENCY_ENVELOPE_KEY',
    'DEAL_ENVELOPE_KEY',
    'QUALIFICATION_ENVELOPE_KEY',
    'HANDOFF_ENVELOPE_KEY',
    'KANBAN_CURSOR_HMAC_KEY',
  ]) {
    assert.match(dev, new RegExp(`process\\.env\\.${secret}`, 'u'));
  }
  assert.match(dev, /API_ORIGIN/u);
  assert.match(dev, /seedDevelopmentUsers/u);
  assert.match(seeder, /admin@crm-silmer\.local/u);
  assert.match(seeder, /vendedor@crm-silmer\.local/u);
  assert.match(seeder, /'\/api\/v1\/users'/u);
  assert.doesNotMatch(seeder, /invitation/iu);
  assert.match(watcher, /watch\(source, \{ recursive: true \}/u);
  assert.match(edgeServer, /proxyApiRequest/u);
  assert.match(edgeServer, /hostname: apiOrigin\.hostname/u);
  assert.doesNotMatch(edgeServer, /transport\.request\(\s*target/u);
  assert.match(compose, /postgres:17-alpine/u);
  assert.match(compose, /crm-silmer-postgres-data/u);
  assert.match(guide, /npm run dev/u);
  assert.match(guide, /Desenvolvimento!2026/u);
});
