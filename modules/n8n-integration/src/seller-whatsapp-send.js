import { decryptJson } from './crypto.js';

/** @param {Record<string, unknown>} environment */
export function sellerWhatsAppSendConfiguration(environment) {
  const enabled = environment.SELLER_WHATSAPP_SEND_ENABLED;
  const raw = environment.SELLER_WHATSAPP_SEND_SELLER_IDS;
  const ids = typeof raw === 'string' ? JSON.parse(raw) : [];
  if (
    (enabled !== undefined && enabled !== 'false' && enabled !== 'true') ||
    !Array.isArray(ids) ||
    ids.some(
      (id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(id),
    ) ||
    new Set(ids).size !== ids.length ||
    (enabled === 'true' && !ids.length)
  )
    throw new TypeError('Personal WhatsApp send requires explicit seller IDs');
  return new Set(/** @type {string[]} */ (enabled === 'true' ? ids : []));
}

/** Lock user and line before conversation or billing records. @param {any} client @param {string[]} conversationIds */
export async function lockSellerWhatsAppLines(client, conversationIds) {
  const lines = (
    await client.query(
      `SELECT DISTINCT l.id,l.seller_id FROM crm.seller_whatsapp_lines l
     JOIN crm.conversations c ON c.provider_account_id=l.account_id::text
     WHERE c.id=ANY($1::text[]) ORDER BY l.id`,
      [conversationIds],
    )
  ).rows;
  if (!lines.length) return;
  await client.query(
    'SELECT id FROM crm.users WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE',
    [lines.map((/** @type {any} */ l) => l.seller_id)],
  );
  await client.query(
    'SELECT user_id FROM crm.user_functions WHERE user_id=ANY($1::text[]) ORDER BY user_id FOR SHARE',
    [lines.map((/** @type {any} */ l) => l.seller_id)],
  );
  await client.query(
    'SELECT id FROM crm.seller_whatsapp_lines WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
    [lines.map((/** @type {any} */ l) => l.id)],
  );
  await client.query(
    `SELECT contact.id FROM crm.contacts contact WHERE contact.id IN (
    SELECT i.current_contact_id FROM crm.conversations c JOIN crm.contact_identities i ON i.id=c.contact_identity_id
    WHERE c.id=ANY($1::text[])) ORDER BY contact.id FOR SHARE`,
    [conversationIds],
  );
}

/** Read a non-PII target snapshot while the line and conversation are locked.
 * @param {any} client @param {string} conversationId */
export async function sellerWhatsAppTarget(client, conversationId) {
  const row = (
    await client.query(
      `SELECT l.id,l.account_id,l.generation,l.instance_name,l.seller_id,l.state,
            l.verified_at,b.id AS binding_id,u.disabled_at,f.function_name,
            c.assigned_user_id,c.provider,c.automation_state,c.terminal_at,
            ci.id AS identity_id,ci.version AS identity_version,ci.current_contact_id,
            contact.version AS contact_version,w.version AS wallet_version,w.status AS wallet_status
     FROM crm.conversations c
     JOIN crm.seller_whatsapp_lines l ON l.account_id::text=c.provider_account_id
     JOIN crm.contact_identities ci ON ci.id=c.contact_identity_id
     JOIN crm.contacts contact ON contact.id=ci.current_contact_id
     LEFT JOIN crm.seller_client_links w ON w.seller_id=l.seller_id AND w.contact_id=ci.current_contact_id
     JOIN crm.users u ON u.id=l.seller_id
     LEFT JOIN crm.user_functions f ON f.user_id=u.id
     LEFT JOIN crm.seller_whatsapp_bindings b ON b.line_id=l.id AND b.generation=l.generation AND b.revoked_at IS NULL
     WHERE c.id=$1`,
      [conversationId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    source: {
      accountId: row.account_id,
      lineId: row.id,
      bindingId: row.binding_id,
      generation: Number(row.generation),
      instance: row.instance_name,
    },
    identityId: row.identity_id,
    identityVersion: String(row.identity_version),
    contactId: row.current_contact_id,
    contactVersion: String(row.contact_version),
    walletVersion: String(row.wallet_version),
    sellerId: row.seller_id,
    usable:
      row.state === 'connected' &&
      Boolean(row.verified_at && row.binding_id) &&
      !row.disabled_at &&
      row.function_name === 'Vendedor' &&
      row.assigned_user_id === row.seller_id &&
      row.wallet_status === 'active' &&
      row.provider === 'evolution' &&
      row.automation_state === 'human' &&
      !row.terminal_at,
  };
}

/** @param {any} target @param {{commercial?:boolean}} [options] */
export function snapshotWhatsAppTarget(target, { commercial = false } = {}) {
  if (!target) return null;
  const { contactVersion, ...snapshot } = target;
  delete snapshot.usable;
  return commercial ? { ...snapshot, contactVersion } : snapshot;
}

/** @param {any} a @param {any} b */
export function matchesWhatsAppTarget(a, b) {
  return Boolean(
    a &&
    b &&
    a.identityId === b.identityId &&
    a.identityVersion === b.identityVersion &&
    a.contactId === b.contactId &&
    a.walletVersion === b.walletVersion &&
    (b.contactVersion === undefined || a.contactVersion === b.contactVersion) &&
    a.sellerId === b.sellerId &&
    sameWhatsAppSource(a.source, b.source) &&
    a.source.instance === b.source.instance,
  );
}

/** @param {any} a @param {any} b */
export function sameWhatsAppSource(a, b) {
  return Boolean(
    a &&
    b &&
    a.accountId === b.accountId &&
    a.lineId === b.lineId &&
    a.bindingId === b.bindingId &&
    a.generation === b.generation,
  );
}

/** @param {any} target @param {string} actorId @param {Set<string>} allowed */
export function personalSendAllowed(target, actorId, allowed) {
  return target.usable && target.sellerId === actorId && allowed.has(actorId);
}

/** @param {any} command @param {Buffer} key */
export function commandWhatsAppTarget(command, key) {
  return command?.payload_envelope
    ? (decryptJson(
        command.payload_envelope,
        `n8n-command:${command.command_id}`,
        key,
      ).whatsapp_target ?? null)
    : null;
}
