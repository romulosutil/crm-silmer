// WAP-E03: predicates are shared by list, search, count, direct IDs and writes.
// A personal channel is identified by its stable account, never connection state.
/** @param {string} identity @param {string} actor */
export function personalIdentityVisible(identity, actor) {
  return `NOT EXISTS (SELECT 1 FROM crm.seller_whatsapp_lines personal_line
    WHERE personal_line.account_id::text=${identity}.provider_account_id
      AND personal_line.seller_id<>${actor})`;
}

/** @param {string} conversation @param {string} actor */
export function contactConversationVisible(conversation, actor) {
  return `((${conversation}.assigned_user_id IS NULL OR ${conversation}.assigned_user_id=${actor})
    AND NOT EXISTS (SELECT 1 FROM crm.seller_whatsapp_lines personal_line
      WHERE personal_line.account_id::text=${conversation}.provider_account_id
        AND (personal_line.seller_id<>${actor}
          OR ${conversation}.assigned_user_id IS DISTINCT FROM ${actor})))`;
}

/** @param {string} contact @param {string} actor @param {boolean} [walletOnly] */
export function contactVisible(contact, actor, walletOnly = false) {
  const linked = `EXISTS (SELECT 1 FROM crm.seller_client_links wallet_link
    WHERE wallet_link.contact_id=${contact}.id AND wallet_link.seller_id=${actor}
      AND wallet_link.status='active')`;
  if (walletOnly) return linked;
  return `(${linked} OR EXISTS (SELECT 1 FROM crm.contact_identities general_identity
      WHERE general_identity.current_contact_id=${contact}.id
        AND NOT EXISTS (SELECT 1 FROM crm.seller_whatsapp_lines personal_line
          WHERE personal_line.account_id::text=general_identity.provider_account_id))
    OR (${contact}.wallet_created=false AND NOT EXISTS (
      SELECT 1 FROM crm.contact_identities private_identity
      JOIN crm.seller_whatsapp_lines personal_line
        ON personal_line.account_id::text=private_identity.provider_account_id
      WHERE private_identity.current_contact_id=${contact}.id)))`;
}

/** Caller holds the user lock followed by the Contact lock. Never lock identities.
 * @param {any} transaction @param {{id:string,isAdmin:boolean}} actor @param {string} contactId */
export async function authorizeContactWrite(transaction, actor, contactId) {
  if (actor.isAdmin) return;
  const allowed = await transaction.query(
    `SELECT contact.id FROM crm.contacts contact WHERE contact.id=$1
       AND ${contactVisible('contact', '$2')}`,
    [contactId, actor.id],
  );
  if (!allowed.rows.length)
    throw Object.assign(new Error('CONTACT_NOT_FOUND'), {
      code: 'CONTACT_NOT_FOUND',
      statusCode: 404,
    });
}

/** Count under the same Contact lock used by link insertion/revocation.
 * @param {any} transaction @param {string} contactId */
export async function contactIsShared(transaction, contactId) {
  const result = await transaction.query(
    `SELECT count(*)::integer count FROM crm.seller_client_links
     WHERE contact_id=$1 AND status='active'`,
    [contactId],
  );
  return Number(result.rows[0]?.count ?? 0) > 1;
}
