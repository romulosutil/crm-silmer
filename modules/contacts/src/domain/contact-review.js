import { createCipheriv, randomBytes } from 'node:crypto';

/** Free text stays encrypted; audit/events carry only field names and codes.
 * @param {string} reason @param {string} contactId @param {number} version @param {Buffer} key */
export function encryptContactReview(reason, contactId, version, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`crm.contact.review:${contactId}:${version}`));
  const ciphertext = Buffer.concat([
    cipher.update(reason, 'utf8'),
    cipher.final(),
  ]);
  return {
    algorithm: 'AES-256-GCM',
    version: 1,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}
