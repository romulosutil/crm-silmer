import { decryptContactIdentityEnvelope } from '../adapters/contact-identity-envelope.js';
import {
  contactPhoneHash,
  normalizeContactPhone,
} from '../domain/contact-details.js';

/**
 * Rebuilds the phone lookup for historical confirmed WhatsApp identities.
 * Each page commits atomically; restarting from the last reported cursor is safe.
 * No phone number or envelope is returned to the caller.
 *
 * @param {{query: Function, transaction: Function}} database
 * @param {{envelopeKey: Buffer, lookupKey: Buffer, after?: string, batchSize?: number,
 *   maxBatches?: number, apply?: boolean, onBatch?: (progress: Record<string, number|string|boolean>) => void}} options
 */
export async function backfillContactPhoneLookup(database, options) {
  if (
    !Buffer.isBuffer(options.envelopeKey) ||
    options.envelopeKey.length !== 32 ||
    !Buffer.isBuffer(options.lookupKey) ||
    options.lookupKey.length !== 32
  ) {
    throw new TypeError(
      'Dedicated 32-byte envelope and lookup keys are required',
    );
  }
  const batchSize = options.batchSize ?? 200;
  const maxBatches = options.maxBatches ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 500 ||
    !Number.isSafeInteger(maxBatches) ||
    maxBatches < 1
  ) {
    throw new TypeError('Invalid backfill page limit');
  }
  let after = options.after ?? '';
  const total = {
    scanned: 0,
    eligible: 0,
    inserted: 0,
    existing: 0,
    missing: 0,
    invalid: 0,
  };
  let complete = false;
  for (let page = 0; page < maxBatches; page += 1) {
    const rows = (
      await database.query(
        `SELECT id, current_contact_id, external_identity_lookup_hash,
              identity_envelope
       FROM crm.contact_identities
       WHERE channel = 'whatsapp' AND identity_kind = 'phone'
         AND phone_status = 'confirmed' AND id > $1
       ORDER BY id LIMIT $2`,
        [after, batchSize],
      )
    ).rows;
    if (rows.length === 0) {
      complete = true;
      break;
    }
    const batch = await database.transaction(
      async (/** @type {any} */ transaction) => {
        const counts = {
          scanned: rows.length,
          eligible: 0,
          inserted: 0,
          existing: 0,
          missing: 0,
          invalid: 0,
        };
        for (const row of rows) {
          const secret = decryptContactIdentityEnvelope(
            row.identity_envelope,
            row.external_identity_lookup_hash,
            options.envelopeKey,
          );
          const phone = normalizeContactPhone(secret.externalIdentityId);
          if (!phone) {
            counts.invalid += 1;
            continue;
          }
          counts.eligible += 1;
          const hash = contactPhoneHash(phone, options.lookupKey);
          if (options.apply) {
            const inserted = await transaction.query(
              `INSERT INTO crm.contact_phone_lookup (contact_id, identity_id, phone_hash, source)
             VALUES ($1, $2, $3, 'whatsapp') ON CONFLICT DO NOTHING
             RETURNING contact_id`,
              [row.current_contact_id, row.id, hash],
            );
            if (inserted.rows.length) counts.inserted += 1;
            else counts.existing += 1;
          } else {
            const present = await transaction.query(
              `SELECT 1 FROM crm.contact_phone_lookup
             WHERE identity_id = $1 AND phone_hash = $2 AND source = 'whatsapp'
             LIMIT 1`,
              [row.id, hash],
            );
            if (present.rows.length) counts.existing += 1;
            else counts.missing += 1;
          }
        }
        return counts;
      },
    );
    after = rows.at(-1).id;
    for (const name of /** @type {Array<keyof typeof total>} */ (
      Object.keys(total)
    )) {
      total[name] += batch[name];
    }
    options.onBatch?.({ after, ...batch, apply: Boolean(options.apply) });
    if (rows.length < batchSize) {
      complete = true;
      break;
    }
  }
  return Object.freeze({
    after,
    complete,
    apply: Boolean(options.apply),
    ...total,
  });
}
