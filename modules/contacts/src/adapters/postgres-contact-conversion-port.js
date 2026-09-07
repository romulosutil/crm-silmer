import {
  ContactIdentityConflictError,
  ContactIdentityNotFoundError,
} from '../domain/errors.js';

/** @typedef {{query: (sql: string, values?: unknown[]) => Promise<{rows: any[]}>}} Queryable */

/** @param {unknown} candidate @param {string} field @returns {Queryable} */
function requireQueryable(candidate, field) {
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof (/** @type {Record<string, unknown>} */ (candidate).query) !==
      'function'
  ) {
    throw new TypeError(`${field} must implement query`);
  }
  return /** @type {Queryable} */ (candidate);
}

/**
 * Transaction-scoped Contact port used by conversation conversion. Resolving
 * the identity here keeps crm.contacts private to the Contacts context.
 */
export class PostgresContactConversionPort {
  /** @param {{identityId: string, occurredAt: string}} input @param {{transaction: any}} context */
  async promoteIdentityContact(input, context) {
    const transaction = requireQueryable(
      context?.transaction,
      'context.transaction',
    );
    const selected = await transaction.query(
      `SELECT c.id, c.provisional, c.version
       FROM crm.contact_identities i
       JOIN crm.contacts c ON c.id = i.current_contact_id
       WHERE i.id = $1
       FOR UPDATE OF i, c`,
      [input.identityId],
    );
    const contact = selected.rows[0];
    if (!contact) throw new ContactIdentityNotFoundError();
    if (!contact.provisional) return mapContact(contact);

    const updated = await transaction.query(
      `UPDATE crm.contacts
       SET provisional = false, version = version + 1,
           updated_at = GREATEST(updated_at, $2)
       WHERE id = $1 AND provisional = true
       RETURNING id, provisional, version`,
      [contact.id, input.occurredAt],
    );
    if (!updated.rows[0]) throw new ContactIdentityConflictError();
    return mapContact(updated.rows[0]);
  }
}

/** @param {any} row */
function mapContact(row) {
  return Object.freeze({
    id: row.id,
    provisional: row.provisional,
    version: Number(row.version),
  });
}
