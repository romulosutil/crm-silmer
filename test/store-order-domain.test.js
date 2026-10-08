import assert from 'node:assert/strict';
import test from 'node:test';

import { STORE_ACTOR_ID } from '../modules/orders/src/domain/store-catalog.js';
import {
  buildStoreOrder,
  matchStoreCatalog,
  parseStoreOrderRequest,
  requireUnlocked,
} from '../modules/orders/src/domain/store-order.js';
import {
  STORE_DECLARED_AT,
  STORE_NOW,
  STORE_REQUEST_ID,
  storeOrderBody,
} from './fixtures/store-order.js';

/** @param {() => unknown} work @param {number} statusCode @param {string} code */
function refuses(work, statusCode, code) {
  assert.throws(work, (error) => {
    assert.equal(/** @type {any} */ (error).statusCode, statusCode);
    assert.equal(/** @type {any} */ (error).code, code);
    return true;
  });
}

const accept = { acceptTest: true, now: STORE_NOW };

test('LOJ-01: reads the site contract v1 notice as the site sends it', () => {
  const request = parseStoreOrderRequest(storeOrderBody());
  assert.equal(request.requestId, STORE_REQUEST_ID);
  assert.equal(request.test, true);
  assert.deepEqual(request.customer, {
    name: 'Cliente Sintetico da Loja',
    phone: '5527900000001',
  });
  assert.equal(request.declaredAt, STORE_DECLARED_AT);
  assert.equal(request.amountCents, 19364);
  assert.equal(request.item.quantidade, 10);
});

test('LOJ-03: a missing, extra or mistyped key is malformed', () => {
  refuses(() => parseStoreOrderRequest(null), 400, 'corpo_invalido');
  refuses(() => parseStoreOrderRequest([]), 400, 'corpo_invalido');
  for (const change of [
    (/** @type {any} */ body) => delete body.cliente,
    (/** @type {any} */ body) => (body.extra = true),
    (/** @type {any} */ body) => delete body.item.gola,
    (/** @type {any} */ body) => (body.item.preco = 1),
    (/** @type {any} */ body) => (body.item.quantidade = '10'),
    (/** @type {any} */ body) => (body.item.quantidade = 0),
    (/** @type {any} */ body) => (body.valor_centavos = 193.64),
    (/** @type {any} */ body) => (body.teste = 'true'),
    (/** @type {any} */ body) => (body.pagamento.forma = 'cartao'),
    (/** @type {any} */ body) =>
      (body.pagamento.informado_pelo_cliente_em = '08/10/2026'),
    (/** @type {any} */ body) => (body.item.cor = ''),
    (/** @type {any} */ body) => (body.retirada.local = 'x'.repeat(201)),
    (/** @type {any} */ body) => (body.produto.slug = 'a\u0000b'),
  ]) {
    refuses(
      () => parseStoreOrderRequest(storeOrderBody(change)),
      400,
      'corpo_invalido',
    );
  }
});

test('LOJ-03: version, request id, name and phone have their own codes', () => {
  refuses(
    () => parseStoreOrderRequest(storeOrderBody((body) => (body.versao = 1))),
    400,
    'versao_invalida',
  );
  refuses(
    () => parseStoreOrderRequest(storeOrderBody((body) => (body.versao = '2'))),
    400,
    'versao_invalida',
  );
  refuses(
    () =>
      parseStoreOrderRequest(
        storeOrderBody((body) => (body.pedido_id = 'pedido-1')),
      ),
    400,
    'pedido_id_invalido',
  );
  refuses(
    () =>
      parseStoreOrderRequest(
        // A v1 UUID is not what the browser generates.
        storeOrderBody(
          (body) => (body.pedido_id = '5b0c77ed-8c90-16ce-97a4-d5fc1e0a9308'),
        ),
      ),
    400,
    'pedido_id_invalido',
  );
  for (const name of ['A', ' ', 'x'.repeat(81), 'Nome\u0007']) {
    refuses(
      () =>
        parseStoreOrderRequest(
          storeOrderBody((body) => (body.cliente.nome = name)),
        ),
      400,
      'nome_invalido',
    );
  }
  for (const phone of [
    '27900000001',
    '+5527900000001',
    '5507900000001',
    '5527800000001',
    '552790000000',
    5527900000001,
  ]) {
    refuses(
      () =>
        parseStoreOrderRequest(
          storeOrderBody((body) => (body.cliente.telefone = phone)),
        ),
      400,
      'telefone_invalido',
    );
  }
});

test('LOJ-03: the name is kept with its spaces normalized; a landline is a phone', () => {
  const request = parseStoreOrderRequest(
    storeOrderBody((body) => {
      body.cliente.nome = '  Cliente   Sintetico ';
      body.cliente.telefone = '552732000001';
    }),
  );
  assert.equal(request.customer.name, 'Cliente Sintetico');
  assert.equal(request.customer.phone, '552732000001');
});

test('LOJ-04: every colour and size of the site maps to the CRM vocabulary', () => {
  const colours = {
    branca: 'Branco',
    chumbo: 'Grafite/chumbo',
    preta: 'Preto',
  };
  for (const [id, name] of Object.entries(colours)) {
    const request = parseStoreOrderRequest(
      storeOrderBody((body) => {
        body.item.cor_id = id;
        body.item.cor = name;
      }),
    );
    assert.equal(matchStoreCatalog(request, accept).color, name);
  }
  const sizes = {
    eg: 'EG',
    g: 'G',
    gg: 'GG',
    jeg: 'JEGÃO',
    m: 'M',
    p: 'P',
    pp: 'PP',
    xg: 'XG',
    xx: 'XX',
  };
  for (const [id, name] of Object.entries(sizes)) {
    const request = parseStoreOrderRequest(
      storeOrderBody((body) => {
        body.item.tamanho_id = id;
        body.item.tamanho = name;
      }),
    );
    assert.equal(matchStoreCatalog(request, accept).size, name);
  }
});

test('LOJ-04: anything outside the CRM catalog is refused with its code', () => {
  /** @type {Array<[(body: any) => void, string]>} */
  const cases = [
    [(body) => (body.produto.slug = 'camisa-polo'), 'produto_desconhecido'],
    [(body) => (body.produto.slug = 'toString'), 'produto_desconhecido'],
    [(body) => (body.item.cor_id = 'azul'), 'cor_invalida'],
    [(body) => (body.item.cor = 'Branco'), 'cor_invalida'],
    [(body) => (body.item.tamanho_id = 'xgg'), 'tamanho_invalido'],
    [(body) => (body.item.tamanho = 'G'), 'tamanho_invalido'],
    [(body) => (body.item.quantidade = 12), 'quantidade_divergente'],
    [(body) => (body.valor_centavos = 100), 'valor_divergente'],
    [(body) => (body.valor_centavos = 19365), 'valor_divergente'],
    [(body) => (body.produto.nome = 'Camisa Lisa'), 'produto_divergente'],
    [(body) => (body.item.tipo = 'Camisa polo'), 'produto_divergente'],
    [(body) => (body.item.publico = 'feminino'), 'produto_divergente'],
    [(body) => (body.item.malha = 'Helanca light'), 'produto_divergente'],
    [(body) => (body.item.gola = 'Gola V'), 'produto_divergente'],
    [(body) => (body.retirada.local = 'Outra loja'), 'produto_divergente'],
  ];
  for (const [change, code] of cases) {
    const request = parseStoreOrderRequest(storeOrderBody(change));
    refuses(() => matchStoreCatalog(request, accept), 422, code);
  }
});

test('LOJ-05: a test notice is refused only where tests are not accepted', () => {
  const testNotice = parseStoreOrderRequest(storeOrderBody());
  refuses(
    () => matchStoreCatalog(testNotice, { acceptTest: false, now: STORE_NOW }),
    422,
    'teste_recusado',
  );
  const realNotice = parseStoreOrderRequest(
    storeOrderBody((body) => (body.teste = false)),
  );
  assert.ok(
    matchStoreCatalog(realNotice, { acceptTest: false, now: STORE_NOW }),
  );
});

test('LOJ-04: the declared instant must fall from 7 days before to 5 minutes after', () => {
  const at = (/** @type {string} */ instant) =>
    parseStoreOrderRequest(
      storeOrderBody(
        (body) => (body.pagamento.informado_pelo_cliente_em = instant),
      ),
    );
  const now = new Date('2026-10-08T12:00:00.000Z');
  for (const ok of [
    '2026-10-01T12:00:00.000Z',
    '2026-10-08T12:05:00.000Z',
    '2026-10-08T11:59:59Z',
  ]) {
    assert.ok(matchStoreCatalog(at(ok), { acceptTest: true, now }));
  }
  for (const late of ['2026-10-01T11:59:59.999Z', '2026-10-08T12:05:00.001Z']) {
    refuses(
      () => matchStoreCatalog(at(late), { acceptTest: true, now }),
      422,
      'horario_invalido',
    );
  }
});

test('LOJ-06: the store order is born confirmed by the store actor at the catalog price', () => {
  const request = parseStoreOrderRequest(storeOrderBody());
  const order = buildStoreOrder({
    fabCode: '01',
    id: 'order-store-1',
    match: matchStoreCatalog(request, accept),
    now: STORE_NOW,
    request,
  });
  assert.equal(order.status, 'confirmado');
  assert.equal(order.origin, 'loja');
  assert.equal(order.conversationId, null);
  assert.equal(order.confirmedBy, STORE_ACTOR_ID);
  assert.equal(order.createdByKind, 'automation');
  assert.equal(order.finalAmountCents, 19364);
  assert.equal(order.paymentCondition, 'pix');
  assert.equal(order.isTest, true);
  assert.equal(order.totalPieces, 10);
  assert.deepEqual(order.missingFields, []);
  // 02:15 UTC is still the 7th in São Paulo, for both days of the trail.
  assert.equal(order.paidOn, '2026-10-07');
  assert.equal(order.orderDate, '2026-10-07');
  assert.equal(order.paymentDeclaredAt, STORE_DECLARED_AT);
  assert.equal(order.confirmedAt, STORE_NOW.toISOString());
  assert.equal(order.firstContactAt, STORE_NOW.toISOString());
  assert.equal(order.ficha.summary.cliente, 'Cliente Sintetico da Loja');
  assert.deepEqual(order.ficha.loja, {
    informadoPeloClienteEm: STORE_DECLARED_AT,
    produto: {
      nome: 'Camisa Masculina Lisa Dry Fit',
      slug: 'camisa-masculina-lisa',
    },
    retirada:
      'Av. Carlos Lindenberg, 800 — Lojas 05 e 06, Glória, Vila Velha - ES',
    telefone: '5527900000001',
  });
  const [item] = order.ficha.items;
  assert.equal(order.ficha.items.length, 1);
  assert.equal(item.tipo, 'Camiseta');
  assert.equal(item.publico, 'masculino');
  assert.equal(item.cor, 'Preto');
  assert.deepEqual(item.malhas, ['Dry fit liso de poliéster']);
  assert.equal(item.gola, 'Gola redonda');
  assert.deepEqual(item.grade, [{ quantidade: 10, tamanho: 'M' }]);
  assert.equal(item.tipo_servico, '');
  assert.equal(order.ficha.artwork.sem_estampa, true);
  assert.deepEqual(order.ficha.observations, []);
});

test('LOJ-04: the order keeps the catalog values, never the browser price', () => {
  const request = parseStoreOrderRequest(storeOrderBody());
  const match = matchStoreCatalog(request, accept);
  const order = buildStoreOrder({
    fabCode: '01',
    id: 'order-store-2',
    match,
    now: STORE_NOW,
    request: { ...request, amountCents: 1 },
  });
  assert.equal(order.finalAmountCents, 19364);
});

test('LOJ-07: a store order is locked; any other order is not', () => {
  assert.throws(
    () => requireUnlocked({ origin: 'loja' }),
    (error) =>
      /** @type {any} */ (error).code === 'ORDER_LOCKED' &&
      /** @type {any} */ (error).statusCode === 409,
  );
  assert.doesNotThrow(() => requireUnlocked({ origin: 'atendimento' }));
  assert.doesNotThrow(() => requireUnlocked({}));
});
