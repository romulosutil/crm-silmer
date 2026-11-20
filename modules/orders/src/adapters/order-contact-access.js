import { contactReadVisible, contactVisible } from '@crm-silmer/contacts';

/** @param {string} actor */
function commercialAdmin(actor) {
  return `EXISTS (SELECT 1 FROM crm.user_capabilities admin_grant WHERE admin_grant.user_id=${actor} AND admin_grant.capability='COMMERCIAL_ADMIN')`;
}

/** Creating an order for a contact uses the same visibility as the contact catalogue.
 * @param {string} contact @param {string} actor */
export function contactReadable(contact, actor) {
  return contactReadVisible(contact, actor, commercialAdmin(actor));
}

/** Existing orders retain their commercial scope.
 * @param {string} contact @param {string} actor */
function commercialContact(contact, actor) {
  return `(${commercialAdmin(actor)} OR ${contactVisible(contact, actor)})`;
}

/**
 * WAP-07/08 (PO, 18/11/2026): an order exists for a reader only while its
 * Contact is one that reader may read, so a private personal-line client of
 * another seller's wallet never surfaces through any order read or command.
 * The stored `contact_id` is checked, and so is the Contact the order's
 * conversation points to now, so a merge never opens a hidden client. A
 * store order has no Contact and stays visible.
 *
 * Tech Lead, 18/11/2026: the order's own seller always keeps it, so a wallet
 * revocation hides a client's orders only from the OTHER sellers. The order's
 * seller is its manual owner, the current owner of its conversation, or the
 * seller its confirmation recorded (`sales_owner_id`, the commission).
 *
 * Every reader of the list, its counts and cursor, and every read or command
 * by id share this one predicate, so totals and pages agree.
 *
 * @param {string} order SQL alias (or table name) of a `crm.orders` row
 * @param {string} actor SQL parameter holding the reader's user id
 */
export function orderReadable(order, actor) {
  return `(${order}.contact_id IS NULL
    OR ${order}.manual_owner_id=${actor} OR ${order}.sales_owner_id=${actor}
    OR EXISTS (SELECT 1 FROM crm.conversations seller_conversation
      WHERE seller_conversation.id=${order}.conversation_id
        AND seller_conversation.assigned_user_id=${actor})
    OR (EXISTS (
      SELECT 1 FROM crm.contacts order_contact
      WHERE order_contact.id=${order}.contact_id
        AND ${commercialContact('order_contact', actor)})
    AND (${order}.conversation_id IS NULL OR EXISTS (
      SELECT 1 FROM crm.conversations order_conversation
      JOIN crm.contact_identities order_identity
        ON order_identity.id=order_conversation.contact_identity_id
      JOIN crm.contacts conversation_contact
        ON conversation_contact.id=order_identity.current_contact_id
      WHERE order_conversation.id=${order}.conversation_id
        AND ${commercialContact('conversation_contact', actor)}))))`;
}
