import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerOrderCutMapRoutes } from '../apps/api/src/order-cut-map-routes.js';
import { projectCutMap } from '../modules/orders/src/domain/cut-map.js';
import { blankItem } from '../modules/orders/src/domain/ficha.js';

/** @param {number} id @param {number} count @param {string} publico @param {Record<string, any>} [item] */
function order(id, count, publico, item = {}) {
  return /** @type {import('../modules/orders/src/domain/order.js').Order} */ (
    /** @type {unknown} */ ({
      id: `item-${id}`,
      number: `${id}-CRM`,
      numberSequence: id,
      version: 4,
      status: 'confirmado',
      origin: 'atendimento',
      productionStage: 'arte',
      totalPieces: count,
      ficha: {
        summary: { cliente: 'Cliente fora do PDF' },
        items: [
          {
            ...blankItem(),
            tipo: 'All Star',
            cor: 'Branca',
            publico,
            malhas: ['Dry fit'],
            grade: [{ tamanho: 'M', quantidade: count }],
            ...item,
          },
        ],
      },
    })
  );
}

test('CAR-04/05: cuts combine compatible grades by size and keep all four audiences and fabric separate', () => {
  const first = order(6, 7, 'unissex');
  const second = order(9, 7, 'unissex', {
    cor: ' branca ',
    malhas: ['DRY FIT'],
  });
  const map = projectCutMap([
    second,
    order(11, 6, 'feminino'),
    order(12, 9, 'infantil'),
    order(18, 14, 'masculino'),
    order(21, 3, 'unissex', { malhas: ['Algodão'] }),
    order(22, 8, 'unissex', { cor_frente: 'Verde' }),
    first,
    first,
  ]);
  assert.equal(map.total, 54);
  assert.equal(map.groups.length, 6);
  const largestUnisex = map.groups.find(
    ({ audience, total }) => audience === 'unissex' && total === 14,
  );
  assert.deepEqual(largestUnisex?.grade, [{ size: 'M', quantity: 14 }]);
  assert.deepEqual(largestUnisex?.orders, ['6-CRM', '9-CRM']);
  assert.equal(
    map.groups.find(({ audience }) => audience === 'masculino')?.total,
    14,
  );
  assert.equal(
    map.groups.find(({ audience }) => audience === 'feminino')?.total,
    6,
  );
  assert.equal(
    map.groups.find(({ audience }) => audience === 'infantil')?.total,
    9,
  );
  assert.ok(
    map.groups.some((lot) =>
      lot.details.some(({ value }) => value === 'Verde'),
    ),
  );
  assert.equal(JSON.stringify(map).includes('Cliente fora do PDF'), false);
});

test('CAR-05: missing audience, a partial grade and non-cut stages block the entire map', () => {
  const valid = order(6, 7, 'unissex');
  assert.throws(() => projectCutMap([valid, order(8, 4, '')]), {
    code: 'CUT_MAP_INCOMPLETE',
    itemIndex: 0,
    fields: ['publico'],
  });
  assert.throws(() => projectCutMap([{ ...valid, totalPieces: 20 }]), {
    code: 'CUT_MAP_INCOMPLETE',
    fields: ['grade'],
  });
  for (const change of [
    { productionStage: 'pronto' },
    { productionStage: null },
    { status: 'pendente' },
    { origin: 'loja' },
    { isTest: true },
    { deliveredOn: '2026-11-27' },
    { cancelledAt: '2026-11-27' },
  ]) {
    assert.throws(
      () => projectCutMap([{ ...valid, .../** @type {any} */ (change) }]),
      { code: 'CUT_MAP_NOT_ELIGIBLE' },
    );
  }
});

test('CAR-06/08: only a fresh, authorized and successful generation creates history', async (t) => {
  const api = Fastify();
  t.after(() => api.close());
  const selected = [
    order(6, 7, 'unissex', { tipo: '<b>All Star</b>' }),
    order(9, 7, 'masculino'),
  ];
  const actor = { id: 'seller', kind: 'human' };
  let audit = 0;
  let render = 0;
  let blocked = false;
  let revokeDuringRender = false;
  let failRender = false;
  const history = new Map();
  const authorize = async () => {
    if (blocked)
      throw Object.assign(new Error('private'), {
        statusCode: 403,
        code: 'FORBIDDEN',
      });
    return { actor };
  };
  registerOrderCutMapRoutes(
    api,
    {
      authorizeRead: authorize,
      authorizeWrite: async (
        /** @type {{csrfToken?: string}} */ { csrfToken },
      ) => {
        if (csrfToken !== 'synthetic-csrf')
          throw Object.assign(new Error('CSRF'), {
            statusCode: 403,
            code: 'FORBIDDEN',
          });
        return authorize();
      },
      getCutMap: async (/** @type {string[]} */ ids) => {
        const map = projectCutMap(
          selected.filter(({ id }) => ids.includes(id)),
        );
        return {
          ...map,
          orders: map.orders.map((entry) => ({
            ...entry,
            cutMapGeneratedAt: history.get(entry.id)?.[0]?.generatedAt ?? null,
            cutMapGenerationCount: history.get(entry.id)?.length ?? 0,
          })),
        };
      },
      getCutMapHistory: async (/** @type {string} */ orderId) => ({
        items: history.get(orderId) ?? [],
        nextCursor: null,
      }),
      recordCutMapDownload: async (
        /** @type {ReturnType<typeof projectCutMap>} */ map,
      ) => {
        audit += 1;
        for (const { id, version } of map.orders) {
          history.set(id, [
            {
              id: `event-${audit}`,
              generatedAt: '2026-11-27T12:30:00.000Z',
              orderVersion: version,
            },
            ...(history.get(id) ?? []),
          ]);
        }
      },
    },
    () => ({ correlationId: 'synthetic-cut-map' }),
    async (html) => {
      assert.match(html, /&lt;b&gt;All Star&lt;\/b&gt;/u);
      assert.match(html, /Masculino/u);
      assert.doesNotMatch(html, /Cliente fora do PDF|<b>All Star<\/b>/u);
      render += 1;
      if (revokeDuringRender) blocked = true;
      if (failRender) throw new Error('renderer unavailable');
      return Buffer.from('%PDF-1.4 synthetic');
    },
  );
  const url = '/api/v1/orders/cut-map?orders=item-9,item-6';
  const preview = await api.inject(url);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.headers['cache-control'], 'private, no-store');
  const { map, fingerprint } = preview.json();
  assert.deepEqual(
    map.orders.map((/** @type {any} */ entry) => entry.number),
    ['6-CRM', '9-CRM'],
  );
  const pdf = '/api/v1/orders/cut-map/pdf';
  /** @param {string} proof */
  const generate = (proof, regenerate = false) =>
    api.inject({
      method: 'POST',
      url: pdf,
      headers: { 'x-csrf-token': 'synthetic-csrf' },
      payload: { orders: ['item-6', 'item-9'], fingerprint: proof, regenerate },
    });
  assert.equal(
    (await api.inject({ method: 'HEAD', url: pdf })).statusCode,
    404,
  );
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: pdf,
        payload: { orders: ['item-6'], fingerprint },
      })
    ).statusCode,
    403,
  );
  assert.equal(render, 0);
  selected[0].version += 1;
  assert.equal(
    (await generate(fingerprint)).json().error.code,
    'CUT_MAP_STALE',
  );
  selected[0].version -= 1;
  failRender = true;
  assert.equal((await generate(fingerprint)).statusCode, 503);
  assert.equal(audit, 0);
  failRender = false;
  revokeDuringRender = true;
  assert.equal((await generate(fingerprint)).statusCode, 403);
  assert.equal(audit, 0);
  blocked = revokeDuringRender = false;
  const response = await generate(fingerprint);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.equal(audit, 1);
  assert.equal(
    (await generate(fingerprint)).json().error.code,
    'CUT_MAP_STALE',
  );
  const refreshed = (await api.inject(url)).json();
  assert.equal(refreshed.map.orders[0].cutMapGenerationCount, 1);
  assert.equal(
    (await generate(refreshed.fingerprint)).json().error.code,
    'CUT_MAP_ALREADY_GENERATED',
  );
  assert.equal(audit, 1);
  assert.equal((await generate(refreshed.fingerprint, true)).statusCode, 200);
  assert.equal(audit, 2);
  const entries = (
    await api.inject('/api/v1/orders/item-6/cut-map-history')
  ).json().items;
  assert.deepEqual(
    entries.map((/** @type {any} */ entry) => entry.id),
    ['event-2', 'event-1'],
  );
  assert.deepEqual(
    (await api.inject('/api/v1/orders/item-9/cut-map-history')).json().items,
    entries,
  );
  assert.equal(
    (await api.inject('/api/v1/orders/cut-map?orders=')).statusCode,
    400,
  );
});
