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

/** Report archive file names and secret categories, never matching bytes.
 * @param {Buffer} archive
 * @param {{label: string, values: Buffer[]}[]} groups
 * @returns {{file: string, kinds: string[]}[]}
 */
export function classifyPrivateTar(archive, groups) {
  const result = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.toString('utf8', 0, 100).split('\0')[0];
    const size = Number.parseInt(
      header.toString('ascii', 124, 136).replace(/\0/g, '').trim() || '0',
      8,
    );
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 512 + size > archive.length
    )
      throw new Error('WAP_ARCHIVE_INVALID');
    const bytes = archive.subarray(offset + 512, offset + 512 + size);
    const kinds = groups
      .filter(
        (group) =>
          group.values.length && containsPrivateValue(bytes, group.values),
      )
      .map((group) => group.label);
    if (kinds.length)
      result.push({
        file: /^\.\/(?:base|global|pg_wal)\/[A-Za-z0-9_./-]+$/.test(name)
          ? name
          : 'other-private-file',
        kinds,
      });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
}
