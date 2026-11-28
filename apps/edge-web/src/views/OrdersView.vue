<script>
// RFC 024 (PLI-10): "Limpar filtro" drops a Painel filter from the address,
// which opens a new list (the app keys each view by its address). The search
// and the focus travel to that list once, so clearing is not starting over.
/** @type {{query: string}|null} */
let clearedFromRoute = null;
</script>

<script setup>
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import FilterSheet from '../components/FilterSheet.vue';
import FilterChip from '../components/FilterChip.vue';
import AppHint from '../components/AppHint.vue';
import OrderReceiptPreview from '../components/order/OrderReceiptPreview.vue';
import OrderCutMapMembership from '../components/order/OrderCutMapMembership.vue';
import OrderCutMapPreview from '../components/order/OrderCutMapPreview.vue';
import OrderListActions from '../components/order/OrderListActions.vue';
import OrderListDeadline from '../components/order/OrderListDeadline.vue';
import OrderPortfolioOverview from '../components/order/OrderPortfolioOverview.vue';
import { commandKey, request } from '../lib/api-client.js';
import { dateTimeBR, formatPhoneNumber } from '../lib/format.js';
import { openDialog } from '../lib/ui.js';
import { downloadPdf, getOrderPdf, pdfFile } from '../lib/order-pdf.js';
import {
  amountLabel,
  deliveryDue,
  elapsedSince,
  fichaPrintedLabel,
  isStoreOrder,
  missingHeadline,
  orderStatusLabel,
  STORE_ORIGIN_LABEL,
  storeConfirmationLabel,
  storeFichaPending,
  storeProductLabel,
} from '../lib/order-format.js';

const LIVE_REFRESH_DELAY_MS = 250;
const SEARCH_DELAY_MS = 300;
const PAGE_SIZE = 25;

// ADRs 027 and 028: "Loja do site" narrows the list to the site shop's
// orders, all of them confirmed and paid through InfinitePay.
const STORE_FILTER = 'loja';
// Pesquisa UX 2026-10-15, achado 3: the production queue — confirmed orders
// (rule 10: only those print) not delivered yet and not tests, by the
// promised delivery. The API filters by status; the rest is read here.
const PRODUCTION_FILTER = 'producao';
const PORTFOLIO_GROUPS = [
  { id: 'late', label: 'Atrasados' },
  { id: 'week', label: 'Próximos 7 dias' },
  { id: 'later', label: 'Mais adiante' },
  { id: 'no-date', label: 'Sem data de entrega' },
  { id: 'delivered', label: 'Entregues' },
];
const PRODUCTION_STEPS = {
  arte: {
    label: 'Na arte',
    action: 'Enviar para produção',
    next: 'producao',
    icon: 'brush',
  },
  producao: {
    label: 'Na produção',
    action: 'Marcar como pronto',
    next: 'pronto',
    icon: 'scissors',
  },
  pronto: {
    label: 'Pronto',
    action: 'Marcar como entregue',
    next: 'delivered',
    icon: 'package',
  },
};
// Painel ("Meus pedidos pendentes"): the session seller's pending orders.
const MINE_FILTER = 'meus';
/** @param {string} label @param {string} value */
const filterOption = (label, value) => Object.freeze({ label, value });
// RFC 024 (PLI-09): three chips answer the daily questions; the eight filters
// stay, grouped in the "Filtros" sheet. The choice is still a single one, and
// "Pendentes" and "Confirmados" no longer repeat the groups (PLI-03) up front.
const QUICK_FILTERS = Object.freeze([
  filterOption('Todos', ''),
  filterOption('Meus pendentes', MINE_FILTER),
  filterOption('Prontos para produção', PRODUCTION_FILTER),
]);
const FILTER_GROUPS = Object.freeze([
  Object.freeze({
    legend: 'Situação',
    options: Object.freeze([
      filterOption('Todos', ''),
      filterOption('Pendentes', 'pendente'),
      filterOption('Confirmados', 'confirmado'),
    ]),
  }),
  Object.freeze({
    legend: 'Responsável',
    options: Object.freeze([filterOption('Meus pendentes', MINE_FILTER)]),
  }),
  Object.freeze({
    legend: 'Origem',
    options: Object.freeze([filterOption(STORE_ORIGIN_LABEL, STORE_FILTER)]),
  }),
  Object.freeze({
    legend: 'Entrega',
    options: Object.freeze([
      filterOption('Entrega atrasada', 'atrasada'),
      filterOption('Próximas entregas', 'proxima'),
    ]),
  }),
  Object.freeze({
    legend: 'Produção',
    options: Object.freeze([
      filterOption('Prontos para produção', PRODUCTION_FILTER),
    ]),
  }),
]);
const FILTER_LABELS = new Map(
  FILTER_GROUPS.flatMap((group) =>
    group.options.map((option) => [option.value, option.label]),
  ),
);
const QUICK_VALUES = new Set(QUICK_FILTERS.map((option) => option.value));
// The Painel's links name their filter in the address (filterFromRoute).
const FILTER_QUERY_KEYS = Object.freeze([
  'de',
  'ate',
  'credito',
  'impressao',
  'entrega',
  'origem',
  'status',
  'vendedor',
]);
// Painel: confirmed orders whose promised day passed, or comes in the next
// seven days, read in promised order. The API answers one short list.
const DELIVERY_FILTERS = Object.freeze({
  atrasada: 'overdue',
  proxima: 'due_soon',
});

const liveEvent = inject('liveEvent', ref(null));
const sessionUser = inject('sessionUser', ref(null));
const isAdmin = computed(
  () => sessionUser.value?.capabilities?.includes('COMMERCIAL_ADMIN') === true,
);
const router = useRouter();
const route = useRoute();
const heading = ref(null);
const newOrderDialog = ref(null);
const contactQuery = ref('');
const contactSearchInput = ref(null);
const contactOptions = ref([]);
const newPhoneMatches = ref([]);
const newPhoneSearching = ref(false);
const selectedContact = ref(null);
const newContactName = ref('');
const newContactPhone = ref('');
const newContactEmail = ref('');
const createErrorAlert = ref(null);
const unverifiedPhoneNotice = ref(null);
const contactSearching = ref(false);
const contactCreating = ref(false);
const orderCreating = ref(false);
const createError = ref('');
let contactController;
let contactSearchTimer = 0;
let newPhoneController;
let newPhoneSearchTimer = 0;
const checkedNewPhone = ref('');
let contactCreateKey = '';
let detailsUpdateKey = '';
let orderCreateKey = '';
// LOJ-31: the Dashboard notice opens `/pedidos?origem=loja`, the list already
// on "Loja do site"; the Dashboard indicators open `?status=` and `?entrega=`.
/** @returns {string} */
function filterFromRoute() {
  if (route.query.origem === STORE_FILTER) return STORE_FILTER;
  if (route.query.vendedor === 'eu') return MINE_FILTER;
  const delivery = String(route.query.entrega ?? '');
  if (Object.hasOwn(DELIVERY_FILTERS, delivery)) return delivery;
  const status = String(route.query.status ?? '');
  return ['confirmado', 'pendente'].includes(status) ? status : '';
}
const filter = ref(filterFromRoute());
const carried = clearedFromRoute;
clearedFromRoute = null;
const query = ref(carried?.query ?? '');
const filterSheet = ref(null);
const filtersButton = ref(null);
const orderSearch = ref(null);
// The sheet edits a draft; "Ver resultados" applies it, Esc discards it.
const draftFilter = ref('');
const searchNotice = ref('');
const items = ref([]);
const counts = ref({ confirmado: 0, pendente: 0 });
const nextCursor = ref(null);
const loading = ref(true);
const loadingMore = ref(false);
const refreshing = ref(false);
const hasLoaded = ref(false);
const error = ref('');
const pdfError = ref('');
const pdfBusyId = ref('');
const portfolio = ref(null);
const portfolioError = ref(false);
const productionFilter = ref('');
const portfolioSeller = ref('');
const portfolioSellers = ref([]);
const portfolioSellerError = ref(false);
const cutMode = ref(false);
const cutSelection = ref(new Set());
const cutPreview = ref(null);
const cutMembership = ref(null);
const cutTitle = ref(null);
let cutTrigger;
let portfolioController;
const productionBusy = ref('');
const productionError = ref('');
const productionNotice = ref('');
const deliveredExpanded = ref(false);
/** @type {import('vue').Ref<{open:(order:any,trigger:EventTarget|null)=>Promise<void>}|null>} */
const receiptPreview = ref(null);
function receiptFocusFallback() {
  return orderSearch.value ?? heading.value;
}
const errorMode = ref('');
// The clock is refreshed on every load, so the inactivity signal does not freeze at the
// value the first render happened to compute.
const now = ref(new Date());
let controller;
let refreshTimer = 0;
let searchTimer = 0;
let clockTimer = 0;

const isProductionQueue = computed(
  () =>
    cutMode.value ||
    Boolean(productionFilter.value) ||
    filter.value === PRODUCTION_FILTER,
);
// Pesquisa UX 2026-10-15, achado 3: exceptions first, then the nearest
// promised delivery; the server's order breaks the ties.
const confirmedOrders = computed(() =>
  queueOrder(
    items.value.filter(
      (order) =>
        order.status === 'confirmado' &&
        (!isProductionQueue.value || (!order.isTest && !order.deliveredOn)),
    ),
  ),
);
const pendingOrders = computed(() =>
  queueOrder(items.value.filter((order) => order.status === 'pendente')),
);
const confirmedGroups = computed(() => {
  const orders = new Map(PORTFOLIO_GROUPS.map(({ id }) => [id, []]));
  for (const order of confirmedOrders.value) {
    const { days } = due(order);
    const group = order.deliveredOn
      ? 'delivered'
      : days === null
        ? 'no-date'
        : days < 0
          ? 'late'
          : days <= 7
            ? 'week'
            : 'later';
    orders.get(group).push(order);
  }
  orders
    .get('delivered')
    .sort((a, b) => b.deliveredOn.localeCompare(a.deliveredOn));
  return PORTFOLIO_GROUPS.map((group) => ({
    ...group,
    orders: orders.get(group.id),
  })).filter((group) => group.orders.length);
});
const canOpenCutMode = computed(
  () =>
    portfolio.value?.production?.cut > 0 ||
    items.value.some((order) => order.cutMapAvailable === true),
);
const deliveryFilter = computed(
  () =>
    DELIVERY_FILTERS[
      /** @type {keyof typeof DELIVERY_FILTERS} */ (filter.value)
    ] ?? '',
);
const showConfirmed = computed(
  () =>
    isProductionQueue.value ||
    ['', 'confirmado', PRODUCTION_FILTER, STORE_FILTER].includes(
      filter.value,
    ) ||
    Boolean(deliveryFilter.value),
);
const confirmedTitle = computed(() =>
  cutMode.value
    ? 'Pedidos para corte'
    : isProductionQueue.value
      ? 'Prontos para produção'
      : 'Confirmados',
);
const confirmedCount = computed(() => String(counts.value.confirmado));
const showPending = computed(
  () =>
    !isProductionQueue.value &&
    ['', 'pendente', MINE_FILTER].includes(filter.value),
);
// PLI-10: a filter only the sheet offers is named, with a way out.
const commercialFilters = computed(() => {
  const result = {};
  if (
    filter.value === 'confirmado' &&
    (route.query.de || route.query.ate || route.query.credito)
  ) {
    result.from = String(route.query.de ?? '');
    result.to = String(route.query.ate ?? '');
    if (route.query.credito) result.credit = String(route.query.credito);
  }
  if (filter.value === STORE_FILTER && route.query.impressao === 'pendente')
    result.firstPrint = 'pending';
  return result;
});
const sheetFilterLabel = computed(() => {
  const selected = commercialFilters.value;
  if (selected.firstPrint) return 'Loja · primeira impressão pendente';
  if (selected.from)
    return (
      'Confirmados · ' +
      selected.from.split('-').reverse().join('/') +
      ' a ' +
      selected.to.split('-').reverse().join('/') +
      (selected.credit ? ' · com filtro de crédito' : '')
    );
  return QUICK_VALUES.has(filter.value)
    ? ''
    : (FILTER_LABELS.get(filter.value) ?? '');
});
// PLI-10: the result replaces the old "N confirmados · N pendentes" line; the
// group headings keep both counts (PLI-03). The API counts the search, the
// origin and the owner; the production queue is read here.
const resultLabel = computed(() => {
  const total = isProductionQueue.value
    ? confirmedCount.value
    : String(
        (showConfirmed.value ? counts.value.confirmado : 0) +
          (showPending.value ? counts.value.pendente : 0),
      );
  return `${total} ${total === '1' ? 'pedido' : 'pedidos'}`;
});
const isEmpty = computed(
  () =>
    !loading.value &&
    (showConfirmed.value ? confirmedOrders.value.length : 0) +
      (showPending.value ? pendingOrders.value.length : 0) ===
      0,
);
const canCreateOrder = computed(() =>
  Boolean(
    selectedContact.value
      ? selectedContact.value.phoneSource !== 'site_unverified' &&
          (selectedContact.value.phone ||
            newContactPhone.value.replace(/\D/gu, '').length >= 10)
      : newContactName.value.trim() &&
          newContactPhone.value.replace(/\D/gu, '').length >= 10,
  ),
);
const phoneSearchAmbiguous = computed(
  () =>
    contactQuery.value.replace(/\D/gu, '').length >= 10 &&
    contactOptions.value.length > 1,
);

/** @param {Record<string, any>} order */
function customerName(order) {
  return order.ficha?.summary?.cliente || 'Cliente não informado';
}

/** PLI-04: the event and the seller travel with the customer. */
/** @param {Record<string, any>} order */
function customerContext(order) {
  if (isStoreOrder(order)) {
    const product = storeProductLabel(order);
    return product ? `${STORE_ORIGIN_LABEL} · ${product}` : STORE_ORIGIN_LABEL;
  }
  const event = order.ficha?.summary?.nome || 'Sem evento';
  return `${event} · ${order.seller?.name || 'sem vendedor'}`;
}

/** PLI-05: what is missing and for how long, or who confirmed and when. */
/** @param {Record<string, any>} order */
function situation(order) {
  // LOJ-33: a site order reads like any confirmed order, confirmed by the site.
  if (isStoreOrder(order)) return storeConfirmationLabel(order);
  if (order.status === 'confirmado') {
    const who = order.confirmedBy?.name || 'vendedor';
    return `Confirmado por ${who} · ${dateTimeBR(order.confirmedAt)}`;
  }
  const still = elapsedSince(order.updatedAt, now.value);
  const headline = missingHeadline(order.missingFields);
  return still === ''
    ? headline
    : `${headline} · Pedido sem movimentação há ${still}`;
}

/** A confirmed send without a later reply is evidence of waiting. */
function clientWaiting(order) {
  if (order.status !== 'pendente') return '';
  const message = order.lastMessage;
  if (message?.direction !== 'outbound') return '';
  if (!['sent', 'delivered', 'read'].includes(message.deliveryStatus))
    return '';
  if (typeof message.sentAt !== 'string') return '';
  const lastAt = new Date(message.sentAt).getTime();
  if (!Number.isFinite(lastAt) || now.value.getTime() - lastAt < 48 * 3_600_000)
    return '';
  return `Cliente sem resposta há ${elapsedSince(message.sentAt, now.value)}`;
}

function priority(order) {
  if (order.status !== 'pendente') return '';
  if (clientWaiting(order)) return 'Retomar contato';
  const age = now.value.getTime() - new Date(order.updatedAt).getTime();
  return Number.isFinite(age) && age >= 72 * 3_600_000 ? 'Revisar pedido' : '';
}

/** @param {Record<string, any>} order */
function due(order) {
  return deliveryDue(order, now.value);
}

/**
 * What puts an order at the top of its group: a late promised delivery, a
 * pending order to resume or review, a site order nobody printed yet.
 *
 * @param {Record<string, any>} order
 */
function isException(order) {
  return (
    due(order).overdue ||
    Boolean(priority(order)) ||
    (order.status === 'confirmado' && storeFichaPending(order))
  );
}

/** @param {Record<string, any>[]} orders */
function queueOrder(orders) {
  const delivered = (/** @type {Record<string, any>} */ order) =>
    Boolean(order.deliveredOn);
  return orders
    .map((order, index) => ({ days: due(order).days, index, order }))
    .sort((a, b) => {
      const exception =
        Number(isException(b.order)) - Number(isException(a.order));
      if (exception !== 0) return exception;
      const done = Number(delivered(a.order)) - Number(delivered(b.order));
      if (done !== 0) return done;
      if (a.days !== b.days) {
        if (a.days === null) return 1;
        if (b.days === null) return -1;
        return a.days - b.days;
      }
      return a.index - b.index;
    })
    .map(({ order }) => order);
}

function openOrder(order, event) {
  if (
    event.target?.closest?.(
      'a, button, input, label, select, textarea, summary',
    )
  )
    return;
  void router.push(`/pedidos/${order.id}`);
}

/** @param {Event} event */
function openNewOrder(event) {
  const dialog = newOrderDialog.value;
  if (!(dialog instanceof HTMLDialogElement)) return;
  contactController?.abort();
  newPhoneController?.abort();
  if (contactSearchTimer) globalThis.clearTimeout(contactSearchTimer);
  if (newPhoneSearchTimer) globalThis.clearTimeout(newPhoneSearchTimer);
  contactQuery.value = '';
  contactOptions.value = [];
  newPhoneMatches.value = [];
  newPhoneSearching.value = false;
  checkedNewPhone.value = '';
  selectedContact.value = null;
  newContactName.value = '';
  newContactPhone.value = '';
  newContactEmail.value = '';
  createError.value = '';
  contactCreateKey = '';
  detailsUpdateKey = '';
  orderCreateKey = '';
  openDialog(dialog, /** @type {HTMLElement} */ (event.currentTarget));
}

async function searchContacts() {
  contactController?.abort();
  const needle = contactQuery.value.trim();
  if (needle.length < 2 || selectedContact.value) {
    contactOptions.value = [];
    contactSearching.value = false;
    return;
  }
  const currentController = new AbortController();
  contactController = currentController;
  contactSearching.value = true;
  try {
    const response = await request('/api/v1/contacts/search', {
      body: { limit: 10, q: needle },
      method: 'POST',
      signal: currentController.signal,
    });
    contactOptions.value = response.data.items;
    createError.value = '';
  } catch (cause) {
    if (cause?.name !== 'AbortError') {
      createError.value = 'Não foi possível buscar clientes.';
    }
  } finally {
    if (contactController === currentController) contactSearching.value = false;
  }
}

/** @param {Record<string, any>} contact */
function selectContact(contact) {
  contactController?.abort();
  newPhoneController?.abort();
  if (contactSearchTimer) globalThis.clearTimeout(contactSearchTimer);
  if (newPhoneSearchTimer) globalThis.clearTimeout(newPhoneSearchTimer);
  selectedContact.value = contact;
  contactQuery.value = contact.label;
  contactOptions.value = [];
  newPhoneMatches.value = [];
  newPhoneSearching.value = false;
  createError.value = '';
  orderCreateKey = '';
  detailsUpdateKey = '';
  if (contact.phoneSource === 'site_unverified') {
    void nextTick(() => unverifiedPhoneNotice.value?.focus());
  }
}

async function changeSelectedContact() {
  selectedContact.value = null;
  contactQuery.value = '';
  newPhoneMatches.value = [];
  checkedNewPhone.value = '';
  newContactPhone.value = '';
  newContactEmail.value = '';
  detailsUpdateKey = '';
  await nextTick();
  contactSearchInput.value?.focus();
}

async function completeLegacyContact(contact) {
  detailsUpdateKey ||= commandKey();
  try {
    const response = await request(
      `/api/v1/contacts/${encodeURIComponent(contact.id)}/details`,
      {
        body: {
          expectedVersion: contact.version,
          phone: newContactPhone.value.trim(),
          ...(newContactEmail.value.trim()
            ? { email: newContactEmail.value.trim() }
            : {}),
        },
        idempotencyKey: detailsUpdateKey,
        method: 'POST',
      },
    );
    selectedContact.value = {
      ...contact,
      ...response.data.contact,
      label: response.data.contact.label || contact.label,
    };
    detailsUpdateKey = '';
    return selectedContact.value;
  } catch (cause) {
    createError.value =
      Number(cause?.status) === 409
        ? 'O cliente foi alterado ou esse telefone já está em outro cadastro. Busque pelo telefone e revise antes de continuar.'
        : Number(cause?.status) === 400
          ? 'Informe um telefone brasileiro válido com DDD.'
          : 'Não foi possível salvar o telefone. Tente novamente.';
    await nextTick();
    createErrorAlert.value?.focus();
    return null;
  }
}

async function createContact() {
  const displayName = newContactName.value.trim();
  const phone = newContactPhone.value.trim();
  const email = newContactEmail.value.trim();
  if (!displayName || !phone || contactCreating.value) return null;
  contactCreating.value = true;
  createError.value = '';
  contactCreateKey ||= commandKey();
  try {
    if (checkedNewPhone.value !== phone.replace(/\D/gu, '')) {
      const checked = await searchNewPhone();
      if (!checked) return null;
    }
    if (newPhoneMatches.value.length) {
      createError.value =
        'Esse telefone aparece em outros cadastros. Escolha um cliente da lista antes de criar o pedido.';
      await nextTick();
      createErrorAlert.value?.focus();
      return null;
    }
    const response = await request('/api/v1/contacts', {
      body: { displayName, phone, ...(email ? { email } : {}) },
      idempotencyKey: contactCreateKey,
      method: 'POST',
    });
    selectContact(response.data.contact);
    newContactName.value = '';
    newContactPhone.value = '';
    newContactEmail.value = '';
    contactCreateKey = '';
    return response.data.contact;
  } catch (cause) {
    createError.value =
      Number(cause?.status) === 400
        ? 'Confira o telefone e o e-mail informados.'
        : Number(cause?.status) === 409
          ? 'Já existe um cliente com esse telefone ou o cadastro mudou. Busque pelo telefone e selecione o cadastro existente.'
          : 'Não foi possível cadastrar o cliente. Tente novamente.';
    await nextTick();
    createErrorAlert.value?.focus();
    return null;
  } finally {
    contactCreating.value = false;
  }
}

async function searchNewPhone() {
  newPhoneController?.abort();
  const phone = newContactPhone.value.trim();
  const digits = phone.replace(/\D/gu, '');
  if (digits.length < 10 || selectedContact.value) {
    newPhoneMatches.value = [];
    checkedNewPhone.value = '';
    newPhoneSearching.value = false;
    return false;
  }
  const currentController = new AbortController();
  newPhoneController = currentController;
  newPhoneSearching.value = true;
  try {
    const response = await request('/api/v1/contacts/search', {
      body: { limit: 10, q: phone },
      method: 'POST',
      signal: currentController.signal,
    });
    if (newContactPhone.value.trim() !== phone) return false;
    newPhoneMatches.value = response.data.items;
    checkedNewPhone.value = digits;
    return true;
  } catch (cause) {
    if (
      newPhoneController === currentController &&
      cause?.name !== 'AbortError'
    ) {
      createError.value =
        'Não foi possível conferir esse telefone. Tente novamente.';
    }
    if (newPhoneController === currentController) checkedNewPhone.value = '';
    return false;
  } finally {
    if (newPhoneController === currentController)
      newPhoneSearching.value = false;
  }
}

async function createOrder() {
  if (!canCreateOrder.value || orderCreating.value) return;
  orderCreating.value = true;
  createError.value = '';
  try {
    let contact = selectedContact.value ?? (await createContact());
    if (!contact) return;
    if (!contact.phone) {
      contact = await completeLegacyContact(contact);
      if (!contact) return;
    }
    orderCreateKey ||= commandKey();
    const response = await request('/api/v1/orders', {
      body: { contactId: contact.id },
      idempotencyKey: orderCreateKey,
      method: 'POST',
    });
    newOrderDialog.value?.close();
    orderCreateKey = '';
    await router.push(`/pedidos/${response.data.order.id}`);
  } catch (cause) {
    createError.value =
      cause?.code === 'CONTACT_PHONE_REQUIRED'
        ? 'O telefone deste contato foi apenas informado no chat. Abra a conversa na Caixa de Entrada para criar o pedido deste atendimento.'
        : Number(cause?.status) === 403
          ? 'Você não tem permissão para criar pedidos.'
          : 'Não foi possível criar o pedido. Tente novamente.';
    await nextTick();
    createErrorAlert.value?.focus();
  } finally {
    orderCreating.value = false;
  }
}

watch(contactQuery, () => {
  if (selectedContact.value?.label !== contactQuery.value) {
    selectedContact.value = null;
    orderCreateKey = '';
  }
  if (contactSearchTimer) globalThis.clearTimeout(contactSearchTimer);
  contactSearchTimer = globalThis.setTimeout(() => {
    contactSearchTimer = 0;
    void searchContacts();
  }, 250);
});
watch(newContactName, () => {
  contactCreateKey = '';
});
watch([newContactPhone, newContactEmail], () => {
  contactCreateKey = '';
  detailsUpdateKey = '';
});
watch(newContactPhone, () => {
  newPhoneController?.abort();
  if (newPhoneSearchTimer) globalThis.clearTimeout(newPhoneSearchTimer);
  checkedNewPhone.value = '';
  newPhoneMatches.value = [];
  if (newContactPhone.value.replace(/\D/gu, '').length < 10) return;
  newPhoneSearchTimer = globalThis.setTimeout(() => {
    newPhoneSearchTimer = 0;
    void searchNewPhone();
  }, SEARCH_DELAY_MS);
});

/** @param {string|null} cursor */
function listRequest(cursor) {
  if (!isProductionQueue.value && deliveryFilter.value) {
    return {
      url: `/api/v1/orders?delivery=${deliveryFilter.value}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
      options: {},
    };
  }
  const needle = query.value.trim();
  const base = isProductionQueue.value
    ? { production: cutMode.value ? 'cut' : productionFilter.value || 'all' }
    : filter.value === STORE_FILTER
      ? { origin: STORE_FILTER, ...commercialFilters.value }
      : filter.value === MINE_FILTER
        ? { owner: 'me', status: 'pendente' }
        : {
            ...(filter.value ? { status: filter.value } : {}),
            ...commercialFilters.value,
          };
  if (!base.owner && !base.origin && !commercialFilters.value.from) {
    if (isAdmin.value && portfolioSeller.value)
      base.seller = portfolioSeller.value;
    else if (!isAdmin.value && sessionUser.value?.id) base.owner = 'me';
  }
  const fields = {
    ...base,
    ...(needle ? { q: needle } : {}),
    ...(cursor ? { cursor } : {}),
  };
  if ((needle.match(/\d/gu) ?? []).length >= 8) {
    return {
      url: '/api/v1/orders/search',
      options: {
        method: 'POST',
        body: { ...fields, limit: PAGE_SIZE },
      },
    };
  }
  const params = new globalThis.URLSearchParams({
    ...fields,
    limit: String(PAGE_SIZE),
  });
  return { url: `/api/v1/orders?${params}`, options: {} };
}

async function loadPortfolio() {
  portfolioController?.abort();
  const current = new AbortController();
  portfolioController = current;
  const search = portfolioSeller.value
    ? `?${new URLSearchParams({ seller: portfolioSeller.value })}`
    : '';
  portfolioError.value = false;
  try {
    const { data } = await request(`/api/v1/orders/portfolio${search}`, {
      signal: current.signal,
    });
    if (!current.signal.aborted) portfolio.value = data;
  } catch {
    if (!current.signal.aborted) {
      portfolio.value = null;
      portfolioError.value = true;
    }
  }
}

async function loadPortfolioSellers() {
  if (!isAdmin.value) return;
  try {
    const { data } = await request('/api/v1/users/assignable');
    portfolioSellers.value = data.users ?? [];
    portfolioSellerError.value = false;
  } catch {
    portfolioSellerError.value = true;
  }
}

function selectProductionFilter(value) {
  filter.value = '';
  productionFilter.value = value;
  void load();
}

async function toggleCutMode(event) {
  if (cutMode.value) {
    cancelCutMode();
    return;
  }
  cutTrigger = event.currentTarget;
  cutMode.value = true;
  cutSelection.value = new Set();
  void load();
  await nextTick();
  cutTitle.value?.focus();
}

function cancelCutMode() {
  cutMode.value = false;
  cutSelection.value = new Set();
  void load();
  nextTick(() => cutTrigger?.focus());
}

function selectForCut(order, event) {
  if (event.currentTarget.checked) cutSelection.value.add(order.id);
  else cutSelection.value.delete(order.id);
}

function openCutPreview(event) {
  cutPreview.value?.open([...cutSelection.value], event.currentTarget);
}

function removeMappedOrders(ids) {
  const mapped = new Set(ids);
  for (const id of mapped) cutSelection.value.delete(id);
  items.value = items.value.map((order) =>
    mapped.has(order.id) ? { ...order, cutMapAvailable: false } : order,
  );
  void load(true);
}

function restoreCutSelectionFocus() {
  if (cutMode.value && !cutSelection.value.size)
    nextTick(() => cutTitle.value?.focus());
}

function stageFor(order) {
  return order.productionStage ? PRODUCTION_STEPS[order.productionStage] : null;
}

async function changeStage(order, stage) {
  if (!stage || productionBusy.value || order.productionEditable !== true)
    return;
  productionBusy.value = order.id;
  productionError.value = '';
  productionNotice.value = '';
  try {
    const path =
      stage === 'delivered' ? 'delivery-confirmation' : 'production-stage';
    const { data } = await request(
      `/api/v1/orders/${encodeURIComponent(order.id)}/${path}`,
      {
        method: 'POST',
        idempotencyKey: commandKey(),
        body: {
          expectedVersion: order.version,
          ...(stage === 'delivered' ? {} : { stage }),
        },
      },
    );
    items.value = items.value.map((current) =>
      current.id === order.id ? { ...current, ...data.order } : current,
    );
    productionNotice.value = `Etapa do pedido ${order.number} atualizada.`;
    void loadPortfolio();
    await load(true);
    productionBusy.value = '';
    await nextTick();
    if (document.activeElement === document.body) {
      const row = document.querySelector(
        `[data-production-order="${CSS.escape(order.id)}"]`,
      );
      (
        row?.querySelector('.order-row-menu-trigger') ??
        row?.querySelector('.order-number-link') ??
        heading.value
      )?.focus();
    }
  } catch (cause) {
    productionError.value =
      cause?.status === 409
        ? 'O pedido mudou. Confira a etapa atual antes de tentar novamente.'
        : 'Não foi possível atualizar a etapa do pedido.';
    if ([403, 404, 409].includes(cause?.status)) void load(true);
  } finally {
    productionBusy.value = '';
  }
}

/** @param {boolean} [silent] */
async function load(silent = false) {
  controller?.abort();
  const currentController = new AbortController();
  controller = currentController;
  if (!silent) {
    loading.value = true;
    error.value = '';
  } else refreshing.value = true;
  try {
    const listing = listRequest(null);
    const response = await request(listing.url, {
      ...listing.options,
      signal: currentController.signal,
    });
    const retrieved = response.data.items;
    let lastPage = response.data;
    const desiredLength = silent ? items.value.length : 0;
    while (retrieved.length < desiredLength && lastPage.nextCursor) {
      const subsequent = listRequest(lastPage.nextCursor);
      const result = await request(subsequent.url, {
        ...subsequent.options,
        signal: currentController.signal,
      });
      lastPage = result.data;
      retrieved.push(...lastPage.items);
    }
    if (currentController.signal.aborted) return;
    items.value = retrieved;
    counts.value = lastPage.counts;
    nextCursor.value = lastPage.nextCursor;
    hasLoaded.value = true;
    now.value = new Date();
    error.value = '';
    errorMode.value = '';
  } catch (cause) {
    if (cause?.name !== 'AbortError') {
      error.value = hasLoaded.value
        ? 'Não foi possível atualizar os pedidos. Os dados exibidos podem estar desatualizados.'
        : 'Não foi possível carregar os pedidos.';
      errorMode.value = 'list';
    }
  } finally {
    if (controller === currentController) {
      loading.value = false;
      refreshing.value = false;
    }
  }
}

/** PLI-07: "Ver mais" appends the next page instead of replacing the list. */
async function loadMore() {
  if (!nextCursor.value || loadingMore.value || refreshing.value) return;
  const current = controller;
  loadingMore.value = true;
  try {
    const listing = listRequest(nextCursor.value);
    const response = await request(listing.url, {
      ...listing.options,
      signal: current?.signal,
    });
    if (current !== controller || current?.signal.aborted) return;
    items.value = [...items.value, ...response.data.items];
    counts.value = response.data.counts;
    nextCursor.value = response.data.nextCursor;
    now.value = new Date();
    error.value = '';
    errorMode.value = '';
  } catch {
    if (current !== controller || current?.signal.aborted) return;
    error.value = 'Não foi possível carregar mais pedidos.';
    errorMode.value = 'more';
  } finally {
    loadingMore.value = false;
  }
}

function retryLoadedError() {
  if (errorMode.value === 'more') void loadMore();
  else void load(true);
}

async function retryInitialLoad() {
  await load();
  await nextTick();
  heading.value?.focus();
}

/** PIM-13: the same approved ficha, delivered as a PDF file. */
/** @param {Record<string, any>} order */
async function generatePdf(order) {
  if (pdfBusyId.value) return;
  pdfBusyId.value = order.id;
  pdfError.value = '';
  try {
    downloadPdf(pdfFile(await getOrderPdf(order.id), order.number));
    if (storeFichaPending(order)) void load(true);
  } catch (cause) {
    pdfError.value =
      cause?.code === 'PRINT_FINANCIAL_TEXT_REVIEW_REQUIRED'
        ? 'Revise as informações financeiras nos textos do pedido antes de gerar a ficha da fábrica.'
        : Number(cause?.status) === 409
          ? 'Este pedido foi reaberto. Atualize a lista antes de gerar o PDF.'
          : 'Não foi possível gerar o PDF. Tente novamente.';
  } finally {
    pdfBusyId.value = '';
  }
}

/** @param {string} value */
function selectFilter(value) {
  if (filter.value === value && !productionFilter.value) return;
  productionFilter.value = '';
  searchNotice.value = '';
  filter.value = value;
  void load();
}

/** PLI-09: the sheet opens on the filter in use. @param {Event} event */
function openFilters(event) {
  draftFilter.value = filter.value;
  /** @type {any} */ (filterSheet.value)?.open(
    /** @type {HTMLElement} */ (event.currentTarget),
  );
}

function applySheetFilter() {
  selectFilter(draftFilter.value);
}

async function clearSearch() {
  query.value = '';
  await nextTick();
  orderSearch.value?.focus();
}

/**
 * PLI-10: back to every order. A filter that came in the address leaves it
 * too; the focus lands on "Filtros", where another filter is chosen.
 */
async function clearFilter() {
  if (productionFilter.value) {
    selectProductionFilter('');
    return;
  }
  const rest = { ...route.query };
  const fromRoute = FILTER_QUERY_KEYS.filter((key) => key in rest);
  if (fromRoute.length) {
    for (const key of fromRoute) delete rest[key];
    clearedFromRoute = { query: query.value };
    const failure = await router.replace({ path: route.path, query: rest });
    if (failure) clearedFromRoute = null;
    return;
  }
  selectFilter('');
  await nextTick();
  /** @type {HTMLElement|null} */ (filtersButton.value)?.focus();
}

/** Collapses bursts of live events into one silent refresh. */
function scheduleLiveRefresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void load(true);
    void loadPortfolio();
  }, LIVE_REFRESH_DELAY_MS);
}

watch(query, () => {
  deliveredExpanded.value = Boolean(query.value.trim());
  // A delivery view is a short list in promised order; a search reads every
  // order again.
  if (!isProductionQueue.value && deliveryFilter.value && query.value.trim()) {
    filter.value = '';
    searchNotice.value =
      'A busca está em todos os pedidos. A visualização por entrega foi removida.';
  }
  if (!query.value.trim()) searchNotice.value = '';
  if (searchTimer) globalThis.clearTimeout(searchTimer);
  searchTimer = globalThis.setTimeout(() => {
    searchTimer = 0;
    void load();
  }, SEARCH_DELAY_MS);
});

watch(portfolioSeller, () => {
  cutSelection.value = new Set();
  portfolio.value = null;
  void load();
  void loadPortfolio();
});

// PLI-08: order, conversation and contact changes may change the list's labels
// or the last message used to prioritize contact.
watch(liveEvent, (event) => {
  if (
    event?.reset ||
    [
      'inbox.order.changed',
      'inbox.conversation.changed',
      'inbox.contact.changed',
    ].includes(event?.type)
  ) {
    scheduleLiveRefresh();
  }
});

onMounted(() => {
  if (carried) /** @type {HTMLElement|null} */ (filtersButton.value)?.focus();
  else heading.value?.focus();
  void load();
  void loadPortfolio();
  void loadPortfolioSellers();
  clockTimer = globalThis.setInterval(() => {
    now.value = new Date();
  }, 60_000);
});
onBeforeUnmount(() => {
  controller?.abort();
  portfolioController?.abort();
  contactController?.abort();
  newPhoneController?.abort();
  if (contactSearchTimer) globalThis.clearTimeout(contactSearchTimer);
  if (newPhoneSearchTimer) globalThis.clearTimeout(newPhoneSearchTimer);
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  if (searchTimer) globalThis.clearTimeout(searchTimer);
  if (clockTimer) globalThis.clearInterval(clockTimer);
});
</script>

<template>
  <div class="page orders-portfolio" :data-cut-mode="cutMode || undefined">
    <!-- RFC 024: one line, so the first order shows on a phone. -->
    <header class="page-heading orders-heading">
      <h1 ref="heading" tabindex="-1">
        {{ isAdmin ? 'Pedidos' : 'Meus pedidos' }}
      </h1>
      <button type="button" class="primary" @click="openNewOrder">
        Novo pedido
      </button>
    </header>

    <dialog
      ref="newOrderDialog"
      class="op-dialog manual-order-dialog"
      aria-labelledby="new-order-title"
    >
      <h2 id="new-order-title">Novo pedido</h2>
      <p>
        Encontre o cliente pelo telefone ou nome, ou informe os dados abaixo
        para criar o pedido.
      </p>
      <div class="manual-order-field">
        <label for="new-order-contact"
          >Buscar cliente por telefone ou nome</label
        >
        <input
          id="new-order-contact"
          ref="contactSearchInput"
          v-model="contactQuery"
          type="search"
          autocomplete="off"
          aria-describedby="new-order-search-help"
        />
        <p id="new-order-search-help" class="op-hint">
          Informe o telefone completo ou ao menos duas letras do nome. Confira o
          telefone antes de selecionar um cliente com nome repetido.
        </p>
      </div>
      <p v-if="contactSearching" role="status">Buscando clientes…</p>
      <p v-if="phoneSearchAmbiguous" role="alert" class="op-alert">
        Há mais de um cadastro para esse telefone. Confira a ficha e o histórico
        de cada cliente antes de escolher.
      </p>
      <ul
        v-if="contactOptions.length"
        class="manual-contact-options"
        aria-label="Resultados da busca de clientes"
      >
        <li v-for="contact in contactOptions" :key="contact.id">
          <button type="button" @click="selectContact(contact)">
            Selecionar {{ contact.label }}
            <small v-if="contact.phone">
              {{ formatPhoneNumber(contact.phone) }} ·
              {{
                contact.phoneSource === 'site_unverified'
                  ? 'informado no site · não confirmado'
                  : 'telefone'
              }}
            </small>
            <small v-if="!contact.identities?.length"
              >Cadastro sem canal vinculado</small
            >
            <small
              v-if="
                contact.identities?.length &&
                contact.identities[0].channel !== 'site_chat'
              "
            >
              {{ contact.identities[0].channel }} · final
              {{ contact.identities[0].externalId?.slice(-4) }}
            </small>
          </button>
          <RouterLink
            :to="`/clientes/${contact.id}`"
            target="_blank"
            rel="noopener noreferrer"
          >
            Conferir ficha de {{ contact.label }} em outra aba
          </RouterLink>
        </li>
      </ul>
      <p
        v-else-if="
          contactQuery.trim().length >= 2 &&
          !contactSearching &&
          !selectedContact
        "
        role="status"
      >
        Nenhum cliente encontrado nesta busca.
      </p>
      <p v-if="selectedContact" role="status">
        Cliente selecionado: <strong>{{ selectedContact.label }}</strong>
        <button
          type="button"
          class="link-button"
          @click="changeSelectedContact"
        >
          Trocar cliente
        </button>
      </p>
      <p
        v-if="selectedContact?.phoneSource === 'site_unverified'"
        ref="unverifiedPhoneNotice"
        class="op-alert"
        role="status"
        tabindex="-1"
      >
        Este telefone foi informado no chat e ainda não foi confirmado. Abra a
        conversa pela
        <RouterLink :to="`/clientes/${selectedContact.id}`">
          ficha do contato</RouterLink
        >
        para criar o pedido deste atendimento.
      </p>
      <fieldset
        v-if="selectedContact && !selectedContact.phone"
        class="manual-contact-create"
      >
        <legend>Completar telefone deste cliente</legend>
        <p class="op-hint">
          Para criar um pedido novo, informe o telefone deste cadastro legado.
        </p>
        <label for="legacy-contact-phone">Telefone</label>
        <input
          id="legacy-contact-phone"
          v-model="newContactPhone"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          required
        />
        <label for="legacy-contact-email"
          >E-mail <span class="op-hint">(opcional)</span></label
        >
        <input
          id="legacy-contact-email"
          v-model="newContactEmail"
          type="email"
          autocomplete="email"
          maxlength="254"
        />
      </fieldset>
      <fieldset v-if="!selectedContact" class="manual-contact-create">
        <legend>Cliente novo</legend>
        <p class="op-hint">
          O telefone é obrigatório. O nome identifica a pessoa no CRM; e-mail é
          opcional.
        </p>
        <label for="new-contact-name">Nome</label>
        <input
          id="new-contact-name"
          v-model="newContactName"
          type="text"
          maxlength="120"
          autocomplete="name"
          required
        />
        <label for="new-contact-phone">Telefone</label>
        <input
          id="new-contact-phone"
          v-model="newContactPhone"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          placeholder="(11) 99999-9999"
          required
        />
        <p v-if="newPhoneSearching" role="status">
          Conferindo cadastros com esse telefone…
        </p>
        <p v-else-if="checkedNewPhone" role="status" aria-live="polite">
          {{
            newPhoneMatches.length
              ? `${newPhoneMatches.length} cadastro${newPhoneMatches.length === 1 ? '' : 's'} encontrado${newPhoneMatches.length === 1 ? '' : 's'} para esse telefone. Escolha um cliente da lista antes de criar o pedido.`
              : 'Nenhum cadastro encontrado com esse telefone.'
          }}
        </p>
        <div
          v-if="newPhoneMatches.length"
          class="op-alert"
          role="group"
          aria-label="Cadastros com o telefone informado"
        >
          <p>
            Esse telefone já aparece no CRM. Confira e escolha o cadastro antes
            de criar o pedido.
          </p>
          <ul class="manual-contact-options">
            <li v-for="contact in newPhoneMatches" :key="contact.id">
              <button type="button" @click="selectContact(contact)">
                Selecionar {{ contact.label }} ·
                {{ formatPhoneNumber(contact.phone) }}
                <span v-if="contact.phoneSource === 'site_unverified'">
                  · informado no site · não confirmado
                </span>
              </button>
              <RouterLink
                :to="`/clientes/${contact.id}`"
                target="_blank"
                rel="noopener noreferrer"
              >
                Conferir ficha de {{ contact.label }} em outra aba
              </RouterLink>
            </li>
          </ul>
        </div>
        <label for="new-contact-email"
          >E-mail <span class="op-hint">(opcional)</span></label
        >
        <input
          id="new-contact-email"
          v-model="newContactEmail"
          type="email"
          autocomplete="email"
          maxlength="254"
        />
      </fieldset>
      <p
        v-if="createError"
        ref="createErrorAlert"
        tabindex="-1"
        role="alert"
        class="op-alert"
      >
        {{ createError }}
      </p>
      <div class="op-dialog-actions">
        <button
          type="button"
          :disabled="orderCreating || contactCreating"
          @click="newOrderDialog?.close()"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="primary"
          :disabled="!canCreateOrder || orderCreating || contactCreating"
          @click="createOrder"
        >
          Criar pedido
        </button>
      </div>
    </dialog>

    <OrderPortfolioOverview
      :overview="portfolio"
      :error="portfolioError"
      :active="productionFilter"
      :cutting="cutMode"
      :cut-enabled="canOpenCutMode"
      @filter="selectProductionFilter"
      @cut="toggleCutMode"
      @retry="loadPortfolio"
    />

    <div class="filter-bar orders-filter-bar">
      <div class="search-control orders-search" role="search">
        <label for="order-search" class="sr-only"
          >Buscar número, cliente ou telefone</label
        >
        <div class="search-field">
          <AppIcon class="orders-search-icon" name="search" />
          <input
            id="order-search"
            ref="orderSearch"
            v-model="query"
            type="search"
            placeholder="Número, cliente ou telefone"
          />
          <button
            v-if="query"
            type="button"
            class="quiet icon-button portfolio-clear-search"
            aria-label="Limpar campo de busca"
            @click="clearSearch"
          >
            <AppIcon name="close" />
          </button>
        </div>
      </div>
      <div
        v-if="!cutMode"
        class="chip-row orders-chip-row"
        role="group"
        aria-label="Filtrar pedidos"
      >
        <button
          v-for="option in QUICK_FILTERS"
          :key="option.value"
          class="chip"
          type="button"
          :aria-pressed="filter === option.value"
          @click="selectFilter(option.value)"
        >
          {{ option.label }}
        </button>
        <button
          ref="filtersButton"
          type="button"
          class="soft orders-filters-button"
          aria-haspopup="dialog"
          :data-active="sheetFilterLabel ? 'true' : undefined"
          @click="openFilters"
        >
          Filtros
        </button>
      </div>
      <label
        v-if="isAdmin && !deliveryFilter && filter !== STORE_FILTER"
        class="portfolio-seller"
      >
        Vendedor
        <select v-model="portfolioSeller">
          <option value="">Todos</option>
          <option
            v-for="seller in portfolioSellers"
            :key="seller.id"
            :value="seller.id"
          >
            {{ seller.name }}
          </option>
        </select>
      </label>
    </div>
    <div v-if="portfolioSellerError" class="portfolio-overview-error">
      <p role="status">Não foi possível carregar os vendedores.</p>
      <button type="button" class="quiet" @click="loadPortfolioSellers">
        Tentar novamente
      </button>
    </div>
    <div class="orders-result-line">
      <p
        v-if="sheetFilterLabel && !cutMode && !productionFilter"
        class="orders-active-filter"
      >
        <span class="sr-only">Filtro: </span>
        <FilterChip
          :label="sheetFilterLabel"
          :remove-label="`Limpar filtro ${sheetFilterLabel}`"
          @remove="clearFilter"
        />
      </p>
      <p class="filter-summary" role="status">
        {{ loading ? '' : resultLabel }}
      </p>
    </div>
    <AppHint
      v-if="searchNotice"
      tone="info"
      role="status"
      class="orders-search-notice"
      >{{ searchNotice }}</AppHint
    >
    <AppHint v-else-if="deliveryFilter" tone="info" class="orders-search-notice"
      >Buscar por nome, número ou telefone muda a visualização para todos os
      pedidos.</AppHint
    >

    <FilterSheet
      ref="filterSheet"
      title="Filtros"
      description="Escolha uma visualização por vez. Uma opção substitui a anterior."
      @apply="applySheetFilter"
      @clear="draftFilter = ''"
    >
      <fieldset
        v-for="group in FILTER_GROUPS"
        :key="group.legend"
        class="filter-sheet-group"
      >
        <legend>{{ group.legend }}</legend>
        <label
          v-for="option in group.options"
          :key="option.value"
          class="filter-sheet-option"
        >
          <input
            v-model="draftFilter"
            type="radio"
            name="orders-filter"
            :value="option.value"
          />
          {{ option.label }}
        </label>
      </fieldset>
    </FilterSheet>

    <section
      v-show="cutMode"
      id="cut-selection"
      class="portfolio-selection"
      aria-labelledby="cut-selection-title"
    >
      <div>
        <h2 id="cut-selection-title" ref="cutTitle" tabindex="-1">
          Selecione os pedidos para o corte
        </h2>
        <p>
          Selecione pedidos na arte ou na produção que ainda aguardam um mapa.
        </p>
      </div>
      <div class="portfolio-selection-actions">
        <p role="status">
          {{
            cutSelection.size
              ? `${cutSelection.size} ${cutSelection.size === 1 ? 'pedido selecionado' : 'pedidos selecionados'}`
              : 'Nenhum pedido selecionado'
          }}
        </p>
        <button type="button" @click="cancelCutMode">Cancelar</button>
        <button
          type="button"
          class="primary"
          aria-haspopup="dialog"
          :disabled="!cutSelection.size"
          @click="openCutPreview"
        >
          Conferir mapa
        </button>
      </div>
    </section>

    <p v-if="productionError" class="op-alert" role="alert">
      {{ productionError }}
    </p>
    <p v-if="productionNotice" class="audit-note" role="status">
      {{ productionNotice }}
    </p>

    <p v-if="pdfError" role="alert" class="op-alert">{{ pdfError }}</p>
    <div v-if="error && hasLoaded" role="alert" class="audit-note">
      <p>{{ error }}</p>
      <button
        type="button"
        :disabled="refreshing || loadingMore"
        @click="retryLoadedError"
      >
        Tentar novamente
      </button>
    </div>
    <div v-if="loading" class="loading-state" role="status">
      Carregando pedidos…
    </div>
    <section
      v-else-if="error && !hasLoaded"
      class="surface empty-list"
      role="alert"
    >
      <h2>Pedidos indisponíveis</h2>
      <p>{{ error }}</p>
      <button type="button" @click="retryInitialLoad">Tentar novamente</button>
    </section>
    <section
      v-else-if="isEmpty && isProductionQueue && !cutMode && !query.trim()"
      class="surface empty-list"
      aria-live="polite"
    >
      <h2>Nenhum pedido na fila de produção</h2>
      <p>
        Pedidos confirmados aparecem aqui, pela entrega mais próxima, até serem
        marcados como entregues.
      </p>
      <button type="button" class="soft" @click="clearFilter">
        Limpar filtro
      </button>
    </section>
    <section
      v-else-if="isEmpty && cutMode && !query.trim()"
      class="surface empty-list"
    >
      <h2>Nenhum pedido disponível para corte</h2>
      <p>Confira se há pedidos na arte ou na produção para este vendedor.</p>
    </section>
    <section v-else-if="isEmpty" class="surface empty-list" aria-live="polite">
      <template v-if="query.trim()">
        <h2>Nenhum pedido encontrado</h2>
        <p>A busca não encontrou pedidos nesta visualização.</p>
        <button type="button" class="soft" @click="clearSearch">
          Limpar busca
        </button>
      </template>
      <template v-else-if="filter">
        <h2>
          {{
            commercialFilters.firstPrint
              ? 'Nenhum pedido da loja aguarda primeira impressão'
              : commercialFilters.from
                ? 'Nenhum pedido confirmado neste intervalo'
                : 'Nenhum pedido com esse filtro'
          }}
        </h2>
        <p>Escolha outra visualização ou volte para todos os pedidos.</p>
        <button type="button" class="soft" @click="clearFilter">
          Limpar filtro
        </button>
      </template>
      <template v-else>
        <h2>Nenhum pedido por aqui</h2>
        <p>Crie um pedido quando o cliente confirmar que quer fechar.</p>
      </template>
    </section>
    <template v-else>
      <!-- Pesquisa UX 2026-10-15, achado 3: what still needs a person comes
           first; inside each group, exceptions and the nearest delivery. -->
      <section
        v-if="showPending && pendingOrders.length"
        class="surface section-gap"
        aria-labelledby="orders-pending-title"
      >
        <div class="panel-head">
          <h2 id="orders-pending-title">
            Pendentes
            <span class="badge" data-tone="warning">{{ counts.pendente }}</span>
          </h2>
        </div>
        <div
          class="table-wrap list-scroll order-list"
          role="region"
          tabindex="0"
          aria-label="Pedidos pendentes"
        >
          <table class="data-table order-table">
            <thead>
              <tr>
                <th scope="col" class="order-cell-number">Pedido</th>
                <th scope="col">Cliente</th>
                <th scope="col" class="order-cell-due">Entrega</th>
                <th scope="col" class="order-cell-situation">Situação</th>
                <th scope="col" class="num order-cell-quantity">Peças</th>
                <th scope="col" class="num order-cell-value">Valor</th>
                <th scope="col" class="order-cell-actions">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="order in pendingOrders"
                :key="order.id"
                class="clickable-row"
                :data-exception="isException(order) || undefined"
                @click="openOrder(order, $event)"
              >
                <td class="order-cell-number">
                  <RouterLink
                    class="order-number-link"
                    :to="`/pedidos/${order.id}`"
                    :aria-label="`Abrir pedido ${order.number}`"
                    >#{{ order.number }}</RouterLink
                  >
                  <span class="badge order-card-status" data-tone="warning">{{
                    orderStatusLabel(order.status)
                  }}</span>
                </td>
                <td class="order-cell-customer">
                  <strong>{{ customerName(order) }}</strong>
                  <small class="order-context">{{
                    customerContext(order)
                  }}</small>
                </td>
                <td class="order-cell-due" data-label="Entrega">
                  <OrderListDeadline :deadline="due(order)" />
                </td>
                <td class="order-cell-situation" data-label="Situação">
                  <span
                    v-if="priority(order)"
                    class="badge"
                    :data-tone="clientWaiting(order) ? 'warning' : 'info'"
                    >{{ priority(order) }}</span
                  >
                  <small v-if="clientWaiting(order)" class="order-context">{{
                    clientWaiting(order)
                  }}</small>
                  <small class="order-context">{{ situation(order) }}</small>
                  <button
                    v-if="order.cutMap"
                    type="button"
                    class="portfolio-cut-history"
                    @click="cutMembership?.open(order, $event.currentTarget)"
                  >
                    Mapa de corte {{ order.cutMap.number
                    }}<span class="sr-only"> · Pedido {{ order.number }}</span>
                  </button>
                </td>
                <td class="num order-cell-quantity" data-label="Peças">
                  {{ order.totalPieces }}
                </td>
                <td class="num order-cell-value" data-label="Valor">
                  <span class="order-amount">{{
                    amountLabel(order.finalAmountCents)
                  }}</span>
                </td>
                <td class="order-cell-actions">
                  <OrderListActions
                    v-if="order.receiptAvailable === true"
                    :order="order"
                    :pdf-busy-id="pdfBusyId"
                    @receipt="receiptPreview?.open(order, $event)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        v-if="showConfirmed && confirmedOrders.length"
        class="surface section-gap portfolio-confirmed"
        aria-labelledby="orders-confirmed-title"
      >
        <div class="panel-head">
          <h2 id="orders-confirmed-title">
            {{ confirmedTitle }}
            <span class="badge" data-tone="success">{{ confirmedCount }}</span>
          </h2>
        </div>
        <div
          v-for="group in confirmedGroups"
          :key="group.id"
          class="portfolio-deadline-group"
          :data-deadline-group="group.id"
        >
          <h3 v-if="group.id === 'delivered'">
            <button
              type="button"
              class="quiet"
              :aria-expanded="deliveredExpanded"
              aria-controls="portfolio-group-delivered"
              @click="deliveredExpanded = !deliveredExpanded"
            >
              <AppIcon name="chevron-down" /> {{ group.label }} ·
              {{ group.orders.length }}
            </button>
          </h3>
          <h3 v-else class="portfolio-deadline-heading">
            {{ group.label }}
            <span class="badge">{{ group.orders.length }}</span>
          </h3>
          <div
            v-show="group.id !== 'delivered' || deliveredExpanded"
            :id="`portfolio-group-${group.id}`"
            class="table-wrap list-scroll order-list"
            role="region"
            tabindex="0"
            :aria-label="group.label"
          >
            <table class="data-table order-table">
              <thead>
                <tr>
                  <th scope="col" class="order-cell-number">Pedido</th>
                  <th scope="col">Cliente</th>
                  <th scope="col" class="order-cell-due">Entrega</th>
                  <th scope="col" class="order-cell-situation">Etapa</th>
                  <th scope="col" class="num order-cell-quantity">Peças</th>
                  <th scope="col" class="num order-cell-value">Valor</th>
                  <th scope="col" class="order-cell-actions">
                    {{ cutMode ? 'Seleção' : 'Ações' }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="order in group.orders"
                  :key="order.id"
                  class="clickable-row"
                  :data-production-order="order.id"
                  :data-exception="isException(order) || undefined"
                  :data-selected="
                    (cutMode && cutSelection.has(order.id)) || undefined
                  "
                  @click="openOrder(order, $event)"
                >
                  <td class="order-cell-number">
                    <RouterLink
                      class="order-number-link"
                      :to="`/pedidos/${order.id}`"
                      :aria-label="`Abrir pedido ${order.number}`"
                      >#{{ order.number }}</RouterLink
                    >
                    <span
                      v-if="isStoreOrder(order) || order.isTest"
                      class="order-badges"
                    >
                      <!-- ADR 028: the shop's number next to the CRM's. -->
                      <span
                        v-if="isStoreOrder(order)"
                        class="badge"
                        data-tone="info"
                        >{{
                          order.storeNumber
                            ? `Loja · ${order.storeNumber}`
                            : 'Loja'
                        }}</span
                      >
                      <span
                        v-if="order.isTest"
                        class="badge"
                        data-tone="warning"
                        >Teste</span
                      >
                      <!-- LOJ-33: a new site order until its first print. -->
                      <span
                        v-if="storeFichaPending(order)"
                        class="badge"
                        data-tone="warning"
                        >Ficha ainda sem PDF</span
                      >
                    </span>
                    <span class="badge order-card-status" data-tone="success">{{
                      orderStatusLabel(order.status)
                    }}</span>
                  </td>
                  <td class="order-cell-customer">
                    <strong>{{ customerName(order) }}</strong>
                    <small class="order-context">{{
                      customerContext(order)
                    }}</small>
                  </td>
                  <td class="order-cell-due" data-label="Entrega">
                    <OrderListDeadline :deadline="due(order)" />
                  </td>
                  <td class="order-cell-situation" data-label="Etapa">
                    <span v-if="order.deliveredOn" class="portfolio-stage"
                      ><AppIcon name="truck" /> Entregue</span
                    >
                    <span v-else-if="stageFor(order)" class="portfolio-stage"
                      ><AppIcon :name="stageFor(order).icon" />
                      {{ stageFor(order).label }}</span
                    >
                    <span
                      v-else-if="order.productionEditable"
                      class="portfolio-stage"
                      >Etapa a confirmar</span
                    >
                    <template v-else>{{ situation(order) }}</template>
                    <small
                      v-if="fichaPrintedLabel(order)"
                      class="order-context"
                      >{{ fichaPrintedLabel(order) }}</small
                    >
                    <button
                      v-if="order.cutMap"
                      type="button"
                      class="portfolio-cut-history"
                      @click="cutMembership?.open(order, $event.currentTarget)"
                    >
                      Mapa de corte {{ order.cutMap.number
                      }}<span class="sr-only">
                        · Pedido {{ order.number }}</span
                      >
                    </button>
                  </td>
                  <td class="num order-cell-quantity" data-label="Peças">
                    {{ order.totalPieces }}
                  </td>
                  <td class="num order-cell-value" data-label="Valor">
                    <span class="order-amount">{{
                      amountLabel(order.finalAmountCents)
                    }}</span>
                  </td>
                  <td class="order-cell-actions">
                    <label
                      v-if="cutMode && order.cutMapAvailable"
                      class="portfolio-cut-order"
                    >
                      <input
                        type="checkbox"
                        :checked="cutSelection.has(order.id)"
                        :disabled="
                          cutSelection.size >= 50 && !cutSelection.has(order.id)
                        "
                        @change="selectForCut(order, $event)"
                      />
                      Selecionar pedido
                      <span class="sr-only">{{ order.number }}</span>
                    </label>
                    <span v-else-if="cutMode">{{
                      order.cutMap ? 'Incluído no mapa' : 'Seleção indisponível'
                    }}</span>
                    <OrderListActions
                      v-else
                      :order="order"
                      :stage="stageFor(order)"
                      :stage-busy="Boolean(productionBusy)"
                      :pdf-busy-id="pdfBusyId"
                      @pdf="generatePdf(order)"
                      @receipt="receiptPreview?.open(order, $event)"
                      @stage="changeStage(order, $event)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>
    <button
      v-if="nextCursor && !loading && hasLoaded"
      class="load-more"
      type="button"
      :disabled="loadingMore || refreshing"
      @click="loadMore"
    >
      {{ loadingMore ? 'Carregando…' : 'Ver mais' }}
    </button>
    <OrderReceiptPreview
      ref="receiptPreview"
      :orders="items"
      :fallback-focus="receiptFocusFallback"
    />
    <OrderCutMapPreview
      ref="cutPreview"
      @orders-mapped="removeMappedOrders"
      @closed="restoreCutSelectionFocus"
    />
    <OrderCutMapMembership ref="cutMembership" />
  </div>
</template>

<style scoped>
.clickable-row {
  cursor: pointer;
}
</style>
