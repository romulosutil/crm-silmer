/**
 * INBOX-RD-03 (RD-04): consecutive messages of one author read as one group,
 * with the avatar and the name once. Pure, so the rule is tested on its own.
 *
 * A message starts a new group when any of these holds:
 * - it is the first message;
 * - the author changed: another side (customer, agent, seller) or, on the
 *   same side, another person (`authorId`), so the seller and the agent never
 *   share a group;
 * - the calendar day changed (in the browser's time zone);
 * - more than `MESSAGE_GROUP_GAP_MINUTES` passed since the previous message,
 *   or either time is unreadable;
 * - it, or the previous message, stands alone: a delivery that failed or is
 *   uncertain (its notice and "Verificar envio" belong to that one send), or a
 *   message with no known author kind (a system record).
 *
 * Media does not break a group: three photos in a row are one group, each in
 * its own bubble with its own time.
 */

/** The prototype groups replies 6 minutes apart; a longer pause starts over. */
export const MESSAGE_GROUP_GAP_MINUTES = 10;

const AUTHOR_KINDS = new Set(['contact', 'assistant', 'human']);
const DELIVERY_ISSUES = new Set(['failed', 'outcome_unknown']);

/**
 * @typedef {{
 *   id: string,
 *   authorKind?: string|null,
 *   authorId?: string|null,
 *   direction?: string,
 *   occurredAt?: string,
 *   deliveryStatus?: string|null,
 * }} ThreadMessage
 */

/**
 * @param {ThreadMessage} message
 * @returns {boolean} true when the message never shares a group.
 */
export function standsAlone(message) {
  if (DELIVERY_ISSUES.has(String(message?.deliveryStatus ?? ''))) return true;
  const kind = message?.authorKind;
  // An older payload without authorKind still has a side (see messageFrom).
  if (kind === undefined || kind === null) return false;
  return !AUTHOR_KINDS.has(kind);
}

/** @param {ThreadMessage} message */
function side(message) {
  if (message.authorKind === 'contact') return 'cliente';
  if (message.authorKind === 'assistant') return 'agente';
  if (message.authorKind === 'human') return 'humano';
  return message.direction === 'inbound' ? 'cliente' : 'agente';
}

/** @param {unknown} value @returns {Date|null} */
function when(value) {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {ThreadMessage} previous
 * @param {ThreadMessage} message
 * @param {number} gapMinutes
 * @returns {boolean} true when `message` must open a new group.
 */
export function breaksGroup(previous, message, gapMinutes) {
  if (!previous) return true;
  if (standsAlone(previous) || standsAlone(message)) return true;
  if (side(previous) !== side(message)) return true;
  const a = previous.authorId ?? null;
  const b = message.authorId ?? null;
  if (a !== b) return true;
  const before = when(previous.occurredAt);
  const now = when(message.occurredAt);
  if (!before || !now) return true;
  if (before.toDateString() !== now.toDateString()) return true;
  return now.getTime() - before.getTime() > gapMinutes * 60_000;
}

/**
 * @param {ThreadMessage[]|null|undefined} messages in the order the history shows them
 * @param {{gapMinutes?: number}} [options]
 * @returns {Set<string>} ids of the messages that open a group.
 */
export function groupStarts(
  messages,
  { gapMinutes = MESSAGE_GROUP_GAP_MINUTES } = {},
) {
  const starts = new Set();
  const list = Array.isArray(messages) ? messages : [];
  list.forEach((message, index) => {
    if (breaksGroup(list[index - 1], message, gapMinutes))
      starts.add(message.id);
  });
  return starts;
}
