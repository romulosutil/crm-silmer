import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

const AAD = 'crm.contacts.contact_details.v1';

/** A number entered by a person is contact information, not a verified channel identity. */
/** @param {unknown} value */
export function normalizeContactPhone(value) {
  if (typeof value !== 'string' || !/^\+?[\d\s().-]+$/u.test(value))
    return null;
  const digits = value.replace(/\D/gu, '');
  const national =
    digits.startsWith('55') && [12, 13].includes(digits.length)
      ? digits.slice(2)
      : digits;
  if (
    ![10, 11].includes(national.length) ||
    national.startsWith('0') ||
    /^(\d)\1+$/u.test(national)
  )
    return null;
  return `55${national}`;
}

/** @param {unknown} value */
export function normalizeContactEmail(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed))
    return undefined;
  return trimmed;
}

/** @param {string} phone @param {Buffer} key */
export function contactPhoneHash(phone, key) {
  return createHmac('sha256', key)
    .update(`${AAD}:phone:${phone}`)
    .digest('hex');
}

/** @param {{email: string|null, phone: string}} details @param {Buffer} key */
export function encryptContactDetails(details, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(AAD));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(details), 'utf8'),
    cipher.final(),
  ]);
  return {
    algorithm: 'AES-256-GCM',
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/** @param {unknown} value @param {Buffer} key @returns {{email: string|null, phone: string|null}} */
export function decryptContactDetails(value, key) {
  if (!value) return { email: null, phone: null };
  const envelope = /** @type {any} */ (
    typeof value === 'string' ? JSON.parse(value) : value
  );
  if (envelope?.algorithm !== 'AES-256-GCM' || envelope?.version !== 1) {
    throw new Error('Stored contact details are invalid');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(AAD));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8'),
  );
}
