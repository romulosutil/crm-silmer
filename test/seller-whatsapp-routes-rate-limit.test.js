import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import * as routes from '../apps/api/src/seller-whatsapp-routes.js';

/** WAP-E12: every personal event of every line is verified from the one n8n
 * egress IP, so ingress/verify gets its own ceiling; the other technical
 * routes keep 60/min. With no service the handler answers 503 after the
 * limiter, so the count needs no database or credentials. */
async function api() {
  const server = Fastify({ logger: false });
  routes.registerSellerWhatsAppRoutes(server, undefined, () => ({
    correlationId: 'synthetic-correlation',
    requestId: 'synthetic-request',
  }));
  await server.ready();
  return server;
}

/** @param {any} server @param {string} url @param {number} count */
async function statuses(server, url, count) {
  const seen = new Map();
  for (let index = 0; index < count; index++) {
    const response = await server.inject({
      method: 'POST',
      url,
      remoteAddress: '203.0.113.10',
      payload: {},
    });
    seen.set(response.statusCode, (seen.get(response.statusCode) ?? 0) + 1);
  }
  return Object.fromEntries(seen);
}

const base = '/api/v1/integrations/n8n/whatsapp-control';

test('WAP-E12: ingress/verify admits more than 60/min from one IP and still limits at 1200', async () => {
  const server = await api();
  try {
    assert.deepEqual(await statuses(server, `${base}/ingress/verify`, 1201), {
      503: 1200,
      429: 1,
    });
    const other = await server.inject({
      method: 'POST',
      url: `${base}/ingress/verify`,
      remoteAddress: '203.0.113.11',
      payload: {},
    });
    assert.equal(other.statusCode, 503);
  } finally {
    await server.close();
  }
});

test('WAP-E12: the other technical WhatsApp control routes keep 60/min', async () => {
  const server = await api();
  try {
    for (const path of ['verify', 'operations', 'results'])
      assert.deepEqual(
        await statuses(server, `${base}/${path}`, 61),
        { 503: 60, 429: 1 },
        path,
      );
  } finally {
    await server.close();
  }
});
