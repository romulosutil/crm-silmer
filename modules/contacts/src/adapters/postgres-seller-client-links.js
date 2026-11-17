import { randomUUID } from 'node:crypto';

/** Errors contain codes only; private candidate/source data never crosses them. */
export class SellerClientLinkError extends Error {
  /** @param {string} code @param {number} [statusCode] */
  constructor(code, statusCode = 409) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** WAP-29. Identity writes use this same user lock before changing roles or
 * disabling an account. Call before locking Contact (including on replay).
 * @param {any} transaction @param {string} actorId
 */
export async function requireSellerClientActor(transaction, actorId) {
  const user = (
    await transaction.query(
      'SELECT id, disabled_at FROM crm.users WHERE id=$1 FOR UPDATE',
      [actorId],
    )
  ).rows[0];
  const role = (
    await transaction.query(
      'SELECT function_name FROM crm.user_functions WHERE user_id=$1',
      [actorId],
    )
  ).rows[0];
  if (!user || user.disabled_at || role?.function_name !== 'Vendedor')
    throw new SellerClientLinkError('FORBIDDEN', 403);
  const capabilities = await transaction.query(
    "SELECT 1 FROM crm.user_capabilities WHERE user_id=$1 AND capability='COMMERCIAL_ADMIN'",
    [actorId],
  );
  return { id: actorId, isAdmin: capabilities.rows.length > 0 };
}

/** WAP-08/29: every writer/link transition uses this Contact lock, so a
 * second portfolio cannot race a registration editor's sharing check.
 * @param {any} transaction @param {string} contactId
 */
export async function lockSellerClientContact(transaction, contactId) {
  const contact = (
    await transaction.query(
      'SELECT * FROM crm.contacts WHERE id=$1 FOR UPDATE',
      [contactId],
    )
  ).rows[0];
  if (!contact) throw new SellerClientLinkError('CONTACT_NOT_FOUND', 404);
  return contact;
}

/** Transaction-local primitive. The caller must reauthorize and lock all
 * affected users in sorted order, then the Contact, and check Contact access
 * and expected Contact version. This primitive never grants access by ID.
 * Re-activation requires the revoked link's explicit version; active replay
 * is a no-op. A low-level replay still requires the caller's current access.
 * @param {any} transaction
 * @param {{actor:{id:string,isAdmin:boolean},sellerId?:string,contactId:string,provenance:string,sourceId?:string|null,state?:string,expectedVersion?:number,correlationId:string,now?:string}} input
 * @param {{append:Function}} auditPort
 */
export async function setSellerClientLink(transaction, input, auditPort) {
  const sellerId = input.sellerId ?? input.actor.id;
  const status = input.state ?? 'active';
  if (sellerId !== input.actor.id && !input.actor.isAdmin)
    throw new SellerClientLinkError('FORBIDDEN', 403);
  if (
    !['active', 'revoked'].includes(status) ||
    ![
      'manual_create',
      'explicit_link',
      'commercial_order',
      'personal_inbound',
      'personal_outbound',
    ].includes(input.provenance) ||
    (input.expectedVersion !== undefined &&
      (!Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1))
  )
    throw new SellerClientLinkError('INVALID_REQUEST', 400);
  const current = (
    await transaction.query(
      'SELECT * FROM crm.seller_client_links WHERE seller_id=$1 AND contact_id=$2 FOR UPDATE',
      [sellerId, input.contactId],
    )
  ).rows[0];
  if (current?.status === status) {
    if (
      input.expectedVersion !== undefined &&
      Number(current.version) !== input.expectedVersion
    )
      throw new SellerClientLinkError('CLIENT_LINK_VERSION_CONFLICT');
    return present(current, false);
  }
  if (
    (!current && status === 'revoked') ||
    (current && Number(current.version) !== input.expectedVersion)
  )
    throw new SellerClientLinkError('CLIENT_LINK_VERSION_CONFLICT');
  // Rollout proof is a commercial attribution captured on the order itself;
  // never infer from its author, telephone or the current conversation owner.
  if (!current && input.provenance === 'commercial_order') {
    const proof = await transaction.query(
      `SELECT 1 FROM crm.orders WHERE id=$1 AND contact_id=$2
       AND origin='atendimento' AND NOT is_test
       AND (manual_owner_id=$3 OR
            (sales_owner_id=$3 AND sales_owner_captured_at IS NOT NULL))`,
      [input.sourceId, input.contactId, sellerId],
    );
    if (!proof.rows.length)
      throw new SellerClientLinkError('CLIENT_LINK_PROVENANCE_INVALID', 403);
  }
  const now = input.now ?? new Date().toISOString();
  const row = current
    ? (
        await transaction.query(
          `UPDATE crm.seller_client_links
           SET status=$2,version=version+1,updated_by=$3,updated_at=$4,
               revoked_at=CASE WHEN $2='revoked' THEN $4::timestamptz ELSE NULL END
           WHERE id=$1 RETURNING *`,
          [current.id, status, input.actor.id, now],
        )
      ).rows[0]
    : (
        await transaction.query(
          `INSERT INTO crm.seller_client_links
           (id,seller_id,contact_id,provenance,source_id,status,version,
            created_by,updated_by,created_at,updated_at)
           VALUES($1,$2,$3,$4,$5,'active',1,$6,$6,$7,$7) RETURNING *`,
          [
            randomUUID(),
            sellerId,
            input.contactId,
            input.provenance,
            input.sourceId ?? null,
            input.actor.id,
            now,
          ],
        )
      ).rows[0];
  await auditPort.append(
    {
      action: `contact.portfolio.${status === 'active' ? 'linked' : 'revoked'}`,
      actor: input.actor.id,
      correlationId: input.correlationId,
      occurredAt: now,
      reason: 'SELLER_CLIENT_LINK',
      target: { id: row.id, type: 'seller_client_link' },
      version: Number(row.version),
    },
    { transaction },
  );
  await transaction.query(
    `INSERT INTO crm.domain_events
     (id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,correlation_id,occurred_at)
     VALUES($1,'seller_client_link',$2,$3,'contact.portfolio.changed',$4::jsonb,$5,$6)`,
    [
      `event-${randomUUID()}`,
      row.id,
      Number(row.version),
      JSON.stringify({ contactId: input.contactId, fields: ['portfolio'] }),
      input.correlationId,
      now,
    ],
  );
  return present(row, true);
}

/** No PII: reconciliation returns a count by default, optional opaque IDs for
 * an internal reviewed plan. It neither mutates nor imports the global base.
 * @param {any} transaction @param {string[]} sellerIds
 */
export async function planSellerClientReconciliation(transaction, sellerIds) {
  const result = await transaction.query(
    `WITH proof AS (
       SELECT id source_id,contact_id,manual_owner_id seller_id
       FROM crm.orders WHERE origin='atendimento' AND NOT is_test
         AND contact_id IS NOT NULL AND manual_owner_id=ANY($1::text[])
       UNION ALL
       SELECT id,contact_id,sales_owner_id FROM crm.orders
       WHERE origin='atendimento' AND NOT is_test AND contact_id IS NOT NULL
         AND sales_owner_captured_at IS NOT NULL AND sales_owner_id=ANY($1::text[])
     )
     SELECT DISTINCT ON(proof.seller_id,proof.contact_id)
       proof.seller_id,proof.contact_id,proof.source_id
     FROM proof
     JOIN crm.users seller ON seller.id=proof.seller_id AND seller.disabled_at IS NULL
     JOIN crm.user_functions role ON role.user_id=seller.id AND role.function_name='Vendedor'
     LEFT JOIN crm.seller_client_links link
       ON link.seller_id=proof.seller_id AND link.contact_id=proof.contact_id
     WHERE link.id IS NULL
     ORDER BY proof.seller_id,proof.contact_id,proof.source_id`,
    [sellerIds],
  );
  return {
    count: result.rows.length,
    candidates: result.rows.map((/** @type {any} */ row) => ({
      sellerId: row.seller_id,
      contactId: row.contact_id,
      sourceId: row.source_id,
    })),
  };
}

/** @param {any} row @param {boolean} changed */
function present(row, changed) {
  return {
    id: row.id,
    sellerId: row.seller_id,
    contactId: row.contact_id,
    provenance: row.provenance,
    sourceId: row.source_id,
    status: row.status,
    version: Number(row.version),
    changed,
  };
}
