import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const rootUrl = new URL('../', import.meta.url);

test('OpenAPI publishes the authenticated idempotent conversation conversion', async () => {
  const [contract, routes] = await Promise.all([
    readFile(new URL('docs/api/openapi.v1.yaml', rootUrl), 'utf8'),
    readFile(new URL('apps/api/src/deal-routes.js', rootUrl), 'utf8'),
  ]);
  const operation = contract.match(
    /^  \/conversations\/\{conversationId\}\/convert:[\s\S]+?(?=^components:)/mu,
  )?.[0];
  assert.ok(operation);
  for (const value of [
    'automationBasic',
    'sessionCookie',
    'csrfHeader',
    'idempotencyKey',
    "'201'",
    "'400'",
    "'401'",
    "'403'",
    "'409'",
    "'503'",
  ]) {
    assert.match(operation, new RegExp(value, 'u'));
  }
  assert.match(
    contract,
    /^        expectedVersion: \{ type: integer, minimum: 1 \}$/mu,
  );
  assert.match(contract, /^        automationEpoch:$/mu);
  assert.match(contract, /^          minimum: 0$/mu);
  assert.match(contract, /^    automationBasic:$/mu);
  assert.match(contract, /name: Idempotency-Key/u);
  assert.match(routes, /\/api\/v1\/conversations\/:conversationId\/convert/u);
});

test('OpenAPI publishes one-step Deal transition and human-only loss commands', async () => {
  const [contract, routes] = await Promise.all([
    readFile(new URL('docs/api/openapi.v1.yaml', rootUrl), 'utf8'),
    readFile(new URL('apps/api/src/deal-routes.js', rootUrl), 'utf8'),
  ]);
  const transition = contract.match(
    /^  \/deals\/\{dealId\}\/transitions:[\s\S]+?(?=^  \/deals\/\{dealId\}\/lose:)/mu,
  )?.[0];
  const loss = contract.match(
    /^  \/deals\/\{dealId\}\/lose:[\s\S]+?(?=^  \/deals\/\{dealId\}\/fields:)/mu,
  )?.[0];
  assert.ok(transition);
  assert.ok(loss);
  assert.match(
    contract,
    /direction: \{ type: string, enum: \[advance, retreat\] \}/u,
  );
  assert.doesNotMatch(transition, /targetStage/u);
  assert.match(contract, /^        automationEpoch:$/mu);
  assert.match(contract, /^        conversationId:$/mu);
  assert.match(loss, /sessionCookie/u);
  assert.doesNotMatch(loss, /automationBasic/u);
  assert.match(routes, /\/api\/v1\/deals\/:dealId\/transitions/u);
  assert.match(routes, /\/api\/v1\/deals\/:dealId\/lose/u);
});

test('OpenAPI publishes the closed qualification patch and its dedicated key', async () => {
  const [contract, routes, environment, topology] = await Promise.all([
    readFile(new URL('docs/api/openapi.v1.yaml', rootUrl), 'utf8'),
    readFile(new URL('apps/api/src/deal-routes.js', rootUrl), 'utf8'),
    readFile(new URL('.env.example', rootUrl), 'utf8'),
    readFile(new URL('ops/easypanel/topology.json', rootUrl), 'utf8'),
  ]);
  const patch = contract.match(
    /^  \/deals\/\{dealId\}\/fields:[\s\S]+?(?=^components:)/mu,
  )?.[0];
  assert.ok(patch);
  assert.match(patch, /operationId: patchDealFields/u);
  assert.doesNotMatch(patch, /targetStage/u);
  assert.match(contract, /^    DealFieldsPatchRequest:$/mu);
  assert.match(contract, /required: \[expectedVersion, fields, reasonCode\]/u);
  assert.match(
    contract,
    /operation: \{ type: string, enum: \[upsert, remove\] \}/u,
  );
  assert.match(contract, /required: \[attachmentId, itemId, locationId\]/u);
  assert.match(contract, /required: \[deal, readiness, totalQuantity\]/u);
  assert.match(routes, /api\.patch\('\/api\/v1\/deals\/:dealId\/fields'/u);
  assert.match(environment, /^QUALIFICATION_ENVELOPE_KEY=$/mu);
  assert.ok(
    JSON.parse(topology).projects[0].secrets.inventory.includes(
      'QUALIFICATION_ENVELOPE_KEY',
    ),
  );
});

test('Deal encryption key is inventoried without a versioned value', async () => {
  const [environment, topology, runbook] = await Promise.all([
    readFile(new URL('.env.example', rootUrl), 'utf8'),
    readFile(new URL('ops/easypanel/topology.json', rootUrl), 'utf8'),
    readFile(new URL('docs/runbooks/deals-pipeline.md', rootUrl), 'utf8'),
  ]);
  assert.match(environment, /^DEAL_ENVELOPE_KEY=$/mu);
  assert.ok(
    JSON.parse(topology).projects[0].secrets.inventory.includes(
      'DEAL_ENVELOPE_KEY',
    ),
  );
  assert.match(runbook, /DEAL_ENVELOPE_KEY/u);
  assert.match(runbook, /não prova[\s\S]*provisionado/iu);
});
