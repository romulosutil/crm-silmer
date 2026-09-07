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
