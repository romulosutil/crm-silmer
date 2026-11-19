import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import * as routes from '../apps/api/src/seller-whatsapp-routes.js';

/** WAP-E12: every personal event of every line is verified from the one n8n
 * egress IP, so ingress/verify gets its own ceiling per binding (the
 * X-Correlation-Id the route already pins to the bindingId) under an overall
 * per-IP ceiling; the other technical routes keep 60/min. With no service the
 * handler answers 503 after the limiters, so the count needs no database or
 * credentials. */
async function api() {
  const server = Fastify({ logger: false });
  routes.registerSellerWhatsAppRoutes(server, undefined, () => ({
    correlationId: 'synthetic-correlation',
    requestId: 'synthetic-request',
  }));
  await server.ready();
  return server;
}

/** @param {any} server @param {string} url @param {number} count
 * @param {{remoteAddress?:string,headers?:Record<string,string>}} [options] */
async function statuses(server, url, count, options = {}) {
  const seen = new Map();
  for (let index = 0; index < count; index++) {
    const response = await server.inject({
      method: 'POST',
      url,
      remoteAddress: options.remoteAddress ?? '203.0.113.10',
      headers: options.headers ?? {},
      payload: {},
    });
    seen.set(response.statusCode, (seen.get(response.statusCode) ?? 0) + 1);
  }
  return Object.fromEntries(seen);
}

const base = '/api/v1/integrations/n8n/whatsapp-control';
const ingress = `${base}/ingress/verify`;
/** @param {number} n */
const binding = (n) =>
  `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
/** @param {number} n */
const as = (n) => ({ headers: { 'x-correlation-id': binding(n) } });

test('WAP-E12: ingress/verify admits more than 60/min from one IP and still limits at 1200', async () => {
  const server = await api();
  try {
    assert.deepEqual(await statuses(server, ingress, 1201), {
      503: 1200,
      429: 1,
    });
    const other = await server.inject({
      method: 'POST',
      url: ingress,
      remoteAddress: '203.0.113.11',
      payload: {},
    });
    assert.equal(other.statusCode, 503);
  } finally {
    await server.close();
  }
});

test('WAP-E12: each binding gets its own 1200/min and one exhausted binding does not starve another', async () => {
  const server = await api();
  try {
    assert.deepEqual(await statuses(server, ingress, 1210, as(1)), {
      503: 1200,
      429: 10,
    });
    // Same IP, another line: a full budget, untouched by the exhausted one.
    assert.deepEqual(await statuses(server, ingress, 1201, as(2)), {
      503: 1200,
      429: 1,
    });
    // An uppercase spelling is the same binding, not a fresh budget.
    assert.deepEqual(
      await statuses(server, ingress, 1, {
        headers: { 'x-correlation-id': binding(2).toUpperCase() },
      }),
      { 429: 1 },
    );
  } finally {
    await server.close();
  }
});

test('WAP-E12: a missing or invalid correlation header falls back to the shared IP budget', async () => {
  const server = await api();
  try {
    assert.deepEqual(await statuses(server, ingress, 600), { 503: 600 });
    assert.deepEqual(
      await statuses(server, ingress, 600, {
        headers: { 'x-correlation-id': 'not-a-binding' },
      }),
      { 503: 600 },
    );
    assert.deepEqual(await statuses(server, ingress, 1), { 429: 1 });
    assert.deepEqual(
      await statuses(server, ingress, 1, {
        headers: { 'x-correlation-id': 'other-garbage' },
      }),
      { 429: 1 },
    );
    // A real binding still has its own budget beside the exhausted fallback.
    assert.deepEqual(await statuses(server, ingress, 1, as(3)), { 503: 1 });
  } finally {
    await server.close();
  }
});

test('WAP-E12: one IP is capped at 6000/min across bindings; refused requests do not count', async () => {
  const server = await api();
  try {
    assert.deepEqual(await statuses(server, ingress, 1210, as(1)), {
      503: 1200,
      429: 10,
    });
    for (const n of [2, 3, 4, 5])
      assert.deepEqual(
        await statuses(server, ingress, 1200, as(n)),
        { 503: 1200 },
        `binding ${n}`,
      );
    const capped = await server.inject({
      method: 'POST',
      url: ingress,
      remoteAddress: '203.0.113.10',
      ...as(6),
      payload: {},
    });
    assert.equal(capped.statusCode, 429);
    assert.equal(capped.json().code, 'RATE_LIMITED');
    assert.match(String(capped.headers['retry-after']), /^\d+$/u);
    // The ceiling is per IP: another egress keeps its own.
    assert.deepEqual(
      await statuses(server, ingress, 1, {
        ...as(6),
        remoteAddress: '203.0.113.11',
      }),
      { 503: 1 },
    );
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
