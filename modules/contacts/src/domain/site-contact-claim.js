import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { normalizeContactPhone } from './contact-details.js';

/** @param {string} id @param {number} version */
function aad(id, version) {
  if (
    typeof id !== 'string' ||
    !id ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new TypeError('Valid claim id and version are required');
  }
  return Buffer.from(`site-contact-claim:${id}:${version}`);
}

/** @param {{name: string, phone: string}} details @param {string} id
 * @param {number} version @param {Buffer} key */
export function encryptSiteContactClaim(details, id, version, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new TypeError('Claim key must be 32 bytes');
  const name = typeof details?.name === 'string' ? details.name.trim() : '';
  const phone = normalizeContactPhone(details?.phone);
  if (!name || name.length > 120 || !phone) {
    throw new TypeError('Valid claim name and phone are required');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(id, version));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ name, phone }), 'utf8'),
    cipher.final(),
  ]);
  return {
    algorithm: 'AES-256-GCM',
    keyVersion: 1,
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/** @param {unknown} value @param {string} id @param {number} version @param {Buffer} key
 * @returns {{name: string, phone: string}} */
export function decryptSiteContactClaim(value, id, version, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new TypeError('Claim key must be 32 bytes');
  const envelope = /** @type {any} */ (
    typeof value === 'string' ? JSON.parse(value) : value
  );
  if (
    envelope?.algorithm !== 'AES-256-GCM' ||
    envelope?.version !== 1 ||
    envelope?.keyVersion !== 1
  ) {
    throw new Error('Stored site contact claim is invalid');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAAD(aad(id, version));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const details = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8'),
  );
  if (
    !details ||
    typeof details.name !== 'string' ||
    normalizeContactPhone(details.phone) !== details.phone
  ) {
    throw new Error('Stored site contact claim details are invalid');
  }
  return details;
}
