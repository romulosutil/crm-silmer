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
    sellerAllowlist,
    envelopeKey,
    lookupKey,
    generalNumberDigest,
  };
}
