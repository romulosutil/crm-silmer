/** For self-service, prepare the technical allowlists before a user's first
 * connection. Absent configuration keeps existing on-demand deployments valid.
 * @param {string|undefined} raw @param {string[]} sellers */
function provisionedLines(raw, sellers) {
  if (raw === undefined) return undefined;
  const error = () =>
    new Error(
      'SELLER_WHATSAPP_PROVISIONED_LINES requires unique slots for the allowed sellers',
    );
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    throw error();
  }
  if (
    !entries ||
    typeof entries !== 'object' ||
    Array.isArray(entries) ||
    Object.keys(entries).length !== sellers.length
  )
    throw error();
  const lines = new Map();
  const ids = new Set();
  const instances = new Set();
  for (const seller of sellers) {
    const slot = Object.hasOwn(entries, seller) && entries[seller];
    if (
      !slot ||
      Object.keys(slot).length !== 2 ||
      typeof slot.lineId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
        slot.lineId,
      ) ||
      typeof slot.instance !== 'string' ||
      !/^wap_[a-f0-9]{32}$/u.test(slot.instance) ||
      ids.has(slot.lineId) ||
      instances.has(slot.instance)
    )
      throw error();
    ids.add(slot.lineId);
    instances.add(slot.instance);
    lines.set(seller, { lineId: slot.lineId, instance: slot.instance });
  }
  return lines;
}

/** WAP-E02: parse only server-owned configuration; off unless explicitly enabled.
 * @param {Record<string,string|undefined>} environment */
export function sellerWhatsAppConfiguration(environment) {
  const flag = environment.SELLER_WHATSAPP_CONTROL_ENABLED;
  if (flag !== undefined && !['true', 'false'].includes(flag))
    throw new Error('SELLER_WHATSAPP_CONTROL_ENABLED must be true or false');
  const enabled = flag === 'true';
  let sellerAllowlist = [];
  try {
    sellerAllowlist = JSON.parse(
      environment.SELLER_WHATSAPP_SELLER_IDS ?? '[]',
    );
  } catch {
    throw new Error('SELLER_WHATSAPP_SELLER_IDS must be a JSON array');
  }
  if (
    !Array.isArray(sellerAllowlist) ||
    sellerAllowlist.some(
      (id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(id),
    ) ||
    new Set(sellerAllowlist).size !== sellerAllowlist.length ||
    (enabled && !sellerAllowlist.length)
  )
    throw new Error('SELLER_WHATSAPP_SELLER_IDS requires explicit seller IDs');
  const envelopeKey = Buffer.from(
    environment.CONTACT_IDENTITY_ENVELOPE_KEY ?? '',
    'base64',
  );
  const lookupKey = Buffer.from(
    environment.CONTACT_IDENTITY_LOOKUP_KEY ?? '',
    'base64',
  );
  const generalNumberDigest = environment.SELLER_WHATSAPP_GENERAL_NUMBER_DIGEST;
  if (
    enabled &&
    (envelopeKey.length !== 32 ||
      lookupKey.length !== 32 ||
      !/^[a-f0-9]{64}$/u.test(generalNumberDigest ?? ''))
  )
    throw new Error(
      'Seller WhatsApp control requires encryption/lookup keys and general line digest',
    );
  return {
    enabled,
    provisionedLines: provisionedLines(
      environment.SELLER_WHATSAPP_PROVISIONED_LINES,
      sellerAllowlist,
    ),
    sellerAllowlist,
    envelopeKey,
    lookupKey,
    generalNumberDigest,
  };
}
