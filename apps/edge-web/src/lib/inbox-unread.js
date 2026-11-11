/**
 * INBOX-RD-02 (INBOX-RD-T02, parte 1): a lógica do aviso de mensagem nova da
 * Caixa de Entrada, separada do Vue para ser testada sozinha. Cada função
 * recebe um estado e devolve um estado novo, ou o mesmo objeto quando nada
 * mudou. O estado fica no navegador de quem atende; o servidor não o conhece.
 *
 * - `seen`: id da conversa -> id da última mensagem do cliente já conhecida;
 * - `unread`: id da conversa -> id da mensagem do cliente ainda não lida.
 *
 * Toda chave de `unread` também existe em `seen`. A chave `__proto__` nunca
 * é aceita como id, então nenhuma entrada chega ao protótipo de Object.
 */

export const INBOX_UNREAD_STORAGE_KEY = 'crm.inbox.unread.v1';
export const INBOX_UNREAD_LIMIT = 500;

const VERSION = 1;

/**
 * @typedef {{seen: Record<string, string>, unread: Record<string, string>}} UnreadState
 * @typedef {{id: string, lastMessage?: {id: string, direction: 'inbound'|'outbound'} | null}} InboxConversation
 */

/**
 * @returns {UnreadState} o estado inicial, sem nenhuma conversa conhecida.
 */
export function emptyUnreadState() {
  return { seen: {}, unread: {} };
}

/**
 * @param {unknown} value
 * @returns {value is string} true para string não vazia.
 */
function isText(value) {
  return typeof value === 'string' && value !== '';
}

/**
 * @param {unknown} value
 * @returns {value is string} true para um id de conversa utilizável.
 */
function isConversationId(value) {
  return isText(value) && value !== '__proto__';
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>} true para objeto que não é array.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {object} map
 * @param {string} key
 * @returns {boolean} true quando a chave é própria do mapa.
 */
function has(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/**
 * Põe a conversa no fim da ordem de inserção, para que a entrada mais antiga
 * seja a menos recentemente observada. Muda só as cópias do estado.
 *
 * @param {Record<string, string>} seen
 * @param {string} id
 * @param {string} messageId
 */
function remember(seen, id, messageId) {
  delete seen[id];
  seen[id] = messageId;
}

/**
 * Descarta as entradas mais antigas de `seen` que não estejam em `unread`,
 * até caber no limite. Muda só as cópias recebidas.
 *
 * @param {Record<string, string>} seen
 * @param {Record<string, string>} unread
 * @returns {boolean} true se alguma entrada foi descartada.
 */
function trimDraft(seen, unread) {
  let excess = Object.keys(seen).length - INBOX_UNREAD_LIMIT;
  let trimmed = false;
  for (const key of Object.keys(seen)) {
    if (excess <= 0) break;
    if (has(unread, key)) continue;
    delete seen[key];
    excess -= 1;
    trimmed = true;
  }
  return trimmed;
}

/**
 * Compara a lista do servidor com o que este navegador já viu. A primeira vez
 * que uma conversa aparece só registra a última mensagem; a partir daí, uma
 * mensagem nova do cliente marca a conversa, exceto a aberta. Uma resposta
 * `outbound` tira a marca.
 *
 * @param {UnreadState} state
 * @param {unknown} conversations lista de `InboxConversation`; qualquer outro
 *   valor (ou item malformado) é tratado como vazio ou ignorado.
 * @param {{openId?: string|null}} [options] `openId`: a conversa aberta agora.
 * @returns {{state: UnreadState, arrived: string[]}} `arrived`: ids marcados
 *   nesta chamada (que não estavam marcados antes), na ordem da lista.
 */
export function observeConversations(
  state,
  conversations,
  { openId = null } = {},
) {
  const before = state?.unread ?? {};
  const seen = { ...(state?.seen ?? {}) };
  const unread = { ...before };
  const list = Array.isArray(conversations)
    ? /** @type {Partial<InboxConversation>[]} */ (conversations)
    : [];
  /** @type {string[]} */
  const arrived = [];
  let changed = false;

  for (const conversation of list) {
    const id = conversation?.id;
    const last = conversation?.lastMessage;
    if (!isConversationId(id) || !last || !isText(last.id)) continue;
    // Direction is checked below; a malformed one is ignored there.

    if (last.direction === 'outbound') {
      if (has(unread, id)) {
        delete unread[id];
        changed = true;
      }
      continue;
    }
    if (last.direction !== 'inbound') continue;

    if (!has(seen, id)) {
      remember(seen, id, last.id);
      changed = true;
      continue;
    }
    if (seen[id] === last.id) continue;

    remember(seen, id, last.id);
    changed = true;
    if (id === openId) {
      if (has(unread, id)) delete unread[id];
    } else {
      if (!has(before, id) && !arrived.includes(id)) arrived.push(id);
      unread[id] = last.id;
    }
  }

  if (trimDraft(seen, unread)) changed = true;
  return { arrived, state: changed ? { seen, unread } : state };
}

/**
 * Quando a conversa é aberta: tira a marca e registra a última mensagem do
 * cliente. Chamar de novo, sem mudança, devolve o mesmo estado.
 *
 * @param {UnreadState} state
 * @param {unknown} conversation um `InboxConversation`; outro valor não muda nada.
 * @returns {UnreadState}
 */
export function markConversationRead(state, conversation) {
  const source = /** @type {Partial<InboxConversation>|null|undefined} */ (
    conversation
  );
  const id = source?.id;
  if (!isConversationId(id)) return state;
  const seen = { ...(state?.seen ?? {}) };
  const unread = { ...(state?.unread ?? {}) };
  let changed = false;

  if (has(unread, id)) {
    delete unread[id];
    changed = true;
  }
  const last = source?.lastMessage;
  if (
    last?.direction === 'inbound' &&
    isText(last.id) &&
    seen[id] !== last.id
  ) {
    remember(seen, id, last.id);
    changed = true;
  }
  return changed ? { seen, unread } : state;
}

/**
 * @param {UnreadState} state
 * @param {string} id
 * @returns {boolean} true quando a conversa tem mensagem nova não lida.
 */
export function isConversationUnread(state, id) {
  return isConversationId(id) && has(state?.unread ?? {}, id);
}

/**
 * @param {UnreadState} state
 * @returns {number} quantas conversas estão marcadas.
 */
export function unreadCount(state) {
  return Object.keys(state?.unread ?? {}).length;
}

/**
 * O título da aba, com a contagem quando há algo não lido.
 *
 * @param {string} baseTitle
 * @param {unknown} count
 * @returns {string} `baseTitle` para contagem que não seja inteiro >= 1;
 *   senão "(N) baseTitle", com "99+" a partir de 100.
 */
export function unreadTitle(baseTitle, count) {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    return baseTitle;
  }
  return `(${count > 99 ? '99+' : count}) ${baseTitle}`;
}

/**
 * O texto do aviso acima da lista de conversas.
 *
 * @param {unknown} count
 * @returns {string} '' para zero; senão a frase no singular ou no plural.
 */
export function unreadNoticeText(count) {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    return '';
  }
  if (count === 1) return '1 conversa com mensagem nova em Responder';
  return `${count} conversas com mensagem nova em Responder`;
}

/**
 * Só as entradas válidas de um mapa: chave utilizável e valor string não vazia.
 *
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function validMap(value) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!isPlainObject(value)) return out;
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (isConversationId(key) && isText(entry)) out[key] = entry;
  }
  return out;
}

/**
 * @param {UnreadState} state
 * @returns {string} JSON `{"v":1,"seen":{…},"unread":{…}}`.
 */
export function serializeUnreadState(state) {
  return JSON.stringify({
    v: VERSION,
    seen: validMap(state?.seen),
    unread: validMap(state?.unread),
  });
}

/**
 * Lê o texto guardado. Nunca lança: texto ilegível, versão diferente de 1 ou
 * campos de tipo errado viram o estado vazio, e entradas inválidas são
 * descartadas uma a uma. Toda entrada de `unread` ganha seu `seen`.
 *
 * @param {unknown} text
 * @returns {UnreadState}
 */
export function parseUnreadState(text) {
  if (typeof text !== 'string' || text === '') return emptyUnreadState();
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return emptyUnreadState();
  }
  if (!isPlainObject(data) || data.v !== VERSION) return emptyUnreadState();

  const seen = validMap(data.seen);
  const unread = validMap(data.unread);
  for (const id of Object.keys(unread)) {
    if (!has(seen, id)) seen[id] = unread[id];
  }
  trimDraft(seen, unread);
  return { seen, unread };
}
