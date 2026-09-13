import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Same AES-256-GCM JSON envelope as the n8n pre-ficha
// (modules/n8n-integration/src/crypto.js), so the ficha and the briefing it
// comes from share one format and one key. The AAD binds an envelope to its
// row: a ciphertext copied onto another order fails authentication.

const CIPHER = 'aes-256-gcm';
const ALGORITHM = 'AES-256-GCM';

/** @param {Buffer} key */
function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('envelopeKey must be a 32-byte Buffer');
  }
}

/** @param {unknown} value @param {string} aad @param {Buffer} key */
export function encryptJson(value, aad, key) {
  requireKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return Object.freeze({
    algorithm: ALGORITHM,
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    keyVersion: 1,
    tag: cipher.getAuthTag().toString('base64url'),
    version: 1,
  });
}

/** @param {unknown} raw @param {string} aad @param {Buffer} key */
export function decryptJson(raw, aad, key) {
  requireKey(key);
  const envelope = /** @type {Record<string, any>|null} */ (
    raw && typeof raw === 'object' ? raw : null
  );
  if (
    envelope?.algorithm !== ALGORITHM ||
    Number(envelope.keyVersion) !== 1 ||
    Number(envelope.version) !== 1
  ) {
    throw new Error('Unsupported order envelope');
  }
  try {
    const decipher = createDecipheriv(
      CIPHER,
      key,
      Buffer.from(envelope.iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    );
  } catch (error) {
    throw new Error('Unable to authenticate order envelope', { cause: error });
  }
}
