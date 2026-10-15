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
import { brand } from '../brand/index.js';
import AppIcon from '../components/AppIcon.vue';
import OrderDrawer from '../components/order/OrderDrawer.vue';
import AudioRecorder from '../components/inbox/AudioRecorder.vue';
import MediaMessage from '../components/inbox/MediaMessage.vue';
import { commandKey, request } from '../lib/api-client.js';
import {
  CHANNEL_LABELS,
  conversationLabel,
  dateTimeBR,
  formatPhoneNumber,
  messageText,
} from '../lib/format.js';
import {
  elapsedSince,
  handoffReasonLabel,
  orderStatusLabel,
} from '../lib/order-format.js';
import { openDialog } from '../lib/ui.js';

const ADMIN_CAPABILITY = 'COMMERCIAL_ADMIN';
const LIVE_REFRESH_DELAY_MS = 250;
const DELIVERY_NOTICES = Object.freeze({
  failed: 'Falha no envio',
  outcome_unknown: 'Envio aguardando confirmação',
});
/**
 * PCX-02 (D19): the Inbox is filtered by who has to act next, not by the
 * internal state of the conversation. A pending handoff is the whole of
 * "Aguardando vendedor", so the other two exclude it — an agent that stopped
 * and is waiting must never be counted as still working the conversation.
 *
 * One segmented axis (pesquisa UX 15/10, achado 1): the archived conversations
 * (PCX-05) are its last tab instead of a second switch hidden in a menu, and
 * every tab shows how many conversations it holds.
 */
const STATE_TABS = Object.freeze([
  Object.freeze({ label: 'Todas', params: {}, value: 'all' }),
  Object.freeze({
    label: 'Aguardando vendedor',
    params: { pendingHandoff: 'true' },
    value: 'waiting',
  }),
  Object.freeze({
    label: `Com ${brand.assistant.reference}`,
    params: { automationState: 'assistant', pendingHandoff: 'false' },
    value: 'assistant',
  }),
  Object.freeze({
    label: 'Com vendedor',
    params: { automationState: 'human', pendingHandoff: 'false' },
    value: 'human',
  }),
  Object.freeze({
    archived: true,
    label: 'Arquivadas',
    params: {},
    value: 'archived',
  }),
]);
/** PCX-05: whose conversations are listed, combined with the tab above. */
const QUEUE_FILTERS = Object.freeze([
  { label: 'Todas', value: 'all' },
  { label: 'Minhas', value: 'mine' },
  { label: 'Sem responsável', value: 'unassignedHumanHandoff' },
]);
const CONTEXT_STORAGE_KEY = 'crm.inbox.contextOpen';
const LIST_TIME = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
});
const LIST_DAY = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
});
const LIST_DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
/** Pixels from the bottom that still count as reading the latest message. */
const STICKY_THREAD_GAP_PX = 64;

const props = defineProps({
  /** `/inbox/:conversationId`: the conversation the address opens. */
  conversationId: { type: String, default: '' },
});
const router = useRouter();
const liveEvent = inject('liveEvent', ref(null));
const liveConnection = inject('liveConnection', ref('indisponível'));
const sessionUser = inject(
  'sessionUser',
  computed(() => ({})),
);

const heading = ref(null);
const searchInput = ref(null);
const replyInput = ref(null);
const nameInput = ref(null);
const archiveConfirmationDialog = ref(null);
const closeConfirmationDialog = ref(null);
const closureOutcome = ref('concluido');
const acknowledgePending = ref(false);
const orderDrawer = ref(null);
const conversationHeading = ref(null);
const thread = ref(null);
const moreToggle = ref(null);
const moreMenu = ref(null);
const contextToggle = ref(null);
const transferSelect = ref(null);
const moreOpen = ref(false);
const contextOpen = ref(initialContextOpen());
const query = ref('');
// Painel: each indicator opens the Inbox already filtered
// (`?fila=minhas|sem-responsavel`, `?situacao=aguardando|agente|vendedor`).
const route = useRoute();
const ROUTE_STATE_TAB = Object.freeze({
  agente: 'assistant',
  aguardando: 'waiting',
  vendedor: 'human',
});
const ROUTE_QUEUE = Object.freeze({
  minhas: 'mine',
  'sem-responsavel': 'unassignedHumanHandoff',
});
const stateTab = ref(
  ROUTE_STATE_TAB[String(route.query.situacao ?? '')] ?? 'all',
);
const queueFilter = ref(ROUTE_QUEUE[String(route.query.fila ?? '')] ?? 'all');
/** @type {import('vue').Ref<Record<string, number>>} */
const counts = ref({});
const loading = ref(true);
const detailLoading = ref(false);
const busy = ref(false);
const mediaSending = ref(false);
const error = ref('');
const listError = ref('');
const actionMessage = ref('');
const conversations = ref([]);
const totalCount = ref(0);
const activeId = ref('');
const detail = ref(null);
const subjectState = ref({
  currentSubjectId: null,
  links: [],
  orders: [],
  ordersHasMore: false,
  subjects: [],
});
const subjectError = ref('');
const subjectNotice = ref('');
const subjectBusy = ref(false);
const subjectHeading = ref(null);
const selectedSubjectOrderId = ref('');
const subjectOrderQuery = ref('');
const messageSubjectDrafts = ref({});
const reply = ref('');
const renaming = ref(false);
const draftName = ref('');
const renameBase = ref(null);
const renameConflict = ref(false);
const renameCurrentKnown = ref(false);
const renameTrigger = ref(null);
const transferring = ref(false);
const transferTarget = ref('');
const assignableUsers = ref([]);
// A02: the clock is read again on every load, so "parado há" does not freeze
// at whatever the first render happened to compute.
const now = ref(new Date());
let listController;
let countController;
let detailController;
let subjectController;
const subjectCommandKeys = new Map();
let refreshTimer = 0;
let threadFollowsLatest = true;

const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('pt-BR');
  const matching = needle
    ? conversations.value.filter((conversation) =>
        `${conversation.contact.label} ${conversation.channel === 'site_chat' ? (conversation.contact.phone ?? '') : conversation.contact.externalId} ${messageText(conversation.lastMessage)}`
          .toLocaleLowerCase('pt-BR')
          .includes(needle),
      )
    : conversations.value;
  if (stateTab.value !== 'waiting') return matching;
  // PCX-04: whoever has waited longest is read first. The read model already
  // answers in this order, but the rule is kept where the waiting time is
  // rendered so a local search or a silent refresh cannot reshuffle the queue.
  return [...matching].sort((left, right) =>
    String(left.handoff?.createdAt ?? '').localeCompare(
      String(right.handoff?.createdAt ?? ''),
    ),
  );
});
const visibleConversationLabel = computed(() => {
  const count = filtered.value.length;
  return `${count} ${count === 1 ? 'conversa' : 'conversas'}`;
});
const liveStatusMessage = computed(() => {
  if (liveConnection.value === 'conectado') return '';
  if (liveConnection.value === 'reconectando') {
    return 'Reconectando atualizações. Você pode consultar as conversas agora.';
  }
  if (liveConnection.value === 'conectando') {
    return 'Conectando atualizações automáticas.';
  }
  return 'Atualizações automáticas indisponíveis. Você pode consultar as conversas agora.';
});
const active = computed(() => detail.value?.conversation ?? null);
const isTerminal = computed(() =>
  ['convertida_em_lead', 'sem_lead', 'encerrada'].includes(active.value?.state),
);
const currentUserId = computed(() => sessionUser.value?.id ?? '');
const isAdmin = computed(() =>
  (sessionUser.value?.capabilities ?? []).includes(ADMIN_CAPABILITY),
);
const owner = computed(() => active.value?.assignedUser ?? null);
const ownedByMe = computed(
  () => !owner.value || owner.value.id === currentUserId.value,
);
/**
 * A conversation belongs to whoever took it over. Another seller sees it but
 * cannot act on it; only an administrator overrides that.
 */
const canAct = computed(
  () => !isTerminal.value && (ownedByMe.value || isAdmin.value),
);
const ownerLabel = computed(() => {
  if (!owner.value) return 'Sem responsável';
  if (owner.value.id === currentUserId.value) return 'Você';
  return (
    assignableUsers.value.find((user) => user.id === owner.value.id)?.name ??
    'Outro vendedor'
  );
});
const transferOptions = computed(() =>
  assignableUsers.value.filter((user) => user.id !== currentUserId.value),
);
const canReply = computed(
  () =>
    canAct.value &&
    !pendingHandoff.value &&
    active.value?.automationState === 'human',
);
const pendingHandoff = computed(
  () => active.value?.handoff?.status === 'pending',
);
const canTransfer = computed(
  () =>
    canAct.value &&
    active.value?.automationState === 'human' &&
    Boolean(active.value?.assignedUser),
);
const canArchive = computed(
  () =>
    !isTerminal.value &&
    (isAdmin.value || owner.value?.id === currentUserId.value),
);
const canUnarchive = computed(
  () => canArchive.value && Boolean(active.value?.archivedAt),
);
const canClose = computed(
  () =>
    !isTerminal.value &&
    (isAdmin.value || owner.value?.id === currentUserId.value),
);
const availableSubjectOrders = computed(() =>
  subjectState.value.orders.filter(
    (order) =>
      !subjectState.value.subjects.some(
        (subject) => subject.orderId === order.id,
      ),
  ),
);
/** PCX-08/PCL-10: creating the order follows the owner of the conversation. */
const canCreateOrder = computed(
  () => isAdmin.value || owner.value?.id === currentUserId.value,
);
const showArchived = computed(() => stateTab.value === 'archived');
const canArchiveActive = computed(
  () => canArchive.value && !active.value?.archivedAt,
);
/** "Mais" holds what the header does not show, and only when there is any. */
const hasMoreActions = computed(
  () =>
    isPhone.value ||
    canTransfer.value ||
    canArchiveActive.value ||
    canUnarchive.value,
);
const canSendReply = computed(
  () =>
    canReply.value &&
    !busy.value &&
    !mediaSending.value &&
    Boolean(reply.value.trim()),
);
/**
 * Mobile first (ADR 035): on a phone the header keeps the primary action,
 * "Pedido" and "Mais"; everything else goes to the "Mais" sheet.
 */
const phoneQuery = globalThis.matchMedia?.('(max-width: 768px)');
const isPhone = ref(phoneQuery?.matches ?? false);
/** @param {MediaQueryListEvent} event */
function phoneChanged(event) {
  isPhone.value = event.matches;
  moreOpen.value = false;
}
/** A touch keyboard keeps Enter for a new line (see replyKeydown). */
const touchInput =
  globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
const workspaceView = computed(() =>
  props.conversationId ? 'conversation' : 'list',
);

/**
 * The list reads the time of today's conversations, the day of this year's
 * and the full date of older ones; the exact moment stays in the tooltip.
 *
 * @param {unknown} value
 */
function listWhen(value) {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '';
  const today = now.value;
  if (date.toDateString() === today.toDateString()) {
    return LIST_TIME.format(date);
  }
  return date.getFullYear() === today.getFullYear()
    ? LIST_DAY.format(date)
    : LIST_DATE.format(date);
}

/**
 * A message always shows its time; the day joins it once it is not today.
 *
 * @param {unknown} value
 */
function messageWhen(value) {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '';
  const time = LIST_TIME.format(date);
  return date.toDateString() === now.value.toDateString()
    ? time
    : `${listWhen(value)}, ${time}`;
}

/** @param {string} value */
function tabCount(value) {
  const count = counts.value[value];
  return Number.isFinite(count) ? count : null;
}

/**
 * @param {string} [tabValue]
 * @param {number} [limit] 1 when only the total of a tab is wanted
 */
function listUrl(tabValue = stateTab.value, limit = 100) {
  const tab =
    STATE_TABS.find((item) => item.value === tabValue) ?? STATE_TABS[0];
  const params = new URLSearchParams({
    archived: String(tab.archived === true),
    limit: String(limit),
  });
  for (const [name, value] of Object.entries(tab.params)) {
    params.set(name, value);
  }
  if (queueFilter.value === 'mine' && currentUserId.value) {
    params.set('assignedUserId', currentUserId.value);
  }
  if (queueFilter.value === 'unassignedHumanHandoff') {
    params.set('unassignedHumanHandoff', 'true');
  }
  return `/api/v1/inbox/conversations?${params.toString()}`;
}

/**
 * PCX-03: a conversation only stops for a reason, and the reason is what the
 * seller needs before opening it. A code this build does not know reads as
 * "Aguardando vendedor" instead of disappearing.
 *
 * @param {{handoff?: {status?: string, reasonCode?: unknown}|null}} conversation
 */
function stopReason(conversation) {
  return conversation.handoff?.status === 'pending'
    ? handoffReasonLabel(conversation.handoff.reasonCode)
    : '';
}

/** PCX-03/A02: still since the handoff was raised, not since the last message. */
/** @param {{handoff?: {status?: string, createdAt?: unknown}|null}} conversation */
function waitingFor(conversation) {
  if (conversation.handoff?.status !== 'pending') return '';
  const elapsed = elapsedSince(conversation.handoff.createdAt, now.value);
  return elapsed === '' ? '' : `parado há ${elapsed}`;
}

/** Wide screens show list, conversation and context side by side. */
function isWide() {
  return globalThis.matchMedia?.('(min-width: 1200px)').matches ?? true;
}

/** Phones show one pane at a time: the list or the open conversation. */
function isSinglePane() {
  return globalThis.matchMedia?.('(max-width: 768px)').matches ?? false;
}

/**
 * The context column opens by default only where the conversation keeps its
 * room beside it (1440 px and up); on a 1366 notebook the conversation comes
 * first. Whatever the reader chose last wins (a per-browser convenience).
 */
function initialContextOpen() {
  if (!isWide()) return false;
  const roomy = globalThis.matchMedia?.('(min-width: 1440px)').matches ?? true;
  try {
    const stored = globalThis.localStorage?.getItem(CONTEXT_STORAGE_KEY);
    return stored === null || stored === undefined ? roomy : stored === 'true';
  } catch {
    return roomy;
  }
}

/** @param {boolean} [open] */
async function toggleContext(open = !contextOpen.value) {
  contextOpen.value = open;
  if (isWide()) {
    try {
      globalThis.localStorage?.setItem(CONTEXT_STORAGE_KEY, String(open));
    } catch {
      // Storage may be blocked; the panel still works for this visit.
    }
  }
  await nextTick();
  if (open && !isWide()) {
    /** @type {HTMLElement|null} */ (
      globalThis.document.querySelector('#inbox-context-title')
    )?.focus();
  } else if (!open) {
    // On a phone the panel opens from the "Mais" sheet instead.
    (contextToggle.value ?? moreToggle.value)?.focus();
  }
}

function openContextFromMore() {
  closeMore();
  void toggleContext(true);
}

/** Esc closes the context panel where it covers the conversation. */
function closeContextOverlay() {
  if (contextOpen.value && !isWide()) void toggleContext(false);
}

/** @param {string} id */
async function openConversation(id) {
  if (!id) return;
  if (id === props.conversationId) {
    if (isSinglePane()) conversationHeading.value?.focus();
    return;
  }
  await router.push(`/inbox/${encodeURIComponent(id)}`);
}

async function toggleMore() {
  moreOpen.value = !moreOpen.value;
  if (!moreOpen.value) return;
  await nextTick();
  /** @type {HTMLElement|null} */ (
    moreMenu.value?.querySelector('button:not(:disabled)')
  )?.focus();
}

/** @param {boolean} [restoreFocus] */
function closeMore(restoreFocus = false) {
  if (!moreOpen.value) return;
  moreOpen.value = false;
  if (restoreFocus) moreToggle.value?.focus();
}

/** @param {FocusEvent} event */
function moreFocusOut(event) {
  // The phone sheet closes on its backdrop, an entry or Esc; closing it on
  // blur would let the tap that blurred it fall through to the page.
  if (isPhone.value) return;
  const next = event.relatedTarget;
  const container = /** @type {HTMLElement} */ (event.currentTarget);
  if (!(next instanceof Node) || !container.contains(next)) closeMore();
}

/**
 * Enter sends and Shift+Enter breaks the line, as in the chat apps the team
 * already uses. On a touch keyboard Enter keeps writing a new line, and an
 * IME composition is never cut short.
 *
 * @param {KeyboardEvent} event
 */
function replyKeydown(event) {
  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.altKey ||
    event.isComposing ||
    touchInput
  ) {
    return;
  }
  event.preventDefault();
  if (canSendReply.value) void sendReply();
}

function threadScrolled() {
  const element = thread.value;
  if (!(element instanceof HTMLElement)) return;
  threadFollowsLatest =
    element.scrollHeight - element.scrollTop - element.clientHeight <
    STICKY_THREAD_GAP_PX;
}

/**
 * The history opens on the latest message and follows new ones, unless the
 * reader scrolled up to read something older.
 */
async function anchorThread() {
  if (!threadFollowsLatest) return;
  await nextTick();
  const element = thread.value;
  if (element instanceof HTMLElement) element.scrollTop = element.scrollHeight;
}

async function archiveConversation() {
  const conversationId = active.value?.id;
  const archived = await runCommand(
    'archive',
    {
      expectedVersion: active.value.version,
      reason: 'Conversa arquivada na Caixa de Entrada',
    },
    'Conversa arquivada. Uma nova mensagem do cliente a exibirá novamente.',
  );
  // The archived conversation leaves the list; the next one takes its place.
  if (archived && props.conversationId === conversationId) {
    await router.replace('/inbox');
  }
}

async function unarchiveConversation() {
  const restored = await runCommand(
    'unarchive',
    {
      expectedVersion: active.value.version,
      reason: 'Conversa desarquivada na Caixa de Entrada',
    },
    'Conversa desarquivada e restaurada à Caixa de Entrada.',
  );
  if (restored && showArchived.value) stateTab.value = 'all';
}

/**
 * PCX-07/PCX-09: the drawer opens over the conversation and hands focus back
 * to this button when it closes.
 *
 * @param {MouseEvent} event
 */
function openOrderDrawer(event) {
  const trigger = event.currentTarget;
  if (trigger instanceof HTMLElement) void orderDrawer.value?.open(trigger);
}

/** Asked from "Mais", so the dialog hands focus back to that button. */
function requestArchiveConfirmation() {
  const dialog = archiveConfirmationDialog.value;
  const trigger = moreToggle.value;
  closeMore();
  if (
    !(dialog instanceof HTMLDialogElement) ||
    !(trigger instanceof HTMLElement)
  ) {
    return;
  }
  openDialog(dialog, trigger);
}

async function confirmArchive() {
  archiveConfirmationDialog.value?.close();
  await archiveConversation();
}

/** @param {MouseEvent} event */
function requestCloseConfirmation(event) {
  openCloseConfirmation(event.currentTarget);
}

/** On a phone "Encerrar" lives in the "Mais" sheet; focus returns to it. */
function requestCloseFromMore() {
  closeMore();
  openCloseConfirmation(moreToggle.value);
}

/** @param {EventTarget|null|undefined} trigger */
function openCloseConfirmation(trigger) {
  const dialog = closeConfirmationDialog.value;
  if (
    !(dialog instanceof HTMLDialogElement) ||
    !(trigger instanceof HTMLElement)
  )
    return;
  closureOutcome.value = 'concluido';
  acknowledgePending.value = false;
  openDialog(dialog, trigger);
}

async function confirmClose() {
  const closed = await runCommand(
    'close',
    {
      acknowledgePending: acknowledgePending.value,
      expectedVersion: active.value.version,
      outcome: closureOutcome.value,
    },
    'Conversa encerrada. Uma nova mensagem iniciará outro atendimento.',
  );
  if (closed) {
    closeConfirmationDialog.value?.close();
    await nextTick();
    heading.value?.focus();
  }
}

/** @param {{authorKind?: unknown, direction?: unknown}} message */
function messageFrom(message) {
  if (message.authorKind === 'contact') return 'cliente';
  if (message.authorKind === 'assistant') return 'agente';
  if (message.authorKind === 'human') return 'humano';
  return message.direction === 'inbound' ? 'cliente' : 'agente';
}

/** @param {{authorKind?: unknown, direction?: unknown}} message */
function messageAuthorLabel(message) {
  const from = messageFrom(message);
  if (from === 'cliente') return active.value?.contact.label ?? 'Cliente';
  if (from === 'humano') return 'Vendedor';
  return brand.assistant.name;
}

/**
 * Glossário (achado 5): one name for the assistant, from the brand, and the
 * role only where the author's name does not already say it.
 *
 * @param {{authorKind?: unknown, direction?: unknown}} message
 */
function messageRoleLabel(message) {
  return messageFrom(message) === 'cliente' ? 'Cliente' : '';
}

/** @param {{authorKind?: unknown, direction?: unknown}} message */
function messageInitials(message) {
  const from = messageFrom(message);
  if (from === 'cliente') return 'C';
  if (from === 'humano') return 'V';
  return brand.assistant.name.slice(0, 1).toLocaleUpperCase('pt-BR');
}

/** @param {{deliveryStatus?: unknown, deliveryErrorCode?: unknown}} message */
function deliveryNotice(message) {
  const notice =
    DELIVERY_NOTICES[
      /** @type {keyof typeof DELIVERY_NOTICES} */ (message.deliveryStatus)
    ] ?? null;
  if (!notice) return null;
  const code = message.deliveryErrorCode;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(code)
    ? `${notice} · código técnico: ${code}`
    : notice;
}

/** @param {unknown} cause */
function describeError(cause) {
  const status = Number(/** @type {any} */ (cause)?.status);
  const requestId = /** @type {any} */ (cause)?.problem?.request_id;
  const suffix = requestId ? ` (id ${requestId})` : '';
  if (status === 403) {
    return `Sem permissão para esta ação. A conversa pode estar com outro vendedor.${suffix}`;
  }
  if (status === 409) {
    return `A conversa mudou enquanto você trabalhava. Os dados foram recarregados.${suffix}`;
  }
  if (status === 429) {
    return `Muitas ações seguidas. Aguarde um instante.${suffix}`;
  }
  if (status >= 500) return `Serviço indisponível no momento.${suffix}`;
  return `Não foi possível concluir a ação.${suffix}`;
}

/** @param {boolean} [silent] */
async function loadInbox(silent = false) {
  listController?.abort();
  const controller = new AbortController();
  listController = controller;
  if (!silent) loading.value = true;
  try {
    const response = await request(listUrl(), {
      signal: controller.signal,
    });
    if (controller !== listController) return;
    conversations.value = response.data.items;
    totalCount.value = response.data.totalCount;
    counts.value = {
      ...counts.value,
      [stateTab.value]: Number(response.data.totalCount),
    };
    now.value = new Date();
    listError.value = '';
    void loadCounts();
    await selectVisibleConversation();
  } catch (cause) {
    if (
      controller === listController &&
      /** @type {any} */ (cause)?.name !== 'AbortError'
    ) {
      listError.value =
        'Não foi possível atualizar a Caixa de Entrada. Os resultados exibidos podem estar desatualizados.';
    }
  } finally {
    if (controller === listController) loading.value = false;
  }
}

/**
 * The other tabs only need their totals: one `limit=1` read each, in
 * parallel, with the same queue. A failed total hides its number rather than
 * keeping a stale one.
 */
async function loadCounts() {
  countController?.abort();
  const controller = new AbortController();
  countController = controller;
  const others = STATE_TABS.filter((tab) => tab.value !== stateTab.value);
  const results = await Promise.allSettled(
    others.map((tab) =>
      request(listUrl(tab.value, 1), { signal: controller.signal }),
    ),
  );
  if (controller !== countController) return;
  const next = { ...counts.value };
  results.forEach((result, index) => {
    const value = others[index].value;
    if (result.status === 'fulfilled') {
      next[value] = Number(result.value.data.totalCount);
    } else {
      delete next[value];
    }
  });
  counts.value = next;
}

/** @param {boolean} [silent] */
async function refreshInbox(silent = false) {
  await loadInbox(silent);
}

/**
 * Keeps the detail pane on a conversation the list actually shows. Without
 * this, searching leaves the reader looking at a conversation that has been
 * filtered out of the list beside it.
 *
 * @param {boolean} [refreshActive] refetch even when the selection is unchanged
 */
async function selectVisibleConversation(refreshActive = true) {
  // A conversation opened by its address stays open whatever the list shows:
  // it may be archived, filtered out or beyond the 100 loaded.
  if (props.conversationId) {
    const same =
      activeId.value === props.conversationId && Boolean(detail.value);
    if (refreshActive || !same) {
      await selectConversation(props.conversationId, same);
    }
    return;
  }
  const visible = filtered.value;
  const stillVisible = visible.some((item) => item.id === activeId.value);
  const nextId = stillVisible ? activeId.value : (visible[0]?.id ?? '');
  if (!nextId) {
    activeId.value = '';
    detail.value = null;
    subjectController?.abort();
    subjectState.value = {
      currentSubjectId: null,
      links: [],
      orders: [],
      ordersHasMore: false,
      subjects: [],
    };
    return;
  }
  // Typing in the search box must not refetch the open conversation on every
  // keystroke; only a data refresh or a changed selection needs the request.
  if (stillVisible && !refreshActive && detail.value) return;
  await selectConversation(nextId, stillVisible);
}

/** @param {string} id @param {boolean} [silent] */
async function selectConversation(id, silent = false) {
  if (!id) return;
  detailController?.abort();
  subjectController?.abort();
  const controller = new AbortController();
  detailController = controller;
  if (activeId.value !== id) {
    detail.value = null;
    threadFollowsLatest = true;
    moreOpen.value = false;
    subjectOrderQuery.value = '';
    selectedSubjectOrderId.value = '';
    renaming.value = false;
    renameBase.value = null;
    renameConflict.value = false;
    transferring.value = false;
    subjectState.value = {
      currentSubjectId: null,
      links: [],
      orders: [],
      ordersHasMore: false,
      subjects: [],
    };
    subjectError.value = '';
    subjectNotice.value = '';
  }
  activeId.value = id;
  if (!silent) detailLoading.value = true;
  try {
    const response = await request(
      `/api/v1/inbox/conversations/${encodeURIComponent(id)}`,
      { signal: controller.signal },
    );
    if (controller !== detailController || activeId.value !== id) return;
    detail.value = response.data;
    void loadSubjects(id);
  } catch (cause) {
    if (
      controller === detailController &&
      activeId.value === id &&
      /** @type {any} */ (cause)?.name !== 'AbortError'
    ) {
      error.value = 'Não foi possível carregar a conversa selecionada.';
      if (!silent || !renaming.value) detail.value = null;
    }
  } finally {
    if (controller === detailController && activeId.value === id)
      detailLoading.value = false;
  }
}

/** @param {string} conversationId */
async function loadSubjects(conversationId) {
  subjectController?.abort();
  const controller = new AbortController();
  subjectController = controller;
  try {
    const response = await request(
      `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/subjects?order=${encodeURIComponent(subjectOrderQuery.value.trim())}`,
      { signal: controller.signal },
    );
    if (controller !== subjectController || activeId.value !== conversationId)
      return;
    const subjects = response.data;
    if (
      !Array.isArray(subjects?.subjects) ||
      !Array.isArray(subjects.links) ||
      !Array.isArray(subjects.orders)
    ) {
      throw new Error('Invalid conversation subjects response');
    }
    subjectState.value = subjects;
    messageSubjectDrafts.value = Object.fromEntries(
      (detail.value?.messages ?? []).map((message) => [
        message.id,
        subjects.links
          .filter((link) => link.messageId === message.id)
          .map((link) => link.subjectId),
      ]),
    );
    subjectError.value = '';
  } catch (cause) {
    if (controller === subjectController && cause?.name !== 'AbortError') {
      subjectError.value =
        'Não foi possível consultar os assuntos desta conversa.';
    }
  }
}

/** @param {string} kind @param {string|null} [target] */
async function subjectCommand(kind, target = null) {
  if (!active.value || subjectBusy.value) return;
  subjectBusy.value = true;
  subjectError.value = '';
  subjectNotice.value = '';
  const conversationId = active.value.id;
  const base = `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}`;
  const subjectIds =
    kind === 'tag'
      ? [...(messageSubjectDrafts.value[target] ?? [])].sort()
      : [];
  const signature = JSON.stringify([conversationId, kind, target, subjectIds]);
  const idempotencyKey = subjectCommandKeys.get(signature) ?? commandKey();
  subjectCommandKeys.set(signature, idempotencyKey);
  try {
    if (kind === 'create') {
      await request(`${base}/subjects`, {
        body: { orderId: target },
        idempotencyKey,
        method: 'POST',
      });
      selectedSubjectOrderId.value = '';
    } else if (kind === 'select') {
      await request(`${base}/subjects/${encodeURIComponent(target)}/select`, {
        body: {},
        idempotencyKey,
        method: 'POST',
      });
    } else if (kind === 'tag') {
      await request(`${base}/messages/${encodeURIComponent(target)}/subjects`, {
        body: { subjectIds },
        idempotencyKey,
        method: 'PUT',
      });
    }
    subjectCommandKeys.delete(signature);
    await loadSubjects(conversationId);
    if (activeId.value !== conversationId) return;
    if (!subjectError.value) {
      subjectNotice.value =
        kind === 'tag'
          ? 'Assuntos da mensagem salvos.'
          : kind === 'select'
            ? 'Assunto atual alterado.'
            : 'Assunto criado e selecionado.';
    }
    if (kind === 'create' || kind === 'select') {
      await nextTick();
      subjectHeading.value?.focus();
    }
  } catch (cause) {
    if (activeId.value !== conversationId) return;
    subjectError.value = describeError(cause);
    if (cause?.status === 409) {
      subjectCommandKeys.delete(signature);
      await loadSubjects(conversationId);
    }
  } finally {
    subjectBusy.value = false;
  }
}

/** @param {Record<string, any>} subject */
function subjectLabel(subject) {
  return subject.orderId
    ? `Pedido ${subject.orderNumber ?? ''}`
    : `Assunto sem pedido ${subject.position}`;
}

/** @param {string} messageId */
function messageSubjectLabels(messageId) {
  return subjectState.value.links
    .filter((link) => link.messageId === messageId)
    .map((link) =>
      subjectState.value.subjects.find(
        (subject) => subject.id === link.subjectId,
      ),
    )
    .filter(Boolean)
    .map(subjectLabel)
    .join(', ');
}

/** @param {string} path @param {Record<string, unknown>} body @param {string} successMessage */
async function runCommand(path, body, successMessage) {
  if (!active.value || busy.value || mediaSending.value) return;
  busy.value = true;
  error.value = '';
  actionMessage.value = '';
  try {
    await request(
      `/api/v1/conversations/${encodeURIComponent(active.value.id)}/${path}`,
      {
        body,
        idempotencyKey: commandKey(),
        method: 'POST',
      },
    );
    actionMessage.value = successMessage;
    await loadInbox(true);
    return true;
  } catch (cause) {
    error.value = describeError(cause);
    if (/** @type {any} */ (cause)?.status === 409) await loadInbox(true);
    return false;
  } finally {
    busy.value = false;
  }
}

/**
 * The only automation change a person makes is taking the conversation from
 * the bot; ADR 015 removed handing it back.
 *
 * @param {string} path @param {string} successMessage
 */
async function changeAutomation(path, successMessage) {
  await runCommand(
    path,
    {
      expectedVersion: active.value.version,
      reason: 'Ação manual na Caixa de Entrada',
    },
    successMessage,
  );
}

async function sendReply() {
  const text = reply.value.trim();
  if (!text || !active.value) return;
  await runCommand(
    'messages',
    {
      content: { text },
      expectedVersion: active.value.version,
      messageType: 'text',
      reason: 'Resposta humana na Caixa de Entrada',
    },
    'Mensagem aceita para envio.',
  );
  if (!error.value) {
    reply.value = '';
    await nextTick();
    replyInput.value?.focus();
  }
}

async function mediaSent() {
  actionMessage.value = 'Mensagem aceita para envio.';
  await loadInbox(true);
}

async function loadAssignableUsers() {
  if (assignableUsers.value.length) return;
  try {
    const response = await request('/api/v1/users/assignable');
    assignableUsers.value = response.data.users ?? [];
  } catch {
    assignableUsers.value = [];
  }
}

async function openTransfer() {
  if (!canTransfer.value) return;
  closeMore();
  await loadAssignableUsers();
  transferTarget.value = transferOptions.value[0]?.id ?? '';
  transferring.value = true;
  await nextTick();
  transferSelect.value?.focus();
}

function cancelTransfer() {
  transferring.value = false;
  moreToggle.value?.focus();
}

async function confirmTransfer() {
  if (!transferTarget.value) return;
  const targetName =
    transferOptions.value.find((user) => user.id === transferTarget.value)
      ?.name ?? 'outro vendedor';
  await runCommand(
    'transfer',
    {
      expectedVersion: active.value.version,
      reason: 'Repasse de atendimento na Caixa de Entrada',
      targetUserId: transferTarget.value,
    },
    `Atendimento repassado para ${targetName}.`,
  );
  if (!error.value) transferring.value = false;
}

async function claimHandoff() {
  const conversation = active.value;
  const handoff = conversation?.handoff;
  if (!conversation || handoff?.status !== 'pending' || busy.value) return;
  busy.value = true;
  error.value = '';
  actionMessage.value = '';
  try {
    await request(`/api/v1/handoffs/${encodeURIComponent(handoff.id)}/claim`, {
      body: {
        expectedConversationVersion: conversation.version,
        expectedHandoffVersion: handoff.version,
        reasonCode: 'handoff_claimed',
      },
      idempotencyKey: commandKey(),
      method: 'POST',
    });
    actionMessage.value = `Atendimento de ${conversation.contact.label} assumido.`;
    await loadInbox(true);
    await selectConversation(conversation.id);
  } catch (cause) {
    if (/** @type {any} */ (cause)?.status === 409) {
      error.value =
        'Este handoff já foi assumido ou mudou. A Caixa de Entrada foi atualizada.';
      await refreshInbox(true);
    } else {
      error.value = describeError(cause);
    }
  } finally {
    busy.value = false;
  }
}

async function openRename() {
  if (!active.value) return;
  draftName.value = active.value?.contact.displayName ?? '';
  renameBase.value = {
    contactId: active.value.contact.id,
    conversationId: active.value.id,
    expectedVersion: active.value.contact.version,
  };
  renameConflict.value = false;
  renameCurrentKnown.value = false;
  error.value = '';
  renaming.value = true;
  await nextTick();
  nameInput.value?.focus();
}

async function refreshConflictName() {
  const base = renameBase.value;
  if (!base) return;
  try {
    const response = await request(
      `/api/v1/inbox/conversations/${encodeURIComponent(base.conversationId)}`,
    );
    if (
      renameBase.value !== base ||
      activeId.value !== base.conversationId ||
      response.data.conversation?.contact?.id !== base.contactId
    )
      return;
    detail.value = response.data;
    renameCurrentKnown.value = true;
  } catch {
    renameCurrentKnown.value = false;
  }
}

async function cancelRename() {
  const base = renameBase.value;
  const hadConflict = renameConflict.value;
  renaming.value = false;
  renameBase.value = null;
  renameConflict.value = false;
  renameCurrentKnown.value = false;
  if (hadConflict && base && activeId.value === base.conversationId) {
    await selectConversation(base.conversationId, true);
  }
  await nextTick();
  renameTrigger.value?.focus();
}

async function saveName() {
  const base = renameBase.value;
  if (
    !base ||
    active.value?.id !== base.conversationId ||
    busy.value ||
    renameConflict.value
  )
    return;
  busy.value = true;
  error.value = '';
  actionMessage.value = '';
  try {
    await request(
      `/api/v1/contacts/${encodeURIComponent(base.contactId)}/name`,
      {
        body: {
          displayName: draftName.value.trim(),
          expectedVersion: base.expectedVersion,
          reason: 'Nome do contato ajustado na Caixa de Entrada',
        },
        method: 'POST',
      },
    );
    actionMessage.value = 'Nome do contato atualizado.';
    renaming.value = false;
    renameBase.value = null;
    await loadInbox(true);
    await nextTick();
    renameTrigger.value?.focus();
  } catch (cause) {
    if (Number(cause?.status) === 409) {
      renameConflict.value = true;
      await refreshConflictName();
      await nextTick();
      nameInput.value?.focus();
    } else {
      error.value = describeError(cause);
    }
  } finally {
    busy.value = false;
  }
}

function clearSearch() {
  query.value = '';
  void nextTick(() => searchInput.value?.focus());
}

/**
 * Live events arrive in bursts (a takeover bumps the conversation and queues a
 * message). Collapse them into a single silent refresh so the panel never
 * flickers or stampedes the read model.
 */
function scheduleLiveRefresh() {
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    void refreshInbox(true);
  }, LIVE_REFRESH_DELAY_MS);
}

watch(query, () => void selectVisibleConversation(false));
watch(stateTab, () => void refreshInbox());
watch(queueFilter, () => {
  // Every total changes with the queue; none of the old ones may linger.
  counts.value = {};
  void refreshInbox();
});
watch(
  () => props.conversationId,
  async (id, previous) => {
    if (id) {
      await selectConversation(
        id,
        id === activeId.value && Boolean(detail.value),
      );
      // On a phone the list gives way to the conversation; focus follows it.
      if (isSinglePane()) {
        await nextTick();
        conversationHeading.value?.focus();
      }
      return;
    }
    await selectVisibleConversation(false);
    if (isSinglePane() && previous) {
      await nextTick();
      /** @type {HTMLElement|null} */ (
        globalThis.document.querySelector(
          `.conversation-row[data-conversation-id="${CSS.escape(previous)}"]`,
        )
      )?.focus();
    }
  },
);
watch(
  () => [
    activeId.value,
    detail.value?.messages?.length,
    detailLoading.value,
    subjectState.value.subjects.length,
    subjectState.value.links.length,
  ],
  () => void anchorThread(),
  { flush: 'post' },
);
watch(liveEvent, (event) => {
  if (event) scheduleLiveRefresh();
});
watch(liveConnection, (state, previous) => {
  if (state === 'conectado' && previous !== 'conectado') {
    void refreshInbox(true);
  }
});
onMounted(() => {
  phoneQuery?.addEventListener('change', phoneChanged);
  heading.value?.focus();
  void refreshInbox();
  void loadAssignableUsers();
});
onBeforeUnmount(() => {
  phoneQuery?.removeEventListener('change', phoneChanged);
  listController?.abort();
  countController?.abort();
  detailController?.abort();
  subjectController?.abort();
  if (refreshTimer) globalThis.clearTimeout(refreshTimer);
});
</script>

<template>
  <div class="page inbox-page" :data-view="workspaceView">
    <div class="inbox-toolbar">
      <h1 ref="heading" class="inbox-title" tabindex="-1">Caixa de Entrada</h1>
      <div class="inbox-tabs" role="group" aria-label="Estado das conversas">
        <button
          v-for="tab in STATE_TABS"
          :key="tab.value"
          type="button"
          class="inbox-tab"
          :aria-pressed="stateTab === tab.value"
          @click="stateTab = tab.value"
        >
          {{ tab.label }}
          <span
            v-if="tabCount(tab.value) !== null"
            class="inbox-tab-count"
            :data-tone="
              tab.value === 'waiting' && tabCount(tab.value) > 0
                ? 'attention'
                : undefined
            "
            >{{ tabCount(tab.value) }}</span
          >
        </button>
      </div>
      <div class="inbox-queue">
        <label for="inbox-queue">Fila</label>
        <select id="inbox-queue" v-model="queueFilter">
          <option
            v-for="filter in QUEUE_FILTERS"
            :key="filter.value"
            :value="filter.value"
          >
            {{ filter.label }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="liveStatusMessage" class="inbox-notice inbox-live-notice">
      <p role="status">{{ liveStatusMessage }}</p>
      <button
        v-if="
          liveConnection === 'indisponível' || liveConnection === 'reconectando'
        "
        type="button"
        aria-label="Atualizar conversas"
        :disabled="loading"
        @click="refreshInbox()"
      >
        Atualizar
      </button>
    </div>
    <p v-if="listError" role="alert" class="inbox-notice" data-tone="error">
      {{ listError }}
    </p>

    <div
      class="inbox-workspace"
      :data-context="active && contextOpen ? 'open' : 'closed'"
    >
      <div class="inbox-list-pane">
        <div class="inbox-search" role="search">
          <label for="inbox-search" class="sr-only"
            >Buscar nas conversas exibidas</label
          >
          <div class="search-field">
            <AppIcon class="inbox-search-icon" name="search" />
            <input
              id="inbox-search"
              ref="searchInput"
              v-model="query"
              type="search"
              placeholder="Buscar contato, telefone ou mensagem"
              aria-describedby="inbox-search-help"
            />
            <button
              v-if="query"
              type="button"
              class="quiet"
              aria-label="Limpar busca"
              @click="clearSearch"
            >
              Limpar
            </button>
          </div>
          <p id="inbox-search-help" class="sr-only">
            Busca em até 100 conversas carregadas: contato, telefone ou última
            mensagem.
          </p>
        </div>
        <p class="inbox-list-summary" role="status">
          {{ loading ? 'Carregando conversas…' : visibleConversationLabel }}
        </p>
        <ul class="inbox-list" aria-label="Conversas" :aria-busy="loading">
          <li v-for="conversation in filtered" :key="conversation.id">
            <button
              type="button"
              class="conversation-row"
              :data-conversation-id="conversation.id"
              :aria-current="activeId === conversation.id ? 'true' : undefined"
              @click="openConversation(conversation.id)"
            >
              <span class="conv-top">
                <span class="conv-name">{{ conversation.contact.label }}</span>
                <time
                  class="conv-time"
                  :datetime="conversation.updatedAt"
                  :title="dateTimeBR(conversation.updatedAt)"
                  >{{ listWhen(conversation.updatedAt) }}</time
                >
              </span>
              <span class="conv-snippet">{{
                messageText(conversation.lastMessage)
              }}</span>
              <span class="conv-meta">
                <span class="conv-channel">{{
                  CHANNEL_LABELS[conversation.channel]
                }}</span>
                <span
                  class="badge"
                  :data-tone="conversation.requiresAttention ? 'error' : 'info'"
                >
                  {{ conversationLabel(conversation) }}
                </span>
                <span
                  v-if="stopReason(conversation)"
                  class="badge"
                  data-tone="error"
                  >{{ stopReason(conversation) }}</span
                >
                <span v-if="waitingFor(conversation)" class="conv-waiting">{{
                  waitingFor(conversation)
                }}</span>
                <span
                  v-if="
                    conversation.assignedUser &&
                    conversation.assignedUser.id !== currentUserId
                  "
                  class="badge"
                  data-tone="info"
                  >Outro vendedor</span
                >
              </span>
            </button>
          </li>
          <li v-if="!loading && !filtered.length" class="empty-list">
            <h2>Nenhuma conversa encontrada</h2>
            <p>
              {{
                query
                  ? 'Revise a busca informada.'
                  : 'Nada nesta aba agora. Escolha outra aba ou fila.'
              }}
            </p>
          </li>
        </ul>
      </div>

      <section
        class="inbox-conversation"
        :aria-labelledby="active ? `conversation-${active.id}` : undefined"
        :aria-label="active ? undefined : 'Conversa selecionada'"
      >
        <div v-if="error || actionMessage" class="inbox-pane-notices">
          <p v-if="error" role="alert" class="inbox-notice" data-tone="error">
            {{ error }}
          </p>
          <p v-if="actionMessage" role="status" class="inbox-notice">
            {{ actionMessage }}
          </p>
        </div>

        <template v-if="active">
          <header class="conv-head">
            <RouterLink class="conv-back" to="/inbox" title="Conversas">
              <AppIcon name="back" /><span class="sr-only">Conversas</span>
            </RouterLink>
            <div class="conv-title">
              <h2
                :id="`conversation-${active.id}`"
                ref="conversationHeading"
                tabindex="-1"
              >
                {{ active.contact.label }}
              </h2>
              <p class="conv-identity">
                {{ CHANNEL_LABELS[active.channel] }} ·
                <template v-if="active.channel === 'site_chat'">
                  {{
                    active.contact.phone
                      ? formatPhoneNumber(active.contact.phone)
                      : 'Telefone do chat indisponível'
                  }}
                  <template v-if="active.contact.phone">
                    · telefone informado no site</template
                  >
                </template>
                <template v-else>{{
                  formatPhoneNumber(active.contact.externalId)
                }}</template>
                ·
                {{ conversationLabel(active) }}
                <template v-if="active.automationState === 'human'">
                  · {{ ownerLabel }}
                </template>
              </p>
            </div>
            <!-- One primary action, two visible, the rest under "Mais"
                 (pesquisa UX, achado 1). ADR 015: once a person has the
                 conversation it never goes back to the bot, so there is no
                 hand-back action here. -->
            <div class="conv-actions">
              <button
                v-if="pendingHandoff"
                type="button"
                class="primary"
                :disabled="busy || !canAct"
                @click="claimHandoff"
              >
                Assumir atendimento
              </button>
              <button
                v-else-if="active.automationState === 'assistant'"
                type="button"
                class="primary"
                :disabled="busy || !canAct"
                @click="
                  changeAutomation(
                    'takeover',
                    'Atendimento assumido por uma pessoa.',
                  )
                "
              >
                Assumir atendimento
              </button>
              <button type="button" @click="openOrderDrawer">
                Pedido · {{ orderStatusLabel(active.order?.status) }}
              </button>
              <button
                v-if="canClose && !isPhone"
                type="button"
                :disabled="busy"
                @click="requestCloseConfirmation"
              >
                Encerrar conversa
              </button>
              <div
                v-if="hasMoreActions"
                class="conv-more"
                @focusout="moreFocusOut"
                @keydown.esc.stop="closeMore(true)"
              >
                <button
                  ref="moreToggle"
                  type="button"
                  aria-label="Mais ações"
                  aria-controls="conv-more-menu"
                  :aria-expanded="moreOpen"
                  @click="toggleMore"
                >
                  Mais <AppIcon name="chevron-down" />
                </button>
                <div
                  v-if="moreOpen && isPhone"
                  class="conv-more-backdrop"
                  aria-hidden="true"
                  @click="closeMore(true)"
                ></div>
                <div
                  id="conv-more-menu"
                  ref="moreMenu"
                  class="conv-more-panel"
                  :hidden="!moreOpen"
                >
                  <button
                    v-if="isPhone"
                    type="button"
                    aria-controls="inbox-context"
                    :aria-expanded="contextOpen"
                    @click="openContextFromMore"
                  >
                    <AppIcon name="panel" />Detalhes da conversa
                  </button>
                  <button
                    v-if="canTransfer"
                    type="button"
                    :disabled="busy"
                    @click="openTransfer"
                  >
                    Repassar atendimento
                  </button>
                  <button
                    v-if="canArchiveActive"
                    type="button"
                    :disabled="busy"
                    @click="requestArchiveConfirmation"
                  >
                    Arquivar conversa
                  </button>
                  <button
                    v-if="canUnarchive"
                    type="button"
                    :disabled="busy"
                    @click="
                      closeMore(true);
                      unarchiveConversation();
                    "
                  >
                    Desarquivar conversa
                  </button>
                  <button
                    v-if="canClose && isPhone"
                    type="button"
                    :disabled="busy"
                    @click="requestCloseFromMore"
                  >
                    Encerrar conversa
                  </button>
                </div>
              </div>
              <button
                v-if="!isPhone"
                ref="contextToggle"
                type="button"
                class="quiet conv-context-toggle"
                title="Detalhes da conversa"
                aria-controls="inbox-context"
                :aria-expanded="contextOpen"
                @click="toggleContext()"
              >
                <AppIcon name="panel" />
                <span class="sr-only">Detalhes</span>
              </button>
            </div>
          </header>

          <p v-if="!canAct && !isTerminal" class="inbox-notice">
            Esta conversa está sob responsabilidade de outro vendedor. Só quem
            atende ou um administrador pode agir.
          </p>
          <p v-if="active.archivedAt" class="inbox-notice">
            Conversa arquivada. Uma nova mensagem do cliente a devolve à Caixa
            de Entrada.
          </p>

          <form
            v-if="transferring"
            class="transfer-form"
            @submit.prevent="confirmTransfer"
          >
            <label :for="`transfer-${active.id}`">Repassar venda para</label>
            <select
              :id="`transfer-${active.id}`"
              ref="transferSelect"
              v-model="transferTarget"
            >
              <option
                v-for="user in transferOptions"
                :key="user.id"
                :value="user.id"
              >
                {{ user.name }}
              </option>
            </select>
            <div class="inline-actions">
              <button
                type="submit"
                class="primary"
                :disabled="busy || !transferTarget"
              >
                Confirmar repasse
              </button>
              <button type="button" :disabled="busy" @click="cancelTransfer">
                Cancelar
              </button>
            </div>
            <p v-if="!transferOptions.length">
              Nenhum outro vendedor disponível para receber a venda.
            </p>
          </form>

          <div v-if="detailLoading" class="loading-state thread" role="status">
            Carregando histórico…
          </div>
          <!-- A scrollable history must be reachable by keyboard (WCAG 2.1.1). -->
          <ol
            v-else
            ref="thread"
            class="thread"
            aria-label="Histórico da conversa"
            tabindex="0"
            @scroll.passive="threadScrolled"
            @load.capture="anchorThread"
          >
            <li
              v-for="message in detail.messages"
              :key="message.id"
              class="message"
              :data-from="messageFrom(message)"
              :data-side="message.direction === 'outbound' ? 'out' : 'in'"
            >
              <div class="msg-head">
                <span class="msg-sender">
                  <span class="message-avatar" aria-hidden="true">{{
                    messageInitials(message)
                  }}</span>
                  <strong class="msg-author">{{
                    messageAuthorLabel(message)
                  }}</strong>
                  <span v-if="messageRoleLabel(message)" class="msg-role">{{
                    messageRoleLabel(message)
                  }}</span>
                </span>
                <time
                  class="msg-time"
                  :datetime="message.occurredAt"
                  :title="dateTimeBR(message.occurredAt)"
                  >{{ messageWhen(message.occurredAt) }}</time
                >
              </div>
              <p>{{ message.preview }}</p>
              <MediaMessage v-if="message.media" :media="message.media" />
              <small v-if="message.deliveryMode === 'dev'"
                >DEV: envio simulado</small
              >
              <small v-if="deliveryNotice(message)" class="msg-delivery">{{
                deliveryNotice(message)
              }}</small>
              <details
                v-if="canClose && subjectState.subjects.length"
                class="message-subjects"
              >
                <summary>
                  Assuntos desta mensagem<template
                    v-if="messageSubjectLabels(message.id)"
                    >: {{ messageSubjectLabels(message.id) }}</template
                  >
                </summary>
                <fieldset>
                  <legend>Marque todos os assuntos mencionados</legend>
                  <label
                    v-for="subject in subjectState.subjects"
                    :key="subject.id"
                  >
                    <input
                      v-model="messageSubjectDrafts[message.id]"
                      type="checkbox"
                      :value="subject.id"
                      :disabled="subjectBusy"
                    />
                    {{ subjectLabel(subject) }}
                  </label>
                </fieldset>
                <button
                  type="button"
                  :disabled="subjectBusy"
                  @click="subjectCommand('tag', message.id)"
                >
                  Salvar assuntos
                </button>
              </details>
              <small v-else-if="messageSubjectLabels(message.id)">
                Assuntos: {{ messageSubjectLabels(message.id) }}
              </small>
            </li>
            <li v-if="!detail.messages.length" class="empty-list">
              Sem mensagens persistidas.
            </li>
          </ol>

          <div class="inbox-composer">
            <AudioRecorder
              :key="active.id"
              :conversation-id="active.id"
              :expected-version="active.version"
              :disabled="busy || !canReply || active.channel === 'site_chat'"
              @sending-change="mediaSending = $event"
              @sent="mediaSent"
            >
              <template #message="{ recordingActive }">
                <form
                  id="inbox-reply-form"
                  class="composer"
                  @submit.prevent="sendReply"
                >
                  <label for="reply" class="sr-only">Responder</label>
                  <textarea
                    id="reply"
                    ref="replyInput"
                    v-model="reply"
                    rows="2"
                    placeholder="Digite uma mensagem…"
                    maxlength="2000"
                    :disabled="
                      busy || mediaSending || recordingActive || !canReply
                    "
                    aria-describedby="reply-help"
                    @keydown="replyKeydown"
                  ></textarea>
                  <p id="reply-help" class="composer-help">
                    <template v-if="isTerminal"
                      >A conversa está encerrada.</template
                    >
                    <template v-else-if="!canAct"
                      >Somente o vendedor responsável pode responder.</template
                    >
                    <template
                      v-else-if="
                        pendingHandoff || active.automationState !== 'human'
                      "
                      >Assuma o atendimento antes de responder.</template
                    >
                    <template v-else-if="touchInput"
                      >Toque em Enviar resposta para enviar.</template
                    >
                    <template v-else
                      >Enter envia · Shift+Enter quebra a linha.</template
                    >
                  </p>
                </form>
              </template>
              <template #send="{ recordingActive }">
                <button
                  type="submit"
                  form="inbox-reply-form"
                  class="primary"
                  :disabled="
                    busy ||
                    mediaSending ||
                    recordingActive ||
                    !canReply ||
                    !reply.trim()
                  "
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14" />
                  </svg>
                  Enviar resposta
                </button>
              </template>
            </AudioRecorder>
          </div>
        </template>
        <div v-else-if="detailLoading" class="loading-state" role="status">
          Carregando conversa…
        </div>
        <div v-else class="empty-list inbox-empty" aria-live="polite">
          <h2 id="inbox-empty-title">Selecione uma conversa</h2>
          <p>O histórico, a resposta e as ações aparecerão aqui.</p>
        </div>
      </section>

      <aside
        v-if="active"
        id="inbox-context"
        class="inbox-context"
        aria-labelledby="inbox-context-title"
        :hidden="!contextOpen"
        @keydown.esc="closeContextOverlay"
      >
        <div class="inbox-context-head">
          <h2 id="inbox-context-title" tabindex="-1">Detalhes</h2>
          <button
            type="button"
            class="quiet"
            aria-label="Recolher detalhes"
            @click="toggleContext(false)"
          >
            <AppIcon name="close" />
          </button>
        </div>

        <section class="context-section" aria-labelledby="context-order-title">
          <h3 id="context-order-title">Pedido</h3>
          <template v-if="active.order">
            <p class="context-order">
              <strong>{{ active.order.number }}</strong>
              <span class="badge" data-tone="info">{{
                orderStatusLabel(active.order.status)
              }}</span>
            </p>
            <RouterLink
              :to="`/pedidos/${encodeURIComponent(active.order.id)}?conversa=${encodeURIComponent(active.id)}`"
              >Ir para o pedido {{ active.order.number }}</RouterLink
            >
          </template>
          <p v-else class="op-hint">
            Esta conversa ainda não tem pedido. O botão “Pedido” mostra o resumo
            e cria o pedido quando você puder.
          </p>
        </section>

        <section class="subject-panel" aria-labelledby="subject-panel-title">
          <h3 id="subject-panel-title" ref="subjectHeading" tabindex="-1">
            Assuntos deste atendimento
          </h3>
          <p v-if="subjectError" role="alert">{{ subjectError }}</p>
          <p v-if="subjectNotice" role="status">{{ subjectNotice }}</p>
          <p v-if="!subjectState.subjects.length" class="op-hint">
            Ainda não há assunto classificado. As mensagens permanecem no
            histórico.
          </p>
          <ul v-else class="subject-list">
            <li v-for="subject in subjectState.subjects" :key="subject.id">
              <span>{{ subjectLabel(subject) }}</span>
              <strong v-if="subject.isCurrent" class="badge" data-tone="info"
                >Atual</strong
              >
              <button
                v-else-if="canClose"
                type="button"
                :disabled="subjectBusy"
                @click="subjectCommand('select', subject.id)"
              >
                Selecionar
              </button>
            </li>
          </ul>
          <div v-if="canClose" class="subject-actions">
            <button
              type="button"
              :disabled="subjectBusy"
              @click="subjectCommand('create')"
            >
              Novo assunto sem pedido
            </button>
            <form
              class="subject-order-search"
              @submit.prevent="loadSubjects(active.id)"
            >
              <label :for="`subject-order-query-${active.id}`">
                Buscar pedido pelo número
              </label>
              <input
                :id="`subject-order-query-${active.id}`"
                v-model="subjectOrderQuery"
                type="search"
                maxlength="40"
                autocomplete="off"
              />
              <button type="submit" :disabled="subjectBusy">Buscar</button>
            </form>
            <label :for="`subject-order-${active.id}`">Vincular pedido</label>
            <select
              :id="`subject-order-${active.id}`"
              v-model="selectedSubjectOrderId"
            >
              <option value="">Selecione um pedido</option>
              <option
                v-for="order in availableSubjectOrders"
                :key="order.id"
                :value="order.id"
              >
                {{ order.number }} · {{ orderStatusLabel(order.status) }}
              </option>
            </select>
            <button
              type="button"
              :disabled="subjectBusy || !selectedSubjectOrderId"
              @click="subjectCommand('create', selectedSubjectOrderId)"
            >
              Criar assunto do pedido
            </button>
          </div>
          <p v-if="subjectState.ordersHasMore" class="op-hint">
            Há mais pedidos deste cliente. Busque pelo número para localizar o
            pedido desejado.
          </p>
        </section>

        <section class="context-section" aria-labelledby="context-client-title">
          <h3 id="context-client-title">Cliente</h3>
          <form v-if="renaming" class="rename-form" @submit.prevent="saveName">
            <label :for="`name-${active.id}`">Nome do contato</label>
            <input
              :id="`name-${active.id}`"
              ref="nameInput"
              v-model="draftName"
              type="text"
              maxlength="120"
              placeholder="Sem nome definido"
            />
            <div v-if="renameConflict" class="inbox-notice" role="alert">
              <p>O nome mudou enquanto você editava. Seu texto foi mantido.</p>
              <p v-if="renameCurrentKnown">
                Nome atual: {{ active.contact.label }}. Cancele e abra a edição
                novamente para revisar antes de salvar.
              </p>
              <p v-else>
                Não foi possível consultar o nome atual. Consulte novamente ou
                cancele para atualizar.
              </p>
              <button type="button" @click="refreshConflictName">
                Consultar nome atual
              </button>
            </div>
            <div class="inline-actions">
              <button
                type="submit"
                class="primary"
                :disabled="busy || renameConflict"
              >
                Salvar nome
              </button>
              <button type="button" :disabled="busy" @click="cancelRename">
                Cancelar
              </button>
            </div>
          </form>
          <dl v-else class="context-facts">
            <div>
              <dt>Nome</dt>
              <dd>{{ active.contact.label }}</dd>
            </div>
            <div v-if="active.automationState === 'human'">
              <dt>Responsável</dt>
              <dd>{{ ownerLabel }}</dd>
            </div>
            <div v-if="active.closureOutcome">
              <dt>Encerramento</dt>
              <dd>
                {{
                  active.closureOutcome === 'concluido'
                    ? 'Atendimento concluído'
                    : 'Sem pedido neste atendimento'
                }}
                · {{ dateTimeBR(active.terminalAt) }}
              </dd>
            </div>
          </dl>
          <div v-if="!renaming" class="inline-actions">
            <button ref="renameTrigger" type="button" @click="openRename">
              Editar nome
            </button>
            <RouterLink
              class="button-link"
              :to="`/clientes/${encodeURIComponent(active.contact.id)}`"
            >
              Ver contato
            </RouterLink>
          </div>
        </section>
      </aside>
    </div>
    <OrderDrawer
      v-if="active"
      ref="orderDrawer"
      :can-create="canCreateOrder"
      :conversation-id="active.id"
      :conversation-version="active.version"
      @changed="refreshInbox(true)"
    />
    <dialog
      ref="closeConfirmationDialog"
      class="command-dialog"
      aria-labelledby="close-confirmation-title"
      aria-describedby="close-confirmation-description"
    >
      <form @submit.prevent="confirmClose">
        <h2 id="close-confirmation-title">Encerrar conversa?</h2>
        <p id="close-confirmation-description">
          Este atendimento será encerrado. Uma nova mensagem do cliente abrirá
          outra conversa, preservando o histórico e os pedidos.
        </p>
        <fieldset>
          <legend>Motivo do encerramento</legend>
          <label>
            <input v-model="closureOutcome" type="radio" value="concluido" />
            Atendimento concluído
          </label>
          <label>
            <input v-model="closureOutcome" type="radio" value="sem_pedido" />
            Sem pedido neste atendimento
          </label>
        </fieldset>
        <label v-if="active?.order?.status === 'pendente'">
          <input v-model="acknowledgePending" type="checkbox" required />
          Há um pedido pendente. Confirmo que desejo encerrar esta conversa sem
          alterar o pedido.
        </label>
        <div class="inline-actions">
          <button type="button" @click="closeConfirmationDialog?.close()">
            Cancelar
          </button>
          <button type="submit" class="primary" :disabled="busy">
            Encerrar conversa
          </button>
        </div>
      </form>
    </dialog>
    <dialog
      ref="archiveConfirmationDialog"
      class="command-dialog"
      aria-labelledby="archive-confirmation-title"
      aria-describedby="archive-confirmation-description"
    >
      <form @submit.prevent="confirmArchive">
        <h2 id="archive-confirmation-title">Arquivar conversa?</h2>
        <p id="archive-confirmation-description">
          A conversa sairá da Caixa de Entrada, mas não será apagada. Se o
          cliente enviar uma nova mensagem, ela voltará a aparecer.
        </p>
        <div class="inline-actions">
          <button type="button" @click="archiveConfirmationDialog?.close()">
            Cancelar
          </button>
          <button type="submit" class="primary" :disabled="busy">
            Arquivar conversa
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>
