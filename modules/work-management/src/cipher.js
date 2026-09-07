import { createCipheriv, randomBytes } from 'node:crypto';

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
