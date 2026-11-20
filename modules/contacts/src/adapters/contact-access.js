// WAP-E03: predicates are shared by list, search, count, direct IDs and writes.
// A personal channel is identified by its stable account, never connection state.
/** A commercial administrator can supervise another personal line only under
 * the designated, active human account. Check the persisted grant in the
 * statement that reads the protected rows. @param {string} actor */
function personalSupervisor(actor) {
  return `EXISTS (SELECT 1 FROM crm.users supervisor
    JOIN crm.user_functions supervisor_role ON supervisor_role.user_id=supervisor.id
    JOIN crm.user_capabilities supervisor_grant ON supervisor_grant.user_id=supervisor.id
    WHERE supervisor.id=${actor} AND supervisor.disabled_at IS NULL
      AND lower(supervisor.email)='admin@crm-silmer.local'
      AND supervisor_role.function_name='Vendedor'
      AND supervisor_grant.capability='COMMERCIAL_ADMIN')`;
}

/** @param {string} identity @param {string} actor */
export function personalIdentityVisible(identity, actor) {
  return `(${personalSupervisor(actor)} OR NOT EXISTS (SELECT 1 FROM crm.seller_whatsapp_lines personal_line
    WHERE personal_line.account_id::text=${identity}.provider_account_id
      AND personal_line.seller_id IS DISTINCT FROM ${actor}))`;
}

/** @param {string} conversation @param {string} actor @param {string} [generalAdmin] */
export function contactConversationVisible(
  conversation,
  actor,
  generalAdmin = 'false',
) {
  return `(((${generalAdmin}) AND ${personalSupervisor(actor)}) OR
    (((${generalAdmin}) OR ${conversation}.assigned_user_id IS NULL OR ${conversation}.assigned_user_id=${actor})
    AND NOT EXISTS (SELECT 1 FROM crm.seller_whatsapp_lines personal_line
      WHERE personal_line.account_id::text=${conversation}.provider_account_id
        AND (personal_line.seller_id IS DISTINCT FROM ${actor}
          OR ${conversation}.assigned_user_id IS DISTINCT FROM ${actor}
          OR NOT EXISTS (SELECT 1 FROM crm.contact_identities personal_identity
            JOIN crm.seller_client_links personal_link
              ON personal_link.contact_id=personal_identity.current_contact_id
              AND personal_link.seller_id=${actor} AND personal_link.status='active'
            WHERE personal_identity.id=${conversation}.contact_identity_id)))))`;
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

/** Ordinary administrators retain the shared catalogue and their own wallet.
 * Other sellers' personal-only contacts require the named supervisor.
 * @param {string} contact @param {string} actor @param {string} [generalAdmin] */
export function contactReadVisible(contact, actor, generalAdmin = 'false') {
  return `(${contactVisible(contact, actor)} OR ((${generalAdmin}) AND
    (${personalSupervisor(actor)} OR NOT EXISTS (SELECT 1 FROM crm.contact_identities private_identity
      JOIN crm.seller_whatsapp_lines private_line ON private_line.account_id::text=private_identity.provider_account_id
      WHERE private_identity.current_contact_id=${contact}.id))))`;
}

/** Caller holds the user lock followed by the Contact lock. Never lock identities.
 * @param {any} transaction @param {{id:string,isAdmin:boolean}} actor @param {string} contactId */
export async function authorizeContactWrite(transaction, actor, contactId) {
  const allowed = await transaction.query(
    `SELECT contact.id FROM crm.contacts contact WHERE contact.id=$1
       AND ${contactReadVisible('contact', '$2', '$3::boolean')}`,
    [contactId, actor.id, actor.isAdmin],
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
