import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('cloud-dev deploy is commit-based and keeps the CRM and n8n private', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('ops/easypanel/cloud-dev.json', root), 'utf8'),
  );

  assert.equal(manifest.task, 'OPS-1');
  assert.equal(manifest.source.branch, 'dev');
  assert.equal(manifest.source.autoDeploy, true);
  assert.equal(manifest.source.deploymentRule, 'push-to-dev');
  assert.equal(manifest.security.crmApiPublic, false);
  assert.equal(manifest.security.crmDatabasePublic, false);
  assert.equal(manifest.security.n8nEditorPublic, false);
  assert.equal(manifest.security.n8nCrmDatabaseAccess, false);

  const n8n = manifest.services.find(
    /** @param {{ name: string }} service */ (service) =>
      service.name === 'silmer-n8n',
  );
  assert.equal(n8n.public, false);
  assert.equal(
    n8n.imageReference,
    'operator-supplied-approved-version-and-digest',
  );
  assert.deepEqual(n8n.publicPaths, ['/webhook/silmer/dev-mvp-flow']);
  assert.equal(n8n.environment.SILMER_PANEL_BASE_URL, 'http://silmer-api:3000');
});

test('cloud-dev edge proxies only the synthetic n8n webhook', async () => {
  const configuration = await readFile(
    new URL('docker/nginx.cloud-dev.conf', root),
    'utf8',
  );

  assert.match(configuration, /location = \/webhook\/silmer\/dev-mvp-flow/u);
  assert.match(configuration, /http:\/\/silmer-n8n:5678/u);
  assert.doesNotMatch(configuration, /location \/webhook\//u);
});
