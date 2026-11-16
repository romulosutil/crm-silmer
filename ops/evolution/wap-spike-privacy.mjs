/** Collect challenge/token strings recursively without serializing their values.
 * @param {unknown} value @returns {string[]}
 */
function privateStrings(value) {
  if (typeof value === 'string') return value.length >= 8 ? [value] : [];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(privateStrings);
}

/** @param {unknown} challenges @param {string} token @returns {Buffer[]} */
export function privateRepresentations(challenges, token) {
  if (token.length < 32) throw new Error('WAP_SCAN_TOKEN_REQUIRED');
  return [...privateStrings(challenges), token].flatMap((value) => [
    Buffer.from(value),
    Buffer.from(Buffer.from(value).toString('base64')),
    Buffer.from(JSON.stringify(value).slice(1, -1)),
  ]);
}

/** @param {Buffer} bytes @param {Buffer[]} representations @returns {boolean} */
export function containsPrivateValue(bytes, representations) {
  if (!representations.length) throw new Error('WAP_SCAN_CANARIES_REQUIRED');
  return representations.some((value) => bytes.includes(value));
}
