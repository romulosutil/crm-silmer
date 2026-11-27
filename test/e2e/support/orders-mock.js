import { expect } from '@playwright/test';

import {
  ORDER_ITEM_OPTIONS,
  ORDER_ITEM_OPTION_ALIASES,
  orderItemOptionKey,
  parseOrderItemOption,
} from '../../../modules/orders/src/domain/order-item-options.js';
import { OrderError } from '../../../modules/orders/src/domain/errors.js';
import {
  normalizeFicha,
  validateItems,
} from '../../../modules/orders/src/domain/ficha.js';
import { applySizePricingCommand } from '../../../modules/orders/src/domain/size-pricing-composition.js';
import { calculateSizePricing } from '../../../modules/orders/src/domain/size-pricing.js';

// Mock da API de Pedidos para os testes de ponta a ponta, com dados
// sintéticos. Uso: `await mockOrders(page, { orders: [pendingOrder] })`
// antes de `page.goto(...)`; as fixtures exportadas servem de base para
// variações com spread. Compartilhado pela lista (orders-list.spec.js) e
// pela página do pedido (orders.spec.js).

const session = {
  user: {
    capabilities: [],
    email: 'marina@example.test',
    functionName: 'Vendedor',
    id: 'seller-marina',
    name: 'Marina Aguiar',
  },
};

export const confirmedOrder = {
  confirmedAt: '2026-09-09T19:20:00.000Z',
  confirmedBy: { id: 'seller-ricardo', name: 'Ricardo Lima' },
  contactId: '4f6c1b52-8d1e-4a77-9b3a-2c5e7d0a1b05',
  conversationId: 'conversation-5',
  createdAt: '2026-09-08T12:00:00.000Z',
  fabCode: 'FAB 01',
  ficha: {
    artwork: {
      feito_pelo_cliente: false,
      feito_pela_silmer: true,
      files: [],
      sem_estampa: false,
    },
    items: [
      {
        cor: 'BRANCA',
        cor_costas: 'BRANCA',
        cor_frente: 'BRANCA',
        cor_manga_direita: 'VERDE BANDEIRA',
        cor_manga_esquerda: 'VERDE BANDEIRA',
        estampa: 'Sem estampa',
        gola: 'GOLA V',
        grade: [{ quantidade: 60, tamanho: 'M' }],
        malhas: ['DRY FIT 100% POLIÉSTER'],
        modelo: 'GOLA OLÍMPICA',
        tipo: 'AVENTAL',
        vies_gola: 'VERDE',
        vies_mangas: 'VERDE',
      },
    ],
    observations: [],
    serviceData: {},
    summary: {
      aplicacao: 'SUBLIMAÇÃO TOTAL',
      cliente: 'Buffet Casa Rosa',
      data_entrega_confirmada: '2026-10-24',
      nome: 'Aventais e camisetas',
    },
  },
  deliveredOn: null,
  finalAmountCents: 118000,
  firstContactAt: '2026-09-02T14:12:00.000Z',
  id: 'order-confirmado',
  missingFields: [],
  number: '05-CRM',
  orderDate: '2026-09-09',
  paidOn: '2026-09-10',
  paymentCondition: 'pix',
  reopenedAt: null,
  reopenedBy: null,
  seller: { id: 'seller-ricardo', name: 'Ricardo Lima' },
  status: 'confirmado',
  totalPieces: 60,
  updatedAt: '2026-09-09T19:20:00.000Z',
  version: 4,
};

export const pendingOrder = {
  confirmedAt: null,
  confirmedBy: null,
  contactId: '4f6c1b52-8d1e-4a77-9b3a-2c5e7d0a1b07',
  conversationId: 'conversation-7',
  createdAt: '2026-09-12T09:00:00.000Z',
  deliveredOn: null,
  fabCode: 'FAB 01',
  ficha: {
    artwork: {
      feito_pelo_cliente: true,
      feito_pela_silmer: false,
      files: [],
      sem_estampa: false,
    },
    items: [
      {
        cor: 'BRANCA',
        cor_costas: 'BRANCA',
        cor_frente: 'BRANCA',
        cor_manga_direita: 'VERDE BANDEIRA',
        cor_manga_esquerda: 'VERDE BANDEIRA',
        estampa: 'Logo · frente',
        gola: 'GOLA REDONDA',
        grade: [
          { quantidade: 100, tamanho: 'M' },
          { quantidade: 50, tamanho: 'G' },
        ],
        malhas: ['DRY FIT 100% POLIÉSTER'],
        modelo: 'GOLA OLÍMPICA',
        tipo: 'CAMISETA',
        tipo_servico: 'SUBLIMAÇÃO TOTAL',
        vies_gola: 'OLÍMPICA - VERDE',
        vies_mangas: 'VERDE',
      },
    ],
    observations: ['Separar os itens por tamanho.'],
    serviceData: {
      artwork_status: 'Arte recebida do cliente',
      city_or_postal_code: 'Salvador/BA',
      purchase_profile: 'Compra recorrente',
      purpose: 'Uso próprio',
    },
    summary: {
      aplicacao: 'SUBLIMAÇÃO TOTAL',
      cliente: 'Colégio Ápice',
      data_entrega_confirmada: '2026-10-24',
      nome: 'Uniforme escolar 2027',
    },
  },
  finalAmountCents: null,
  firstContactAt: '2026-09-11T20:40:00.000Z',
  id: 'order-pendente',
  missingFields: ['finalAmount', 'paymentCondition'],
  number: '07-CRM',
  orderDate: null,
  paidOn: null,
  paymentCondition: null,
  reopenedAt: null,
  reopenedBy: null,
  seller: { id: 'seller-marina', name: 'Marina Aguiar' },
  status: 'pendente',
  totalPieces: 150,
  updatedAt: '2026-09-12T09:46:00.000Z',
  version: 2,
};

// OLIST-43: the same pending order once it is priced by size — the ids are the
// server's, every subtotal was reviewed by a human and the amount is their
// sum (M: R$ 32,00 a piece). Only the payment method is left for "Gerar".
export const PRICED_GROUP_ID = '6f0c2f0e-6f39-4c1c-9a57-0d0f0a5b7c11';
export const PRICED_LINE_M = '0b9a4d7e-3c55-4a43-8a8e-51f2c1d9e001';
export const PRICED_LINE_G = '0b9a4d7e-3c55-4a43-8a8e-51f2c1d9e002';

export const pricedPendingOrder = {
  ...pendingOrder,
  ficha: {
    ...pendingOrder.ficha,
    sizePricing: [
      {
        id: PRICED_GROUP_ID,
        lines: [
          {
            id: PRICED_LINE_M,
            quantity: 100,
            size: 'M',
            subtotalCents: 320000,
            subtotalReviewed: true,
          },
          {
            id: PRICED_LINE_G,
            quantity: 50,
            size: 'G',
            subtotalCents: 160000,
            subtotalReviewed: true,
          },
        ],
      },
    ],
  },
  finalAmountCents: 480000,
  missingFields: ['paymentCondition'],
  pricing: {
    complete: true,
    groups: [{ id: PRICED_GROUP_ID, subtotalCents: 480000 }],
    issues: [],
    totalCents: 480000,
  },
};

// The same confirmed order, owned by the signed-in seller: only the owner (or
// an admin) sees the edit buttons.
export const ownConfirmedOrder = {
  ...confirmedOrder,
  seller: { id: session.user.id, name: session.user.name },
};

export const extraPending = {
  ...pendingOrder,
  conversationId: 'conversation-9',
  id: 'order-pendente-2',
  ficha: {
    ...pendingOrder.ficha,
    summary: { ...pendingOrder.ficha.summary, cliente: 'Loja Vitória Sports' },
  },
  missingFields: ['items[0].gola', 'finalAmount', 'paymentCondition'],
  number: '09-CRM',
  totalPieces: 45,
};

/**
 * What the server derives from the ficha on every read and write: the pieces,
 * what is missing and, once the order is priced by size (OLIST-43), the
 * `pricing` summary and the amount it adds up to.
 *
 * @param {any} order an order whose `ficha` is the one to derive from
 */
function derivedFields(order) {
  const groups = order.ficha.sizePricing;
  const pricing = Array.isArray(groups) ? calculateSizePricing(groups) : null;
  const priced = pricing
    ? { finalAmountCents: pricing.totalCents, pricing }
    : {};
  return {
    ...priced,
    missingFields: missingFor({ ...order, ...priced }),
    totalPieces: order.ficha.items.reduce(
      /** @param {number} total @param {any} item */
      (total, item) =>
        total +
        item.grade.reduce(
          /** @param {number} sum @param {any} line */
          (sum, line) => sum + line.quantidade,
          0,
        ),
      0,
    ),
  };
}

/**
 * `PATCH /orders/:id/sections/:section` as the server answers it, over one
 * order kept in memory. The order is changed in place on success, so whoever
 * holds it (a test, two tabs) reads what the page was answered with.
 *
 * The rules are the server's own, not a copy: the commands of `size-pricing`
 * run through `applySizePricingCommand` and the whole-array write of `items`
 * through `validateItems`, so a refusal here is a refusal there (exact keys
 * per action, `initialize` once and never on a reopened order, a repeated
 * size, the review flag reset by a change). The ids are issued here, like
 * there. The version is fenced first; each write adds one to it.
 *
 * One deliberate difference: the server lists a bare `sizePricing` as missing
 * for an order that never started its subtotals; the fixtures of the older
 * journeys (PFI-15, PCL-07) are written without it, so it is derived only for
 * an order that has `ficha.sizePricing`.
 *
 * @param {any} order
 * @param {string} section
 * @param {{expectedVersion?: unknown, value?: unknown}} body
 * @returns {{status: 200, order: any}|{status: number, error: Record<string, unknown>}}
 */
export function writeOrderSection(order, section, body) {
  if (body?.expectedVersion !== order.version) {
    return { error: { code: 'VERSION_CONFLICT' }, status: 409 };
  }
  /** @type {any} */
  let ficha = { ...order.ficha };
  const value = /** @type {any} */ (body.value);
  try {
    if (section === 'size-pricing') {
      ficha = applySizePricingCommand(
        { ...order, ficha: normalizeFicha(order.ficha) },
        value,
      );
    } else if (section === 'items') {
      if (ficha.sizePricing !== undefined) {
        return { error: { code: 'SIZE_PRICING_ITEMS_MANAGED' }, status: 409 };
      }
      ficha.items = validateItems(value);
    } else if (section === 'summary') {
      ficha.summary = { ...ficha.summary, ...value };
    } else if (section === 'artwork') {
      ficha.artwork = { ...ficha.artwork, ...value };
    } else {
      ficha.observations = value;
    }
  } catch (cause) {
    if (!(cause instanceof OrderError)) throw cause;
    const refusal = /** @type {any} */ (cause);
    return {
      error: {
        code: refusal.code,
        ...(refusal.fields ? { fields: [...refusal.fields] } : {}),
        ...(refusal.index === undefined ? {} : { index: refusal.index }),
        ...(refusal.itemIndex === undefined
          ? {}
          : { itemIndex: refusal.itemIndex }),
      },
      status: refusal.statusCode,
    };
  }
  Object.assign(order, {
    ficha,
    ...derivedFields({ ...order, ficha }),
    updatedAt: new Date().toISOString(),
    version: order.version + 1,
  });
  return { order, status: 200 };
}

/** @param {any} order @param {string} action @param {any} body */
function applyCommand(order, action, body) {
  // OLIST-T13 (ADR 068): terminal local cancellation; the commercial status
  // stays and the effective one reads Cancelado.
  if (action === 'cancel') {
    return {
      cancelledAt: '2026-11-08T15:30:00.000Z',
      cancelledBy: { id: session.user.id, name: session.user.name },
      cancellationReason: body.reason,
      effectiveStatus: 'cancelado',
      version: order.version + 1,
    };
  }
  if (action === 'reopen') {
    const reopened = {
      ...order,
      reopenedAt: '2026-09-13T12:00:00.000Z',
      reopenedBy: { id: session.user.id, name: session.user.name },
      status: 'pendente',
      version: order.version + 1,
    };
    return { ...reopened, missingFields: missingFor(reopened) };
  }
  return {
    confirmedAt: '2026-09-13T12:00:00.000Z',
    confirmedBy: { id: session.user.id, name: session.user.name },
    finalAmountCents: brlToCents(body.amountText),
    missingFields: [],
    orderDate: '2026-09-13',
    paymentCondition: body.paymentCondition,
    status: 'confirmado',
    version: order.version + 1,
  };
}

/** @param {string} text */
function brlToCents(text) {
  const [reais, cents = '00'] = String(text).split(',');
  return Number(reais.replaceAll('.', '')) * 100 + Number(cents.padEnd(2, '0'));
}

// ADR 016/020: the seven points of every item, who makes the art, the
// promised delivery, the amount and the payment method — the same rule and
// order the server applies.
const ITEM_POINTS = ['tipo', 'cor', 'tipo_servico', 'malhas', 'grade', 'gola'];
const ART_ORIGINS = ['feito_pelo_cliente', 'feito_pela_silmer', 'sem_estampa'];

/** @param {any} order */
function missingFor(order) {
  if (order.status === 'confirmado') return [];
  /** @type {string[]} */
  const missing = [];
  const groups = order.ficha.sizePricing;
  const pricing = Array.isArray(groups) ? calculateSizePricing(groups) : null;
  if (order.ficha.items.length === 0) missing.push('items');
  order.ficha.items.forEach(
    /** @param {any} item @param {number} index */ (item, index) => {
      for (const key of ITEM_POINTS) {
        const value = item[key];
        const blank = Array.isArray(value)
          ? value.length === 0
          : !String(value ?? '').trim();
        if (blank) missing.push(`items[${index}].${key}`);
      }
    },
  );
  if (!ART_ORIGINS.some((origin) => order.ficha.artwork?.[origin] === true)) {
    missing.push('artwork');
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(
      order.ficha.summary.data_entrega_confirmada ?? '',
    )
  ) {
    missing.push('summary.data_entrega_confirmada');
  }
  // OLIST-43: an order priced by size reads its amount from the subtotals.
  if (!(pricing ? pricing.totalCents : order.finalAmountCents)) {
    missing.push('finalAmount');
  }
  if (!order.paymentCondition) missing.push('paymentCondition');
  for (const issue of pricing?.issues ?? []) {
    missing.push(
      ['sizePricing', issue.groupId, issue.lineId].filter(Boolean).join('.'),
    );
  }
  return [...new Set(missing)];
}

/**
 * One SSE payload delivered on connect, with a long retry so the reconnect
 * does not turn a single event into a refresh loop during the test.
 *
 * @param {Record<string, unknown>|null} event
 */
export function eventStreamBody(event) {
  if (!event) return 'retry: 60000\n\n: connected\n\n';
  return [
    'retry: 60000',
    '',
    `event: ${event.type}`,
    'id: evt-2',
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n');
}

let uploadedSequence = 0;
export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** @param {string} name @param {string} slot @param {number} index */
export function syntheticFile(name, slot, index) {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return {
    contentType: 'application/octet-stream',
    extension,
    id: `file-${index}`,
    name,
    sizeBytes: 640 * 1024,
    slot,
    thumbnail: ['png', 'jpg', 'jpeg', 'webp'].includes(extension),
    uploadedAt: '2026-10-05T17:12:00.000Z',
    uploadedBy: { id: 'seller-marina', name: 'Marina Aguiar' },
  };
}

/**
 * The /files routes of ADR 023 over an in-memory store per order.
 *
 * @param {import('@playwright/test').Route} route
 * @param {import('@playwright/test').Request} request
 * @param {RegExpExecArray} match
 * @param {Map<string, {final: any, references: any[]}>} store
 * @param {any} options
 */
async function routeFiles(route, request, match, store, options) {
  const [, orderId, fileId, kind] = match;
  const state = store.get(orderId) ?? { final: null, references: [] };
  store.set(orderId, state);
  const json = (/** @type {number} */ status, /** @type {any} */ body) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  const listing = () => ({
    ...state,
    limits: { maxBytes: 10 * 1024 * 1024, maxReferences: 5 },
  });
  if (request.method() === 'GET' && !fileId) {
    await json(200, listing());
    return;
  }
  if (request.method() === 'GET' && kind) {
    await route.fulfill({
      status: 200,
      contentType: kind === 'thumbnail' ? 'image/png' : 'application/pdf',
      headers: { 'Content-Disposition': 'attachment' },
      body: ONE_PIXEL_PNG,
    });
    return;
  }
  expect(request.headers()['idempotency-key']).toBeTruthy();
  if (request.method() === 'DELETE') {
    options.onRemove?.(fileId);
    if (state.final?.id === fileId) state.final = null;
    state.references = state.references.filter((file) => file.id !== fileId);
    await json(200, listing());
    return;
  }
  const raw = (request.postDataBuffer() ?? Buffer.alloc(0)).toString('latin1');
  const slot = /name="slot"\r\n\r\n([a-z]+)/u.exec(raw)?.[1] ?? '';
  const filename = Buffer.from(
    /name="file"; filename="([^"]+)"/u.exec(raw)?.[1] ?? '',
    'latin1',
  ).toString('utf8');
  const hasThumbnail = raw.includes('name="thumbnail"');
  options.onUpload?.({ filename, hasThumbnail, slot });
  if (options.uploadFailure) {
    await json(options.uploadFailure.status, {
      error: options.uploadFailure.body,
    });
    return;
  }
  if (slot === 'reference' && state.references.length >= 5) {
    await json(409, { error: { code: 'FILE_LIMIT_REACHED' } });
    return;
  }
  const file = {
    ...syntheticFile(filename, slot, (uploadedSequence += 1) + 100),
    thumbnail: hasThumbnail,
  };
  if (slot === 'final') state.final = file;
  else state.references.push(file);
  await json(201, listing());
}

/**
 * `sectionFailure` refuses one section write and lets the others through (a
 * field that fails while the next one saves); `writeFailure` refuses them
 * all. The answer is the live list of orders, as the writes left it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{user?: Record<string, unknown>, orders?: any[], itemOptions?: boolean, failDetailOnce?: boolean, failListOnce?: boolean, liveEvent?: Record<string, unknown>|null, onDetail?: (orderId: string) => void, onList?: (params: URLSearchParams) => void, onWrite?: (call: {section?: string, action?: string, body: any}) => void, pages?: any[][], writeFailure?: {status: number, body: Record<string, unknown>, persist?: Record<string, unknown>}, sectionFailure?: (call: {section: string, body: any}) => {status: number, body: Record<string, unknown>}|null|undefined|void, files?: Record<string, {final: any, references: any[]}>, onUpload?: (call: {filename: string, hasThumbnail: boolean, slot: string}) => void, onRemove?: (fileId: string) => void, uploadFailure?: {status: number, body: Record<string, unknown>}}} [options]
 */
export async function mockOrders(page, options = {}) {
  // A write mutates the order it answers with, so each test gets its own
  // copy: sharing the module fixture would let one test's confirmation
  // decide what the next test in the same worker reads.
  /** @type {any[]} */
  const orders = JSON.parse(
    JSON.stringify(options.orders ?? [confirmedOrder, pendingOrder]),
  );
  const pages = options.pages ?? null;
  const itemOptions = options.itemOptions
    ? structuredClone(ORDER_ITEM_OPTIONS)
    : null;
  /** @type {Map<string, {final: any, references: any[]}>} */
  const fileStore = new Map(
    Object.entries(JSON.parse(JSON.stringify(options.files ?? {}))),
  );
  let listCalls = 0;
  let detailCalls = 0;
  /** @type {Map<string, {fingerprint:string, order:any}>} */
  const deliveryCommands = new Map();
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (itemOptions && path === '/api/v1/orders/item-options') {
      return route.fulfill({
        json: { catalog: itemOptions, aliases: ORDER_ITEM_OPTION_ALIASES },
      });
    }
    if (
      itemOptions &&
      /^\/api\/v1\/orders\/[^/]+\/item-options$/u.test(path) &&
      request.method() === 'POST'
    ) {
      const { kind, label } = request.postDataJSON();
      expect(request.headers()['idempotency-key']).toBeTruthy();
      try {
        const option = parseOrderItemOption(kind, label);
        const group = itemOptions[option.kind];
        const existing = group.find(
          (value) => orderItemOptionKey(value) === option.key,
        );
        if (!existing) group.push(option.label);
        return route.fulfill({
          json: { kind: option.kind, label: existing ?? option.label },
        });
      } catch (error) {
        if (!(error instanceof OrderError)) throw error;
        return route.fulfill({
          status: error.statusCode,
          json: { code: error.code },
        });
      }
    }

    if (/^\/api\/v1\/orders\/[^/]+\/pdf$/u.test(path)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: '%PDF-1.4\n% synthetic order ficha\n',
      });
      return;
    }

    if (path === '/api/v1/sessions/current') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(
          options.user
            ? { user: { ...session.user, ...options.user } }
            : session,
        ),
      });
      return;
    }
    if (path === '/api/v1/events') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: eventStreamBody(options.liveEvent ?? null),
      });
      return;
    }
    if (path === '/api/v1/orders/portfolio') {
      const figures = {
        confirmedCount: 1,
        soldAmountCents: 118000,
        pieces: 60,
        averageTicketCents: 118000,
      };
      await route.fulfill({
        json: {
          production: {
            late: 0,
            risk: 0,
            arte: 0,
            producao: 0,
            pronto: 0,
            cut: orders.filter((order) => order.cutMapAvailable).length,
          },
          sales: {
            current: figures,
            previous: figures,
            from: '2026-11-01',
            to: '2026-11-27',
          },
        },
      });
      return;
    }
    if (path === '/api/v1/users/assignable') {
      await route.fulfill({ json: { users: [session.user] } });
      return;
    }
    const productionStage =
      /^\/api\/v1\/orders\/([^/]+)\/production-stage$/u.exec(path);
    if (productionStage && request.method() === 'POST') {
      const order = orders.find(({ id }) => id === productionStage[1]);
      const body = request.postDataJSON();
      options.onWrite?.({ action: 'production-stage', body });
      expect(request.headers()['idempotency-key']).toBeTruthy();
      expect(body.expectedVersion).toBe(order.version);
      order.productionStage = body.stage;
      order.cutMapAvailable = ['arte', 'producao'].includes(body.stage);
      order.version += 1;
      await route.fulfill({ json: { order } });
      return;
    }
    if (path === '/api/v1/orders' && request.method() === 'GET') {
      options.onList?.(url.searchParams);
      const pageIndex = listCalls;
      listCalls += 1;
      if (options.failListOnce && listCalls === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ code: 'UNAVAILABLE' }),
        });
        return;
      }
      const production = url.searchParams.get('production');
      const universe = production
        ? orders.filter(
            (order) =>
              order.status === 'confirmado' &&
              !order.deliveredOn &&
              !order.isTest &&
              (production !== 'cut' || order.cutMapAvailable),
          )
        : orders;
      const source = pages
        ? (pages[Math.min(pageIndex, pages.length - 1)] ?? [])
        : universe.filter(
            (order) =>
              (!url.searchParams.get('status') ||
                order.status === url.searchParams.get('status')) &&
              (url.searchParams.get('production') !== 'cut' ||
                order.cutMapAvailable),
          );
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          counts: {
            confirmado: universe.filter((o) => o.status === 'confirmado')
              .length,
            pendente: universe.filter((o) => o.status === 'pendente').length,
          },
          items: source,
          nextCursor:
            pages && listCalls < pages.length ? `cursor-${listCalls}` : null,
        }),
      });
      return;
    }
    const section = /^\/api\/v1\/orders\/([^/]+)\/sections\/([^/]+)$/u.exec(
      path,
    );
    if (section && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      options.onWrite?.({ body, section: section[2] });
      expect(request.headers()['idempotency-key']).toBeTruthy();
      if (options.writeFailure) {
        await route.fulfill({
          status: options.writeFailure.status,
          contentType: 'application/json',
          body: JSON.stringify({ error: options.writeFailure.body }),
        });
        return;
      }
      const refusal = options.sectionFailure?.({ body, section: section[2] });
      if (refusal) {
        await route.fulfill({
          status: refusal.status,
          contentType: 'application/json',
          body: JSON.stringify({ error: refusal.body }),
        });
        return;
      }
      const current = orders.find((candidate) => candidate.id === section[1]);
      const result = writeOrderSection(current, section[2], body);
      await route.fulfill({
        status: result.status,
        contentType: 'application/json',
        body: JSON.stringify(
          result.status === 200
            ? { order: current }
            : { error: /** @type {any} */ (result).error },
        ),
      });
      return;
    }

    const delivery =
      /^\/api\/v1\/orders\/([^/]+)\/delivery-confirmation$/u.exec(path);
    if (delivery && request.method() === 'POST') {
      const body = request.postDataJSON();
      options.onWrite?.({ action: 'delivery-confirmation', body });
      const key = request.headers()['idempotency-key'];
      expect(key).toBeTruthy();
      const current = orders.find((candidate) => candidate.id === delivery[1]);
      const json = (/** @type {number} */ status, /** @type {any} */ value) =>
        route.fulfill({ status, json: value });
      if (options.writeFailure) {
        if (options.writeFailure.persist)
          Object.assign(current, options.writeFailure.persist);
        return json(options.writeFailure.status, {
          error: options.writeFailure.body,
        });
      }
      const user = { ...session.user, ...options.user };
      const admin = /** @type {string[]} */ (user.capabilities).includes(
        'COMMERCIAL_ADMIN',
      );
      if (!current || (!admin && current.seller?.id !== user.id))
        return json(403, { error: { code: 'FORBIDDEN' } });
      if (
        current.origin === 'loja' ||
        current.status !== 'confirmado' ||
        current.cancelledAt ||
        current.isTest
      )
        return json(409, { error: { code: 'ORDER_STATUS_CONFLICT' } });
      const fingerprint = JSON.stringify({ orderId: delivery[1], ...body });
      const replay = deliveryCommands.get(key);
      if (replay)
        return replay.fingerprint === fingerprint
          ? json(200, { order: replay.order })
          : json(409, { error: { code: 'IDEMPOTENCY_CONFLICT' } });
      if (
        Object.keys(body).some(
          (name) => !['expectedVersion', 'deliveredOn'].includes(name),
        )
      )
        return json(400, { error: { code: 'INVALID_REQUEST' } });
      if (body.expectedVersion !== current.version)
        return json(409, { error: { code: 'VERSION_CONFLICT' } });
      const today = await page.evaluate(() =>
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Sao_Paulo',
        }).format(new Date()),
      );
      const correction = Object.hasOwn(body, 'deliveredOn');
      if (correction && !current.deliveredOn)
        return json(409, { error: { code: 'ORDER_STATUS_CONFLICT' } });
      const value = correction
        ? body.deliveredOn
        : (current.deliveredOn ?? today);
      const parsed =
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
          ? new Date(value + 'T00:00:00.000Z')
          : null;
      if (
        !parsed ||
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value ||
        value > today
      )
        return json(422, {
          error: { code: 'INVALID_DATE', fields: ['deliveredOn'] },
        });
      if (current.deliveredOn !== value)
        Object.assign(current, {
          deliveredOn: value,
          version: current.version + 1,
        });
      deliveryCommands.set(key, {
        fingerprint,
        order: JSON.parse(JSON.stringify(current)),
      });
      return json(200, { order: current });
    }

    const milestones = /^\/api\/v1\/orders\/([^/]+)\/milestones$/u.exec(path);
    if (milestones && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      options.onWrite?.({ action: 'milestones', body });
      expect(request.headers()['idempotency-key']).toBeTruthy();
      if (options.writeFailure) {
        await route.fulfill({
          status: options.writeFailure.status,
          contentType: 'application/json',
          body: JSON.stringify({ error: options.writeFailure.body }),
        });
        return;
      }
      const current = orders.find(
        (candidate) => candidate.id === milestones[1],
      );
      Object.assign(current, {
        ...(Object.hasOwn(body, 'deliveredOn')
          ? { deliveredOn: body.deliveredOn }
          : {}),
        paidOn: body.paidOn,
        version: current.version + 1,
      });
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ order: current }),
      });
      return;
    }

    const command =
      /^\/api\/v1\/orders\/([^/]+)\/(confirm|reopen|cancel)$/u.exec(path);
    if (command && request.method() === 'POST') {
      const body = request.postDataJSON();
      options.onWrite?.({ action: command[2], body });
      expect(request.headers()['idempotency-key']).toBeTruthy();
      if (options.writeFailure) {
        // The persisted state the failure left behind (e.g. a lock that won
        // the race), read again by the page.
        if (options.writeFailure.persist) {
          Object.assign(
            orders.find((candidate) => candidate.id === command[1]),
            options.writeFailure.persist,
          );
        }
        await route.fulfill({
          status: options.writeFailure.status,
          contentType: 'application/json',
          body: JSON.stringify({ error: options.writeFailure.body }),
        });
        return;
      }
      const current = orders.find((candidate) => candidate.id === command[1]);
      Object.assign(current, applyCommand(current, command[2], body));
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ order: current }),
      });
      return;
    }

    // ADR 023: the art files of each order, kept per test like the orders.
    const filesRoute =
      /^\/api\/v1\/orders\/([^/]+)\/files(?:\/([^/]+)(?:\/(content|thumbnail))?)?$/u.exec(
        path,
      );
    if (filesRoute) {
      await routeFiles(route, request, filesRoute, fileStore, options);
      return;
    }

    // T139: ordinary order scenarios have no selected freight estimate.
    if (
      /^\/api\/v1\/orders\/[^/]+\/shipping-quote$/u.test(path) &&
      request.method() === 'GET'
    ) {
      await route.fulfill({ json: { quote: null } });
      return;
    }

    const detail = /^\/api\/v1\/orders\/([^/]+)$/u.exec(path);
    if (detail && request.method() === 'GET') {
      options.onDetail?.(detail[1]);
      if (options.failDetailOnce && detailCalls++ === 0) {
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ code: 'UNAVAILABLE' }),
        });
        return;
      }
      const order = orders.find((candidate) => candidate.id === detail[1]);
      if (!order) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'ORDER_NOT_FOUND' } }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ order }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'ORDER_NOT_FOUND' } }),
    });
  });
  return { orders };
}

// RFC 074 — "Cobranças e recebimentos" (docs/api/order-billing-links.md).
// A synthetic seller billing view with CRM payment links that add up. Each
// write mutates it and answers with the whole view, as the API does; figures
// and the section badge are recomputed the way the server defines them.

/** Synthetic instant in the store's clock (UTC−3). @param {number} day @param {number} hour @param {number} minute */
export function billingAt(day, hour, minute) {
  return new Date(Date.UTC(2026, 10, day, hour + 3, minute)).toISOString();
}

/** @param {string} code @param {number} [port] */
export function billingLinkUrl(
  code,
  port = Number(process.env.E2E_PORT ?? 4173),
) {
  return `http://127.0.0.1:${port}/pagar/${code.padEnd(26, '0')}`;
}

/** @param {Record<string, any>} values */
export function billingLink(values) {
  return {
    id: 'link-1',
    kind: 'signal',
    amountCents: 240000,
    state: 'open',
    origin: 'sent',
    url: billingLinkUrl('7Q4K2M'),
    chargeId: null,
    createdAt: billingAt(23, 13, 44),
    createdBy: 'Marina A.',
    sentAt: null,
    deliveredAt: null,
    pageOpenedAt: null,
    clickedAt: null,
    providerValidUntil: null,
    paidAt: null,
    payMethod: 'pix',
    refundedCents: 0,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    verifying: null,
    inReview: false,
    history: null,
    ...values,
  };
}

/** @param {any} billing */
function refreshFigures(billing) {
  const total = billing.totalAmountCents;
  const paid = billing.links.filter(
    (/** @type {any} */ l) => l.state === 'paid' && !l.inReview,
  );
  const received =
    paid.reduce(
      (/** @type {number} */ s, /** @type {any} */ l) =>
        s + l.amountCents - l.refundedCents,
      0,
    ) +
    billing.receipts
      .filter((/** @type {any} */ r) => !r.reversedAt)
      .reduce(
        (/** @type {number} */ s, /** @type {any} */ r) => s + r.amountCents,
        0,
      );
  const remaining = Math.max(0, total - received);
  const held = billing.links
    .filter((/** @type {any} */ l) => l.state === 'paid' && l.inReview)
    .reduce(
      (/** @type {number} */ s, /** @type {any} */ l) => s + l.amountCents,
      0,
    );
  const open = billing.links.filter((/** @type {any} */ l) =>
    ['open', 'checkout_requested', 'checkout_open', 'unknown'].includes(
      l.state,
    ),
  );
  const reserved = Math.min(
    remaining,
    open.reduce(
      (/** @type {number} */ s, /** @type {any} */ l) => s + l.amountCents,
      0,
    ),
  );
  billing.figures = {
    totalCents: total,
    receivedCents: received,
    remainingCents: remaining,
    heldCents: held,
    reservedCents: reserved,
    freeCents: Math.max(0, remaining - reserved),
  };
  billing.receivedAmountCents = received;
  billing.balanceAmountCents = remaining;
  /** @param {string} state */
  const has = (state) => open.some((/** @type {any} */ l) => l.state === state);
  billing.situation = has('unknown')
    ? 'unknown'
    : billing.review
      ? 'review'
      : has('checkout_open') || has('checkout_requested')
        ? 'paying'
        : has('open')
          ? 'waiting'
          : remaining <= 0
            ? 'settled'
            : received > 0
              ? 'partial'
              : 'none';
}

/**
 * Mocks GET/POST `/api/v1/orders/:id/billing…` and the order's conversation.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{order: any, billing?: Record<string, any>, raceCancel?: boolean, raceExternal?: boolean, confirmConflict?: boolean, stillValid?: boolean, reconcileExceeds?: boolean, intentStates?: string[]}} options
 */
export async function mockOrderBilling(page, options) {
  const order = options.order;
  /** @type {any} */
  const billing = {
    enabled: true,
    chatSendEnabled: true,
    paymentCheckEnabled: true,
    managed: true,
    canManage: true,
    canOperate: true,
    ownerName: 'Marina A.',
    version: 1,
    orderVersion: order.version,
    condition: { percent: 50 },
    percent: 50,
    totalAmountCents: order.finalAmountCents,
    review: null,
    settledAt: null,
    links: [],
    receipts: [],
    charges: [],
    payments: [],
    ...JSON.parse(JSON.stringify(options.billing ?? {})),
  };
  refreshFigures(billing);
  /** @type {Array<{path: string, body: any, key: string}>} */
  const writes = [];
  const committed = new Map();
  /** @type {Map<string, {polls: number, linkId: string}>} */
  const intents = new Map();
  const states = options.intentStates ?? ['sending', 'sent', 'delivered'];
  let seq = 10;
  const bump = () => {
    billing.version += 1;
    refreshFigures(billing);
  };
  await page.route('**/api/v1/inbox/conversations/*', (route) =>
    route.fulfill({
      json: {
        conversation: {
          id: order.conversationId,
          channel: 'whatsapp',
          contact: { label: 'Escola Aurora' },
          version: 7,
        },
      },
    }),
  );
  await page.route('**/api/v1/orders/*/billing**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(
      /^\/api\/v1\/orders\/[^/]+\/billing\/?/u,
      '',
    );
    /** @param {number} status @param {any} body */
    const json = (status, body) => route.fulfill({ status, json: body });
    if (request.method() === 'GET') {
      const intent = /^send-intents\/([^/]+)$/u.exec(path);
      if (intent) {
        const record = intents.get(intent[1]);
        if (!record) return json(404, { error: { code: 'NOT_FOUND' } });
        const state = states[Math.min(record.polls, states.length - 1)];
        record.polls += 1;
        const link = billing.links.find(
          (/** @type {any} */ l) => l.id === record.linkId,
        );
        if (link && (state === 'sent' || state === 'delivered'))
          link.sentAt ??= billingAt(23, 14, 6);
        if (link && state === 'delivered')
          link.deliveredAt ??= billingAt(23, 14, 7);
        return json(200, { id: intent[1], state, version: record.polls });
      }
      return json(200, { billing });
    }
    const key = request.headers()['idempotency-key'];
    const body = request.postDataJSON();
    if (!key) return json(400, { error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
    writes.push({ path, body, key });
    if (committed.has(key)) return json(200, committed.get(key));
    if (
      body.expectedVersion !== billing.orderVersion ||
      body.expectedBillingVersion !== billing.version
    )
      return json(409, { error: { code: 'VERSION_CONFLICT' } });
    const findLink = (/** @type {string} */ id) =>
      billing.links.find((/** @type {any} */ l) => l.id === id);
    let status = 200;
    /** @type {any} */
    let result = null;
    if (path === 'plan') {
      billing.condition = { percent: body.percent };
      billing.percent = body.percent;
    } else if (path === 'links') {
      if (
        body.percent !== undefined &&
        billing.condition?.percent === undefined
      )
        billing.condition = { percent: body.percent };
      if (billing.condition === null && body.percent !== undefined)
        billing.condition = { percent: body.percent };
      billing.links.push(
        billingLink({
          id: `link-${++seq}`,
          kind: 'installment',
          amountCents: body.amountCents,
          origin: 'generated',
          url: billingLinkUrl(`G${seq}`),
          createdAt: billingAt(23, 14, 5),
        }),
      );
      status = 201;
    } else if (path === 'send-intents') {
      let linkId = body.linkId;
      if (body.action === 'issue_link') {
        if (billing.condition === null && body.percent !== undefined)
          billing.condition = { percent: body.percent };
        linkId = `link-${++seq}`;
        billing.links.push(
          billingLink({
            id: linkId,
            kind:
              body.amountCents === billing.totalAmountCents / 2
                ? 'signal'
                : 'installment',
            amountCents: body.amountCents,
            url: billingLinkUrl(`S${seq}`),
            createdAt: billingAt(23, 14, 5),
          }),
        );
      }
      const id = `intent-${++seq}`;
      intents.set(id, { polls: 0, linkId });
      bump();
      result = { id, state: 'queued', linkId, version: 0 };
      committed.set(key, result);
      return json(202, result);
    } else {
      const cancel = /^links\/([^/]+)\/cancel$/u.exec(path);
      const confirm = /^links\/([^/]+)\/confirm-result$/u.exec(path);
      const reverse = /^external-receipts\/([^/]+)\/reverse$/u.exec(path);
      if (cancel) {
        const link = findLink(cancel[1]);
        if (options.raceCancel || link.state !== 'open') {
          Object.assign(link, {
            state: 'checkout_open',
            pageOpenedAt: billingAt(23, 14, 2),
            clickedAt: billingAt(23, 14, 3),
            providerValidUntil: billingAt(24, 14, 3),
          });
          bump();
          return json(409, {
            error: {
              code: 'BILLING_LINK_NOT_OPEN',
              state: 'checkout_open',
              clickedAt: link.clickedAt,
            },
          });
        }
        Object.assign(link, {
          state: 'cancelled',
          cancelledAt: billingAt(23, 14, 5),
          cancelledBy: 'Marina A.',
          cancelReason: 'seller',
        });
      } else if (confirm) {
        // Contract decision 11: both receipt ids queue a provider check;
        // neither releases an attempt whose validity passed.
        const link = findLink(confirm[1]);
        if (options.confirmConflict) {
          // The 'created' callback arrived first.
          Object.assign(link, {
            state: 'checkout_open',
            providerValidUntil: billingAt(24, 14, 2),
          });
          bump();
        }
        if (link.state !== 'unknown')
          return json(409, {
            error: {
              code: 'BILLING_CONFLICT',
              state: link.state,
              clickedAt: link.clickedAt,
            },
          });
        if (body.invoiceSlug && body.transactionNsu)
          link.verifying = {
            checkId: 'check-1',
            state: 'queued',
            requestedAt: billingAt(23, 14, 5),
            checkedAt: null,
            nextAt: billingAt(23, 14, 10),
          };
        else if (
          options.stillValid ||
          (link.providerValidUntil &&
            Date.parse(link.providerValidUntil) > Date.now())
        )
          return json(409, { error: { code: 'BILLING_LINK_STILL_VALID' } });
        else
          Object.assign(link, {
            state: 'open',
            verifying: null,
            providerValidUntil: null,
          });
      } else if (path === 'external-receipts') {
        for (const id of body.cancelLinkIds ?? []) {
          const link = findLink(id);
          if (options.raceExternal) {
            Object.assign(link, {
              state: 'checkout_open',
              clickedAt: billingAt(23, 14, 3),
              providerValidUntil: billingAt(24, 14, 3),
            });
            bump();
            return json(409, {
              error: {
                code: 'BILLING_LINK_NOT_OPEN',
                state: 'checkout_open',
                clickedAt: link.clickedAt,
              },
            });
          }
          Object.assign(link, {
            state: 'cancelled',
            cancelledAt: billingAt(23, 14, 5),
            cancelledBy: 'Marina A.',
            cancelReason: 'external_receipt',
          });
        }
        billing.receipts.push({
          id: `receipt-${++seq}`,
          amountCents: body.amountCents,
          receivedOn: body.receivedOn,
          method: body.method,
          note: body.note,
          recordedBy: 'seller-marina',
          recordedByName: 'Marina A.',
          recordedAt: billingAt(23, 14, 5),
          reversedAt: null,
        });
      } else if (path === 'reconcile') {
        if (body.decision === 'apply_current' && options.reconcileExceeds) {
          // A link opened meanwhile: payments + reserving links > total.
          options.reconcileExceeds = false;
          billing.links.push(
            billingLink({
              id: `link-${++seq}`,
              kind: 'installment',
              amountCents: 300000,
              sentAt: billingAt(23, 14, 4),
              createdAt: billingAt(23, 14, 4),
            }),
          );
          bump();
          return json(409, { error: { code: 'BILLING_LINK_EXCEEDS_FREE' } });
        }
        if (body.decision === 'apply_current')
          billing.links.forEach((/** @type {any} */ l) => (l.inReview = false));
        else
          billing.links
            .filter((/** @type {any} */ l) => l.state === 'open')
            .forEach((/** @type {any} */ l) => (l.state = 'cancelled'));
        billing.review = null;
      } else if (reverse) {
        const receipt = billing.receipts.find(
          (/** @type {any} */ r) => r.id === reverse[1],
        );
        receipt.reversedAt = billingAt(23, 14, 5);
        receipt.reversedByName = 'Marina A.';
        receipt.reversalReason = body.reason;
      }
    }
    bump();
    result = { billing: JSON.parse(JSON.stringify(billing)) };
    committed.set(key, result);
    return json(status, result);
  });
  return { billing, writes };
}
