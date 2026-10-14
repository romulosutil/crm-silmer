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
import { commandKey, request } from '../lib/api-client.js';
import { dateTimeBR, formatPhoneNumber } from '../lib/format.js';
import { openDialog } from '../lib/ui.js';
import {
  amountLabel,
  elapsedSince,
  fichaPrintedLabel,
  isStoreOrder,
  missingHeadline,
  STORE_ORIGIN_LABEL,
  storeConfirmationLabel,
  storeFichaPending,
  storeProductLabel,
} from '../lib/order-format.js';

const LIVE_REFRESH_DELAY_MS = 250;
// ADR 031: long enough for the print tab's request to reach the API.
const PRINT_REFRESH_DELAY_MS = 2000;
const SEARCH_DELAY_MS = 300;
const PAGE_SIZE = 25;

// ADRs 027 and 028: "Loja do site" narrows the list to the site shop's
// orders, all of them confirmed and paid through InfinitePay.
const STORE_FILTER = 'loja';
const FILTERS = Object.freeze([
  Object.freeze({ label: 'Todos', value: '' }),
  Object.freeze({ label: 'Confirmados', value: 'confirmado' }),
  Object.freeze({ label: 'Pendentes', value: 'pendente' }),
  Object.freeze({ label: STORE_ORIGIN_LABEL, value: STORE_FILTER }),
]);

const liveEvent = inject('liveEvent', ref(null));
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
// on "Loja do site".
const filter = ref(route.query.origem === STORE_FILTER ? STORE_FILTER : '');
const query = ref('');
const items = ref([]);
const counts = ref({ confirmado: 0, pendente: 0 });
const nextCursor = ref(null);
const loading = ref(true);
const loadingMore = ref(false);
const refreshing = ref(false);
const hasLoaded = ref(false);
const error = ref('');
const errorMode = ref('');
// The clock is refreshed on every load, so the inactivity signal does not freeze at the
// value the first render happened to compute.
const now = ref(new Date());
let controller;
let refreshTimer = 0;
let printRefreshTimer = 0;
let searchTimer = 0;
let clockTimer = 0;

const confirmedOrders = computed(() =>
  items.value.filter((order) => order.status === 'confirmado'),
);
const pendingOrders = computed(() =>
  items.value.filter((order) => order.status === 'pendente'),
);
const showConfirmed = computed(() =>
  ['', 'confirmado', STORE_FILTER].includes(filter.value),
);
const showPending = computed(
  () => filter.value === '' || filter.value === 'pendente',
);
const isEmpty = computed(() => !loading.value && items.value.length === 0);
const canCreateOrder = computed(() =>
  Boolean(
    selectedContact.value
      ? selectedContact.value.phone ||
          newContactPhone.value.replace(/\D/gu, '').length >= 10
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

function openOrder(order, event) {
  if (event.target?.closest?.('a, button, input, select, textarea')) return;
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
      Number(cause?.status) === 403
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
  const params = new globalThis.URLSearchParams({ limit: String(PAGE_SIZE) });
  if (filter.value === STORE_FILTER) params.set('origin', STORE_FILTER);
  else if (filter.value) params.set('status', filter.value);
  const needle = query.value.trim();
  if ((needle.match(/\d/gu) ?? []).length >= 8) {
    return {
      url: '/api/v1/orders/search',
      options: {
        method: 'POST',
        body: {
          limit: PAGE_SIZE,
          q: needle,
          ...(filter.value === STORE_FILTER
            ? { origin: STORE_FILTER }
            : filter.value
              ? { status: filter.value }
              : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
    };
  }
  if (needle) params.set('q', needle);
  if (cursor) params.set('cursor', cursor);
  return { url: `/api/v1/orders?${params}`, options: {} };
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
    items.value = response.data.items;
    counts.value = response.data.counts;
    nextCursor.value = response.data.nextCursor;
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
  if (!nextCursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const listing = listRequest(nextCursor.value);
    const response = await request(listing.url, listing.options);
    items.value = [...items.value, ...response.data.items];
    counts.value = response.data.counts;
    nextCursor.value = response.data.nextCursor;
    now.value = new Date();
    error.value = '';
    errorMode.value = '';
  } catch {
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

/** PIM-02: the document is the API's; the browser's own print dialog runs it. */
/** @param {Record<string, any>} order */
function print(order) {
  globalThis.open(
    `/api/v1/orders/${encodeURIComponent(order.id)}/print`,
    '_blank',
    'noopener',
  );
  // ADR 031: the API records the first print of a new site order while the
  // tab opens; one silent re-read clears "Ficha não impressa" even without
  // the live stream. No polling.
  if (!storeFichaPending(order)) return;
  if (printRefreshTimer) globalThis.clearTimeout(printRefreshTimer);
  printRefreshTimer = globalThis.setTimeout(() => {
    printRefreshTimer = 0;
    void load(true);
  }, PRINT_REFRESH_DELAY_MS);
}

/** @param {string} value */
function selectFilter(value) {
  if (filter.value === value) return;
  filter.value = value;
  void load();
}

/** Collapses bursts of live events into one silent refresh. */
function scheduleLiveRefresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void load(true);
  }, LIVE_REFRESH_DELAY_MS);
}

watch(query, () => {
  if (searchTimer) globalThis.clearTimeout(searchTimer);
  searchTimer = globalThis.setTimeout(() => {
    searchTimer = 0;
    void load();
  }, SEARCH_DELAY_MS);
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
  heading.value?.focus();
  void load();
  clockTimer = globalThis.setInterval(() => {
    now.value = new Date();
  }, 60_000);
});
onBeforeUnmount(() => {
  controller?.abort();
  contactController?.abort();
  newPhoneController?.abort();
  if (contactSearchTimer) globalThis.clearTimeout(contactSearchTimer);
  if (newPhoneSearchTimer) globalThis.clearTimeout(newPhoneSearchTimer);
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  if (printRefreshTimer) globalThis.clearTimeout(printRefreshTimer);
  if (searchTimer) globalThis.clearTimeout(searchTimer);
  if (clockTimer) globalThis.clearInterval(clockTimer);
});
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Carteira</p>
        <h1 ref="heading" tabindex="-1">Pedidos</h1>
        <p>
          Confirmados já podem ter a ficha impressa. Pedidos pendentes podem ser
          retomados pelo vendedor responsável ou administrador.
        </p>
      </div>
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

    <div class="filter-bar">
      <div class="chip-row" role="group" aria-label="Filtrar pedidos">
        <button
          v-for="option in FILTERS"
          :key="option.value"
          class="chip"
          type="button"
          :aria-pressed="filter === option.value"
          @click="selectFilter(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <div class="search-control">
        <label for="order-search">Buscar número, cliente ou telefone</label>
        <div class="search-field">
          <input id="order-search" v-model="query" type="search" />
        </div>
      </div>
      <p class="filter-summary">
        {{ counts.confirmado }} confirmados · {{ counts.pendente }} pendentes
      </p>
    </div>

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
    <section v-else-if="isEmpty" class="surface empty-list" aria-live="polite">
      <h2>Nenhum pedido por aqui</h2>
      <p>Revise o filtro ou a busca informada.</p>
    </section>
    <template v-else>
      <section
        v-if="showConfirmed && confirmedOrders.length"
        class="surface section-gap"
        aria-labelledby="orders-confirmed-title"
      >
        <div class="panel-head">
          <h2 id="orders-confirmed-title">
            Confirmados
            <span class="badge" data-tone="success">{{
              counts.confirmado
            }}</span>
          </h2>
          <p>valor e forma de pagamento registrados</p>
        </div>
        <p class="table-scroll-hint">
          Deslize a tabela para ver todas as colunas.
        </p>
        <div
          class="table-wrap list-scroll"
          role="region"
          tabindex="0"
          aria-label="Pedidos confirmados; role horizontalmente para ver todas as colunas"
        >
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Pedido</th>
                <th scope="col">Cliente</th>
                <th scope="col" class="num">Peças</th>
                <th scope="col" class="num">Valor</th>
                <th scope="col">Situação</th>
                <th scope="col"><span class="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="order in confirmedOrders"
                :key="order.id"
                class="clickable-row"
                @click="openOrder(order, $event)"
              >
                <td>
                  #{{ order.number }}
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
                    <span v-if="order.isTest" class="badge" data-tone="warning"
                      >Teste</span
                    >
                    <!-- LOJ-33: a new site order until its first print. -->
                    <span
                      v-if="storeFichaPending(order)"
                      class="badge"
                      data-tone="warning"
                      >Ficha não impressa</span
                    >
                  </span>
                </td>
                <td>
                  <strong>{{ customerName(order) }}</strong>
                  <small class="order-context">{{
                    customerContext(order)
                  }}</small>
                </td>
                <td class="num">{{ order.totalPieces }}</td>
                <td class="num">{{ amountLabel(order.finalAmountCents) }}</td>
                <td>
                  {{ situation(order) }}
                  <small
                    v-if="fichaPrintedLabel(order)"
                    class="order-context"
                    >{{ fichaPrintedLabel(order) }}</small
                  >
                </td>
                <td>
                  <div class="row-actions">
                    <button class="primary" type="button" @click="print(order)">
                      Imprimir ficha
                    </button>
                    <RouterLink class="button-link" :to="`/pedidos/${order.id}`"
                      >Abrir pedido</RouterLink
                    >
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

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
          <p>o vendedor responsável ou administrador pode continuar</p>
        </div>
        <p class="table-scroll-hint">
          Deslize a tabela para ver todas as colunas.
        </p>
        <div
          class="table-wrap list-scroll"
          role="region"
          tabindex="0"
          aria-label="Pedidos pendentes; role horizontalmente para ver todas as colunas"
        >
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Pedido</th>
                <th scope="col">Cliente</th>
                <th scope="col" class="num">Peças</th>
                <th scope="col" class="num">Valor</th>
                <th scope="col">Situação</th>
                <th scope="col"><span class="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="order in pendingOrders"
                :key="order.id"
                class="clickable-row"
                @click="openOrder(order, $event)"
              >
                <td>#{{ order.number }}</td>
                <td>
                  <strong>{{ customerName(order) }}</strong>
                  <small class="order-context">{{
                    customerContext(order)
                  }}</small>
                </td>
                <td class="num">{{ order.totalPieces }}</td>
                <td class="num">{{ amountLabel(order.finalAmountCents) }}</td>
                <td>
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
                </td>
                <td>
                  <div class="row-actions">
                    <RouterLink class="button-link" :to="`/pedidos/${order.id}`"
                      >Abrir pedido</RouterLink
                    >
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <button
        v-if="nextCursor"
        class="load-more"
        type="button"
        :disabled="loadingMore"
        @click="loadMore"
      >
        {{ loadingMore ? 'Carregando…' : 'Ver mais' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.clickable-row {
  cursor: pointer;
}
</style>
