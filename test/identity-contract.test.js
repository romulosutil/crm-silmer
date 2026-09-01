import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const rootUrl = new URL('../', import.meta.url);

/** @param {string} path */
const text = (path) => readFile(new URL(path, rootUrl), 'utf8');

test('OpenAPI publishes every implemented identity route and security control', async () => {
  const [contract, routes] = await Promise.all([
    text('docs/api/openapi.v1.yaml'),
    text('apps/api/src/identity-routes.js'),
  ]);
  for (const path of [
    '/bootstrap/identity',
    '/invitations',
    '/invitations/accept',
    '/sessions',
    '/sessions/current',
    '/mfa/enrollments',
    '/capabilities/{change}',
  ]) {
    assert.match(contract, new RegExp(`^  ${escape(path)}:`, 'mu'));
  }
  for (const path of [
    '/api/v1/bootstrap/identity',
    '/api/v1/invitations',
    '/api/v1/invitations/accept',
    '/api/v1/sessions',
    '/api/v1/sessions/current',
    '/api/v1/mfa/enrollments',
    '/api/v1/capabilities/',
  ]) {
    assert.match(routes, new RegExp(escape(path), 'u'));
  }
  for (const control of [
    'crm_session',
    'X-CSRF-Token',
    'Idempotency-Key',
    'Origin',
    'HttpOnly',
    'SameSite=Lax',
  ]) {
    assert.match(contract, new RegExp(escape(control), 'u'));
  }
});

test('deployment inventory and runbook cover all fail-closed identity secrets', async () => {
  const [environment, topologyText, runbook] = await Promise.all([
    text('.env.example'),
    text('ops/easypanel/topology.json'),
    text('docs/runbooks/identity-access.md'),
  ]);
  const topology = JSON.parse(topologyText);
  const inventory = topology.projects[0].secrets.inventory;
  for (const name of [
    'APP_ORIGIN',
    'IDENTITY_BOOTSTRAP_TOKEN',
    'IDENTITY_ENVELOPE_KEY',
    'IDEMPOTENCY_ENVELOPE_KEY',
    'AUTH_THROTTLE_HMAC_KEY',
  ]) {
    assert.match(environment, new RegExp(`^${name}=$`, 'mu'));
    assert.ok(inventory.includes(name));
    assert.match(runbook, new RegExp(`\`${name}\``, 'u'));
  }
  assert.match(runbook, /T01\.2.*T01\.4/su);
  assert.match(runbook, /TEST_DATABASE_URL/u);
  assert.match(runbook, /rollback/iu);
  assert.doesNotMatch(runbook, /[A-Za-z0-9_-]{43}/u);
});

/** @param {string} value */
function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
