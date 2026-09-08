import { createDecipheriv } from 'node:crypto';

const CIPHER = 'aes-256-gcm';

/**
 * Decrypts the minimal contact identity projection. The key remains in the API
 * process and plaintext is returned only after the HTTP read guard succeeds.
 *
 * @param {unknown} value
 * @param {string} lookupHash
 * @param {Buffer} key
 */
export function decryptContactIdentityEnvelope(value, lookupHash, key) {
  const envelope =
    typeof value === 'string' ? JSON.parse(value) : /** @type {any} */ (value);
  if (
    !envelope ||
    envelope.algorithm !== 'AES-256-GCM' ||
    Number(envelope.keyVersion) !== 1 ||
    Number(envelope.version) !== 1
  ) {
    throw new Error('Stored identity envelope is invalid');
  }
  try {
    const decipher = createDecipheriv(
      CIPHER,
      key,
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAAD(
      Buffer.from(JSON.stringify(['crm.contact_identities', 1, lookupHash])),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const parsed = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8'),
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Stored identity payload is invalid');
    }
    return /** @type {Record<string, any>} */ (parsed);
  } catch (error) {
    throw new Error('Unable to authenticate or decrypt contact identity', {
      cause: error,
    });
  }
}
