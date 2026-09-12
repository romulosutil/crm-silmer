import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('cloud-dev deploy is commit-based and connects the existing schedule-n8n by HTTPS', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('ops/easypanel/cloud-dev.json', root), 'utf8'),
  );

  assert.equal(manifest.task, 'OPS-1');
  assert.equal(manifest.source.branch, 'dev');
  assert.equal(manifest.source.autoDeploy, true);
  assert.equal(manifest.source.deploymentRule, 'push-to-dev');
  assert.equal(manifest.security.crmApiPublic, false);
  assert.equal(manifest.security.crmDatabasePublic, false);
  assert.equal(manifest.security.n8nCrmDatabaseAccess, false);
  assert.equal(manifest.security.n8nUsesCrmPublicApi, true);

  const n8n = manifest.services.find(
    /** @param {{ name: string }} service */ (service) =>
      service.name === 'schedule-n8n',
  );
  assert.equal(n8n.kind, 'external-n8n');
  assert.equal(n8n.managedBy, 'existing-easypanel-service');
  assert.equal(n8n.access, 'public-https-only');
  assert.equal(
    n8n.configuration.panelBaseUrl,
    'operator-supplied-cloud-dev-edge-url',
  );
});

test('cloud-dev edge never proxies public webhooks to a nonexistent private n8n', async () => {
  const configuration = await readFile(
    new URL('docker/nginx.cloud-dev.conf', root),
    'utf8',
  );

  assert.doesNotMatch(configuration, /location \/webhook\//u);
  assert.doesNotMatch(configuration, /silmer-n8n/u);
});
