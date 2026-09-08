import assert from 'node:assert/strict';
import test from 'node:test';

import { createServerApi } from '../apps/api/src/server.js';

const CLIENT_ID = 'silmer-n8n';
const SECRET = 'server-automation-secret-with-32-characters';
const environment = Object.freeze({
  CRM_AUTOMATION_CLIENT_ID: CLIENT_ID,
  CRM_AUTOMATION_CLIENT_SECRET: SECRET,
});
const database = Object.freeze({
  query: async () => ({ rows: [] }),
  /**
   * @template T
   * @param {(client: any) => Promise<T>} work
   * @returns {Promise<T>}
   */
  transaction: async (work) => work(database),
});

/** @param {string} clientId @param {string} secret */
function basic(clientId, secret) {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
}

test('wires configured automation authentication into the API instance', async () => {
  const api = createServerApi({
    commercial: {},
    database,
    environment,
    readiness: () => true,
  });

  assert.equal(api.hasDecorator('automationAuth'), true);
  const automationAuth = /** @type {any} */ (api).automationAuth;
  const principal = await automationAuth.authorize({
    action: 'integration.n8n.message.create',
    authorization: basic(CLIENT_ID, SECRET),
    correlationId: 'correlation-server-wiring',
  });
  assert.equal(principal.actor.id, 'AUTOMATION_EXECUTOR');
  await api.close();
});

test('keeps automation disabled when unconfigured and rejects partial secrets', async () => {
  const api = createServerApi({
    commercial: {},
    database,
    environment: {},
    readiness: () => true,
  });
  assert.equal(api.hasDecorator('automationAuth'), false);
  await api.close();

  assert.throws(
    () =>
      createServerApi({
        commercial: {},
        database,
        environment: { CRM_AUTOMATION_CLIENT_ID: CLIENT_ID },
      }),
    /CRM_AUTOMATION_CLIENT_SECRET/u,
  );
});

test('closes a receiver-sensitive database adapter with its receiver intact', async () => {
  const closableDatabase = {
    closed: false,
    async close() {
      this.closed = true;
    },
    query: database.query,
    transaction: database.transaction,
  };
  const api = createServerApi({
    commercial: {},
    database: closableDatabase,
    environment: {},
    readiness: () => true,
  });

  await api.close();
  assert.equal(closableDatabase.closed, true);
});
