import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'AES-256-GCM';
const CIPHER = 'aes-256-gcm';

/** @param {{key: Buffer}} options */
export function createDealLossReasonCipher({ key }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('A 32-byte deal envelope key is required');
  }
  const envelopeKey = Buffer.from(key);
  return Object.freeze({
    /** @param {string} reason @param {string} dealId */
    encrypt(reason, dealId) {
      const iv = randomBytes(12);
      const cipher = createCipheriv(CIPHER, envelopeKey, iv);
      cipher.setAAD(Buffer.from(dealId, 'utf8'));
      const ciphertext = Buffer.concat([
        cipher.update(reason, 'utf8'),
        cipher.final(),
      ]);
      return Object.freeze({
        algorithm: ALGORITHM,
        ciphertext: ciphertext.toString('base64url'),
        iv: iv.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
        version: 1,
      });
    },
    /** @param {any} envelope @param {string} dealId */
    decrypt(envelope, dealId) {
      if (
        !envelope ||
        envelope.algorithm !== ALGORITHM ||
        envelope.version !== 1
      ) {
        throw new Error('Unsupported deal reason envelope');
      }
      const decipher = createDecipheriv(
        CIPHER,
        envelopeKey,
        Buffer.from(envelope.iv, 'base64url'),
      );
      decipher.setAAD(Buffer.from(dealId, 'utf8'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  });
}
