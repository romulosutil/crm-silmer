import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const CIPHER = 'aes-256-gcm';

/** @param {{key: Buffer}} input */
export function createQualificationCipher({ key }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('A 32-byte qualification envelope key is required');
  }
  const storedKey = Buffer.from(key);
  return Object.freeze({
    /** @param {string} value @param {string} pointer */
    encrypt(value, pointer) {
      const iv = randomBytes(12);
      const cipher = createCipheriv(CIPHER, storedKey, iv);
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
    /** @param {any} envelope @param {string} pointer */
    decrypt(envelope, pointer) {
      const decipher = createDecipheriv(
        CIPHER,
        storedKey,
        Buffer.from(envelope.iv, 'base64url'),
      );
      decipher.setAAD(Buffer.from(pointer, 'utf8'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  });
}
