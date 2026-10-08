import { OrderConflictError, OrderError } from './errors.js';
import { blankArtwork, blankItem } from './ficha.js';
import { operationalDay } from './order.js';
import { STORE_ACTOR_ID, storeProduct } from './store-catalog.js';

// ADR 027: the "Já pagou?" notice of the site shop becomes an order that is
// born official and stays locked. This module reads the site's contract v1,
// checks it against the CRM's own catalog and builds the order; it decides
// nothing about who may call it (the public route does) or how often (the
// repository counts).

export const ORDER_ORIGINS = Object.freeze(
  /** @type {const} */ (['atendimento', 'loja']),
);
export const STORE_CONTRACT_VERSION = '1';
// The declared instant comes from the customer's clock: a retry may arrive
// days after the first try, a skewed clock a little ahead of the CRM's.
export const DECLARED_AT_MAX_AGE_MS = 7 * 24 * 3_600_000;
export const DECLARED_AT_MAX_SKEW_MS = 5 * 60_000;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
// The site's rule (pedido-loja.ts, Anatel numbering): 55, an area code
// without zero, then a mobile of nine digits starting with 9 or a landline
// of eight starting with 2 to 5.
const BRAZILIAN_PHONE = /^55[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const MAX_TEXT = 200;

const SHAPE = Object.freeze({
  cliente: ['nome', 'telefone'],
  item: [
    'cor',
    'cor_id',
    'gola',
    'malha',
    'publico',
    'quantidade',
    'tamanho',
    'tamanho_id',
    'tipo',
  ],
  pagamento: ['forma', 'informado_pelo_cliente_em'],
  produto: ['nome', 'slug'],
  retirada: ['local'],
});
const TOP_KEYS = Object.freeze([
  'cliente',
  'item',
  'pagamento',
  'pedido_id',
  'produto',
  'retirada',
  'teste',
  'valor_centavos',
  'versao',
]);

/**
 * A refused notice, in the site's vocabulary: `code` is the `erro` the
 * public route answers, `statusCode` its HTTP status.
 */
export class StoreOrderError extends OrderError {
  /** @param {number} statusCode @param {string} code @param {string} [message] */
  constructor(statusCode, code, message = code) {
    super(message, code, statusCode);
  }
}

/**
 * @typedef {{
 *   requestId: string, test: boolean,
 *   product: {slug: string, nome: string},
 *   item: {tipo: string, publico: string, cor: string, corId: string,
 *     tamanho: string, tamanhoId: string, malha: string, gola: string,
 *     quantidade: number},
 *   amountCents: number, declaredAt: string, pickup: string,
 *   customer: {name: string, phone: string},
 * }} StoreOrderRequest
 * @typedef {{
 *   telefone: string, produto: {slug: string, nome: string},
 *   retirada: string, informadoPeloClienteEm: string,
 * }} StoreFicha
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** @param {unknown} value @param {readonly string[]} keys */
function requireShape(value, keys) {
  if (!isPlainObject(value)) throw new StoreOrderError(400, 'corpo_invalido');
  const present = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    present.length !== expected.length ||
    present.some((key, index) => key !== expected[index])
  ) {
    throw new StoreOrderError(400, 'corpo_invalido');
  }
  return value;
}

/** @param {unknown} value */
function requireText(value) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > MAX_TEXT ||
    CONTROL.test(value)
  ) {
    throw new StoreOrderError(400, 'corpo_invalido');
  }
  return value;
}

/** @param {unknown} value */
function requirePositiveInteger(value) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) <= 0) {
    throw new StoreOrderError(400, 'corpo_invalido');
  }
  return /** @type {number} */ (value);
}

/**
 * LOJ-03: the site's contract v1, exactly. A missing, extra or mistyped key
 * is malformed (400), and so are a name or a phone the site itself would not
 * have sent. Whether the product exists is the catalog's call (422).
 *
 * @param {unknown} body
 * @returns {StoreOrderRequest}
 */
export function parseStoreOrderRequest(body) {
  const top = requireShape(body, TOP_KEYS);
  if (top.versao !== STORE_CONTRACT_VERSION) {
    throw new StoreOrderError(400, 'versao_invalida');
  }
  if (typeof top.pedido_id !== 'string' || !UUID_V4.test(top.pedido_id)) {
    throw new StoreOrderError(400, 'pedido_id_invalido');
  }
  if (typeof top.teste !== 'boolean') {
    throw new StoreOrderError(400, 'corpo_invalido');
  }
  const produto = requireShape(top.produto, SHAPE.produto);
  const item = requireShape(top.item, SHAPE.item);
  const pagamento = requireShape(top.pagamento, SHAPE.pagamento);
  const retirada = requireShape(top.retirada, SHAPE.retirada);
  const cliente = requireShape(top.cliente, SHAPE.cliente);
  if (pagamento.forma !== 'pix') {
    throw new StoreOrderError(400, 'corpo_invalido');
  }
  const declaredAt = pagamento.informado_pelo_cliente_em;
  if (
    typeof declaredAt !== 'string' ||
    !ISO_INSTANT.test(declaredAt) ||
    Number.isNaN(Date.parse(declaredAt))
  ) {
    throw new StoreOrderError(400, 'corpo_invalido');
  }
  const name =
    typeof cliente.nome === 'string'
      ? cliente.nome.replace(/\s+/gu, ' ').trim()
      : '';
  if (name.length < 2 || name.length > 80 || CONTROL.test(name)) {
    throw new StoreOrderError(400, 'nome_invalido');
  }
  if (
    typeof cliente.telefone !== 'string' ||
    !BRAZILIAN_PHONE.test(cliente.telefone)
  ) {
    throw new StoreOrderError(400, 'telefone_invalido');
  }
  return {
    amountCents: requirePositiveInteger(top.valor_centavos),
    customer: { name, phone: cliente.telefone },
    declaredAt: new Date(declaredAt).toISOString(),
    item: {
      cor: requireText(item.cor),
      corId: requireText(item.cor_id),
      gola: requireText(item.gola),
      malha: requireText(item.malha),
      publico: requireText(item.publico),
      quantidade: requirePositiveInteger(item.quantidade),
      tamanho: requireText(item.tamanho),
      tamanhoId: requireText(item.tamanho_id),
      tipo: requireText(item.tipo),
    },
    pickup: requireText(retirada.local),
    product: {
      nome: requireText(produto.nome),
      slug: requireText(produto.slug),
    },
    requestId: top.pedido_id,
    test: top.teste,
  };
}

/**
 * LOJ-04/LOJ-05: the notice must describe what the CRM sells, at the CRM's
 * price, and a test notice only goes where tests are accepted. The declared
 * instant must fall in the window a retry can explain.
 *
 * @param {StoreOrderRequest} request
 * @param {{acceptTest: boolean, now: Date}} options
 * @returns {{product: import('./store-catalog.js').StoreProduct, color: string, size: string}}
 */
export function matchStoreCatalog(request, { acceptTest, now }) {
  const product = storeProduct(request.product.slug);
  if (!product) throw new StoreOrderError(422, 'produto_desconhecido');
  const { item } = request;
  const color = Object.hasOwn(product.cores, item.corId)
    ? product.cores[item.corId]
    : null;
  if (color === null || color !== item.cor) {
    throw new StoreOrderError(422, 'cor_invalida');
  }
  const size = Object.hasOwn(product.tamanhos, item.tamanhoId)
    ? product.tamanhos[item.tamanhoId]
    : null;
  if (size === null || size !== item.tamanho) {
    throw new StoreOrderError(422, 'tamanho_invalido');
  }
  if (item.quantidade !== product.pecasPorKit) {
    throw new StoreOrderError(422, 'quantidade_divergente');
  }
  if (request.amountCents !== product.precoCentavos) {
    throw new StoreOrderError(422, 'valor_divergente');
  }
  if (
    request.product.nome !== product.nome ||
    item.tipo !== product.tipo ||
    item.publico !== product.publico ||
    item.malha !== product.malha ||
    item.gola !== product.gola ||
    request.pickup !== product.retirada
  ) {
    throw new StoreOrderError(422, 'produto_divergente');
  }
  if (request.test && !acceptTest) {
    throw new StoreOrderError(422, 'teste_recusado');
  }
  const declared = Date.parse(request.declaredAt);
  if (
    declared < now.getTime() - DECLARED_AT_MAX_AGE_MS ||
    declared > now.getTime() + DECLARED_AT_MAX_SKEW_MS
  ) {
    throw new StoreOrderError(422, 'horario_invalido');
  }
  return { color, product, size };
}

/**
 * LOJ-06: the store order as it is born — confirmed by the store actor at
 * the catalog's price, paid by Pix on the day the customer declared, with
 * no conversation. The name and the phone live only in the ficha, which the
 * repository encrypts.
 *
 * @param {{
 *   request: StoreOrderRequest,
 *   match: ReturnType<typeof matchStoreCatalog>,
 *   id: string, fabCode: string, now: Date,
 * }} input
 */
export function buildStoreOrder({ fabCode, id, match, now, request }) {
  const { color, product, size } = match;
  const at = now.toISOString();
  const item = {
    ...blankItem(),
    cor: color,
    gola: product.gola,
    grade: [{ quantidade: product.pecasPorKit, tamanho: size }],
    malhas: [product.malha],
    publico: product.publico,
    tipo: product.tipo,
  };
  /** @type {StoreFicha} */
  const loja = {
    informadoPeloClienteEm: request.declaredAt,
    produto: { nome: product.nome, slug: product.slug },
    retirada: product.retirada,
    telefone: request.customer.phone,
  };
  return {
    confirmedAt: at,
    confirmedBy: STORE_ACTOR_ID,
    conversationId: null,
    createdBy: STORE_ACTOR_ID,
    createdByKind: /** @type {const} */ ('automation'),
    fabCode,
    ficha: {
      artwork: { ...blankArtwork(), sem_estampa: true },
      items: [item],
      loja,
      observations: [],
      serviceData: {},
      summary: {
        cliente: request.customer.name,
        data_entrega_confirmada: null,
        nome: null,
      },
    },
    finalAmountCents: product.precoCentavos,
    firstContactAt: at,
    id,
    isTest: request.test,
    missingFields: [],
    orderDate: operationalDay(now),
    origin: /** @type {const} */ ('loja'),
    paidOn: operationalDay(new Date(request.declaredAt)),
    paymentCondition: /** @type {const} */ ('pix'),
    paymentDeclaredAt: request.declaredAt,
    status: /** @type {const} */ ('confirmado'),
    totalPieces: product.pecasPorKit,
  };
}

/**
 * LOJ-07: a store order takes no write after it is born — no section, no
 * confirmation or reopening, no trail day, no art file.
 *
 * @param {{origin?: string}} order
 */
export function requireUnlocked(order) {
  if (order.origin === 'loja') {
    throw new OrderConflictError('Store orders are locked', 'ORDER_LOCKED');
  }
}
