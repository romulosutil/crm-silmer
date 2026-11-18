import { contactVisible } from '@crm-silmer/contacts';

/**
 * WAP-07 (P1-1): an order may name only a Contact its author may read. The
 * predicate is the one `GET /api/v1/contacts/:id` applies to a seller, and a
 * current COMMERCIAL_ADMIN grant reads every Contact, as there.
 *
 * @param {string} contact SQL alias of a `crm.contacts` row
 * @param {string} actor SQL parameter holding the user id
 */
export function contactReadable(contact, actor) {
  return `(EXISTS (SELECT 1 FROM crm.user_capabilities admin_grant
      WHERE admin_grant.user_id=${actor} AND admin_grant.capability='COMMERCIAL_ADMIN')
    OR ${contactVisible(contact, actor)})`;
}
