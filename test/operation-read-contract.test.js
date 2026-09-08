import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const rootUrl = new URL('../', import.meta.url);

test('documents the authorized Inbox and Contact read contracts', async () => {
  const openapi = await readFile(
    new URL('docs/api/openapi.v1.yaml', rootUrl),
    'utf8',
  );
  for (const operation of [
    'listInboxConversations',
    'getInboxConversation',
    'listContacts',
    'getContact',
  ]) {
    assert.match(openapi, new RegExp(`operationId: ${operation}`, 'u'));
  }
  assert.match(openapi, /security: \[\{ sessionCookie: \[\] \}\]/u);
  assert.match(openapi, /private, no-cache/u);
  assert.match(openapi, /InboxConversationDetail/u);
  assert.match(openapi, /ContactDetail/u);
});

test('ships connected screens without the demonstration dataset', async () => {
  const paths = [
    'apps/edge-web/src/views/DashboardView.vue',
    'apps/edge-web/src/views/InboxView.vue',
    'apps/edge-web/src/views/ClientsView.vue',
  ];
  const screens = await Promise.all(
    paths.map((path) => readFile(new URL(path, rootUrl), 'utf8')),
  );
  assert.match(screens[0], /\/api\/v1\/kanban/u);
  assert.match(screens[0], /\/api\/v1\/inbox\/conversations/u);
  assert.match(screens[1], /\/api\/v1\/inbox\/conversations/u);
  assert.match(screens[2], /\/api\/v1\/contacts/u);
  assert.ok(screens.every((screen) => !screen.includes('demo-crm')));
  await assert.rejects(
    access(new URL('apps/edge-web/src/data/demo-crm.js', rootUrl)),
  );
  const client = await readFile(
    new URL('apps/edge-web/src/lib/api-client.js', rootUrl),
    'utf8',
  );
  assert.match(client, /readCookie\('crm_csrf'\)/u);
});
