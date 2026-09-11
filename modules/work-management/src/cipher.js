import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

/** @param {{key: Buffer}} input */
export function createHandoffCipher({ key }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('A 32-byte handoff envelope key is required');
  }
  const storedKey = Buffer.from(key);
  return Object.freeze({
    /** @param {string} value @param {string} pointer */
    encrypt(value, pointer) {
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGORITHM, storedKey, iv);
      cipher.setAAD(Buffer.from(pointer, 'utf8'));
      const ciphertext = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ]);
      return Object.freeze({
        algorithm: 'AES-256-GCM',
        ciphertext: ciphertext.toString('base64url'),
        iv: iv.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
        version: 1,
      });
    },
  });
}

/**
 * Decrypts the handoff summary stored by either the work-management service or
 * the n8n integration. The two writers intentionally use a different AAD
 * shape because the n8n handoff exists before a Deal does; the read model owns
 * selecting the matching shape from the persisted record.
 *
 * @param {unknown} value
 * @param {string} pointer
 * @param {Buffer} key
 */
export function decryptHandoffSummary(value, pointer, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('A 32-byte handoff envelope key is required');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid handoff envelope');
  }
  const envelope = /** @type {Record<string, unknown>} */ (value);
  if (
    envelope.algorithm !== 'AES-256-GCM' ||
    Number(envelope.version) !== 1 ||
    (envelope.keyVersion !== undefined && Number(envelope.keyVersion) !== 1)
  ) {
    throw new Error('Unsupported handoff envelope');
  }
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(String(envelope.iv), 'base64url'),
    );
    decipher.setAAD(Buffer.from(pointer, 'utf8'));
    decipher.setAuthTag(Buffer.from(String(envelope.tag), 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(String(envelope.ciphertext), 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new Error('Unable to authenticate handoff envelope', {
      cause: error,
    });
  }
}
