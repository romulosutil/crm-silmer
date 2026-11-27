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

test('CAR-06/09: PDF and membership share a number, and completed orders cannot enter another map', async (t) => {
  const api = Fastify();
  t.after(() => api.close());
  const selected = [
    order(6, 7, 'unissex', { tipo: '<b>All Star</b>' }),
    order(9, 7, 'masculino'),
    order(11, 4, 'infantil'),
  ];
  const actor = { id: 'seller', kind: 'human' };
  let audit = 0;
  let render = 0;
  let blocked = false;
  let revokeDuringRender = false;
  let failRender = false;
  const history = new Map();
  let reserved = 0;
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
        const orderIds = ids.filter((id) => history.has(id));
        if (orderIds.length)
          throw Object.assign(new Error('mapped'), {
            code: 'CUT_MAP_ALREADY_GENERATED',
            statusCode: 409,
            orderIds,
          });
        return projectCutMap(selected.filter(({ id }) => ids.includes(id)));
      },
      reserveCutMapNumber: async () => String(++reserved),
      recordCutMapDownload: async (
        /** @type {ReturnType<typeof projectCutMap>} */ map,
        /** @type {{ id: string }} */ _actor,
        /** @type {string} */ _correlationId,
        /** @type {string} */ number,
      ) => {
        audit += 1;
        for (const { id } of map.orders) history.set(id, number);
      },
    },
    () => ({ correlationId: 'synthetic-cut-map' }),
    async (html) => {
      if (reserved <= 3) {
        assert.match(html, /&lt;b&gt;All Star&lt;\/b&gt;/u);
        assert.match(html, /Masculino/u);
      }
      assert.ok(html.includes(`<h1>Mapa de corte ${reserved}</h1>`));
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
  /** @param {string} proof @param {string[]} [ids] */
  const generate = (proof, ids = ['item-6', 'item-9']) =>
    api.inject({
      method: 'POST',
      url: pdf,
      headers: { 'x-csrf-token': 'synthetic-csrf' },
      payload: { orders: ids, fingerprint: proof },
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
  assert.equal(response.headers['x-cut-map-number'], '3');
  assert.equal(
    response.headers['content-disposition'],
    'attachment; filename="mapa-de-corte-3.pdf"',
  );
  assert.equal(history.get('item-6'), '3');
  assert.equal(history.get('item-9'), '3');
  assert.equal(audit, 1);
  assert.deepEqual((await generate(fingerprint)).json().error, {
    code: 'CUT_MAP_ALREADY_GENERATED',
    orderIds: ['item-6', 'item-9'],
  });
  assert.deepEqual(
    (await api.inject('/api/v1/orders/cut-map?orders=item-6,item-11')).json()
      .error,
    { code: 'CUT_MAP_ALREADY_GENERATED', orderIds: ['item-6'] },
  );
  assert.equal(audit, 1);
  const next = (
    await api.inject('/api/v1/orders/cut-map?orders=item-11')
  ).json();
  const nextPdf = await generate(next.fingerprint, ['item-11']);
  assert.equal(nextPdf.headers['x-cut-map-number'], '4');
  assert.equal(history.get('item-11'), '4');
  assert.equal(audit, 2);
  assert.equal(
    (await api.inject('/api/v1/orders/cut-map?orders=')).statusCode,
    400,
  );
});
