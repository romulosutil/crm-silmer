import { normalizeContactPhone } from '@crm-silmer/contacts';
import { normalizeDocument } from './configuration.js';
import { identityHash } from './crypto.js';
import { OlistError } from './errors.js';
import { buildCustomerPayload } from './resource-payloads.js';

/** @param {unknown} value */
export function olistBuyerRegistrationEmpty(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every(
        (field) =>
          field === null ||
          field === undefined ||
          (typeof field === 'string' && !field.trim()),
      ))
  );
}
/** Fields the fiscal customer path needs. ADR 082: all of them are mandatory
 * for a new Olist send and never for saving, confirming or printing an Order. */
export const OLIST_BUYER_REQUIRED_REGISTRATION = Object.freeze([
  'personType',
  'document',
  'legalName',
  'postalCode',
  'city',
  'state',
  'street',
  'district',
  'number',
]);
/**
 * True for an empty or partial CRM registration. ADR 082 (supersedes ADR 081):
 * such a registration blocks a new Olist send; it is never completed from the
 * ERP nor replaced by a name/phone lookup. Malformed values are not
 * "incomplete" and are refused by the field validation.
 * @param {unknown} value
 */
export function olistBuyerRegistrationIncomplete(value) {
  if (olistBuyerRegistrationEmpty(value)) return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const registration = /** @type {Record<string, unknown>} */ (value);
  /** @param {string} key */
  const filled = (key) =>
    typeof registration[key] === 'string' && registration[key].trim() !== '';
  return (
    !OLIST_BUYER_REQUIRED_REGISTRATION.every(filled) ||
    (registration.personType === 'company' && !filled('stateRegistration'))
  );
}
/** @param {unknown} value */
export function olistExistingBuyerName(value) {
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new OlistError('OLIST_CUSTOMER_DIVERGENT');
  const name = value.normalize('NFC').trim().toLocaleLowerCase('pt-BR');
  if (name.length < 2) throw new OlistError('OLIST_CUSTOMER_DIVERGENT');
  return name;
}
/** @param {any} contact @param {{name:string,phone:string}} identity */
export function olistExistingBuyerMatches(contact, identity) {
  const names = [contact?.nome, contact?.fantasia].filter(
    (name) => typeof name === 'string' && name.trim(),
  );
  return (
    names.some((name) => olistExistingBuyerName(name) === identity.name) &&
    [contact?.celular, contact?.telefone].some(
      (phone) => normalizeContactPhone(phone) === identity.phone,
    )
  );
}
/** @param {any} config @param {unknown} document */
export function olistExistingBuyerDocumentHash(config, document) {
  if (document === null || document === undefined || document === '')
    return null;
  return identityHash(config.hmacKey, 'existing-buyer-document-v1', [
    config.accountKey,
    normalizeDocument(document),
  ]);
}
/** @param {any} config @param {any} source */
function digest(config, source) {
  if (typeof config.accountKey !== 'string' || !config.accountKey)
    throw new OlistError('OLIST_NOT_CONFIGURED', 503);
  return identityHash(config.hmacKey, 'existing-buyer-v1', [
    config.accountKey,
    source.remoteId,
    source.identity,
    source.documentHash,
  ]);
}
/** Capture only the identity needed for reuse; fiscal/address data stay in ERP.
 * @param {{config:any,buyer:any,contact:any}} input */
export function captureOlistExistingBuyer({ config, buyer, contact }) {
  const phone = normalizeContactPhone(buyer?.phone);
  if (!phone) throw new OlistError('OLIST_CUSTOMER_DIVERGENT');
  const identity = { name: olistExistingBuyerName(buyer?.name), phone };
  if (
    !Number.isSafeInteger(contact?.id) ||
    contact.id < 1 ||
    !['A', 'B'].includes(contact.situacao) ||
    !olistExistingBuyerMatches(contact, identity)
  )
    throw new OlistError('OLIST_CUSTOMER_DIVERGENT');
  const source = {
    mode: 'erp-existing-v1',
    remoteId: String(contact.id),
    identity,
    documentHash: olistExistingBuyerDocumentHash(config, contact.cpfCnpj),
  };
  return {
    customer: { nome: identity.name, celular: identity.phone },
    buyerSource: { ...source, digest: digest(config, source) },
  };
}
/** This local check is mandatory even when the snapshot came from storage.
 * @param {{config:any,customer:any,buyerSource:any}} input */
export function assertOlistExistingBuyerSource({
  config,
  customer,
  buyerSource: source,
}) {
  if (
    !source ||
    source.mode !== 'erp-existing-v1' ||
    typeof source.remoteId !== 'string' ||
    !/^[1-9][0-9]{0,15}$/u.test(source.remoteId) ||
    !Number.isSafeInteger(Number(source.remoteId)) ||
    !source.identity ||
    source.identity.name !== olistExistingBuyerName(customer?.nome) ||
    source.identity.phone !== normalizeContactPhone(customer?.celular) ||
    !source.identity.phone ||
    (source.documentHash !== null &&
      !/^[a-f0-9]{64}$/u.test(source.documentHash)) ||
    source.digest !== digest(config, source)
  )
    throw new OlistError('OLIST_CUSTOMER_DIVERGENT');
  return { remoteId: source.remoteId };
}
/** @param {{client:any,config:any,buyer:any}} input */
export async function resolveOlistExistingBuyer({ client, config, buyer }) {
  // Administrative historical linking only (ADR 072/073): an entirely empty
  // registration. A new send never reaches this lookup (ADR 082).
  if (!olistBuyerRegistrationEmpty(buyer?.registration))
    throw new OlistError('OLIST_CUSTOMER_DIVERGENT');
  const identity = {
    name: olistExistingBuyerName(buyer?.name),
    phone: normalizeContactPhone(buyer?.phone),
  };
  if (!identity.phone) throw new OlistError('OLIST_CUSTOMER_DIVERGENT');
  const contact = await client.findCustomerByIdentity(identity);
  if (!contact) throw new OlistError('OLIST_CUSTOMER_NOT_FOUND', 422);
  return captureOlistExistingBuyer({ config, buyer, contact });
}
/** Fresh GET of the frozen ID, never a new search or a customer write.
 * @param {{client:any,config:any,customer:any,buyerSource:any}} input */
export async function verifyOlistExistingBuyer({
  client,
  config,
  customer,
  buyerSource,
}) {
  const { remoteId } = assertOlistExistingBuyerSource({
    config,
    customer,
    buyerSource,
  });
  const contact = await client.contact(Number(remoteId));
  const current = captureOlistExistingBuyer({
    config,
    buyer: { name: customer.nome, phone: customer.celular },
    contact,
  });
  if (
    current.buyerSource.remoteId !== remoteId ||
    (buyerSource.documentHash !== null &&
      current.buyerSource.documentHash !== buyerSource.documentHash)
  )
    throw new OlistError('OLIST_CUSTOMER_DIVERGENT');
  return { remoteId };
}
/**
 * ADR 082 gate for a NEW send, applied to a frozen snapshot before any
 * creating effect: an ERP reference (`erp-existing-v1`) never replaces the
 * registration, and the customer must be the complete fiscal payload.
 * Pure and local: no lookup, no write.
 * @param {any} snapshot
 */
export function olistNewSendBuyerBlocked(snapshot) {
  if (snapshot?.buyerSource !== null && snapshot?.buyerSource !== undefined)
    return true;
  try {
    buildCustomerPayload(snapshot?.customer, 'CRM-customer');
    return false;
  } catch {
    return true;
  }
}
