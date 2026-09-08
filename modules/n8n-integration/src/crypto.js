import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';

const CIPHER = 'aes-256-gcm';

/** @param {unknown} value */
export function fingerprint(value) {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

/** @param {unknown} value @returns {string} */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new TypeError('value must be JSON serializable');
  return serialized;
}

/** @param {unknown} value @param {string} aadValue @param {Buffer} key */
export function encryptJson(value, aadValue, key) {
  requireKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(Buffer.from(aadValue, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return Object.freeze({
    algorithm: 'AES-256-GCM',
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    keyVersion: 1,
    tag: cipher.getAuthTag().toString('base64url'),
    version: 1,
  });
}

/** @param {unknown} raw @param {string} aadValue @param {Buffer} key */
export function decryptJson(raw, aadValue, key) {
  requireKey(key);
  if (!raw || typeof raw !== 'object')
    throw new Error('Invalid encrypted envelope');
  const envelope = /** @type {Record<string, any>} */ (raw);
  if (
    envelope.algorithm !== 'AES-256-GCM' ||
    Number(envelope.keyVersion) !== 1 ||
    Number(envelope.version) !== 1
  ) {
    throw new Error('Unsupported encrypted envelope');
  }
  try {
    const decipher = createDecipheriv(
      CIPHER,
      key,
      Buffer.from(envelope.iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(aadValue, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    );
  } catch (error) {
    throw new Error('Unable to authenticate encrypted envelope', {
      cause: error,
    });
  }
}

/** @param {Record<string, any>} identity @param {Buffer} lookupKey */
export function identityLookupHash(identity, lookupKey) {
  requireKey(lookupKey);
  return createHmac('sha256', lookupKey)
    .update(
      JSON.stringify([
        identity.provider,
        identity.providerAccountId,
        identity.channel,
        identity.externalIdentityId,
      ]),
      'utf8',
    )
    .digest('hex');
}

/** @param {string} token */
export function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** @param {Buffer} key */
function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('encryption key must be a 32-byte Buffer');
  }
}
