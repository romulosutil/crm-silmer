/**
 * PED-RD-06 (ADR 080, OLC-05): the pure rules of the freight slot of the
 * rail — what the seller typed becomes whole cents, the origin becomes text
 * and a refused write becomes a sentence. The server stays the authority.
 */
import { formatBrl, parseBrl } from './order-format.js';

export const FREIGHT_FORMAT_MESSAGE = 'Use o formato 120,00.';

/**
 * Zero is a valid freight ("sem frete"); an empty field means zero.
 *
 * @param {unknown} text
 * @returns {{ok: true, cents: number}|{ok: false, message: string}}
 */
export function parseFreightInput(text) {
  const value = String(text ?? '')
    .trim()
    .replace(/^R\$\s*/iu, '');
  if (value === '' || /^0(?:,0{1,2})?$/u.test(value))
    return { cents: 0, ok: true };
  const cents = parseBrl(value);
  return cents === null
    ? { message: FREIGHT_FORMAT_MESSAGE, ok: false }
    : { cents, ok: true };
}

/**
 * What the field shows: a freight that was never informed stays empty; a
 * declared zero reads "0,00".
 *
 * @param {number} cents @param {string|null} source
 */
export function freightFieldText(cents, source) {
  if (cents > 0) return formatBrl(cents);
  return source ? '0,00' : '';
}

/**
 * @param {{source?: string|null, quoteId?: string|null, serviceId?: number|null}} freight
 * @param {{id?: string, services?: {id: number, company: string, name: string}[]}|null} quote
 */
export function freightOriginLabel(freight, quote) {
  if (freight.source === 'seller') return 'Informado pelo vendedor';
  if (freight.source === 'quote') {
    const service =
      quote?.id === freight.quoteId
        ? quote?.services?.find(
            (candidate) => candidate.id === freight.serviceId,
          )
        : undefined;
    return service
      ? `Da cotação ${service.company} · ${service.name}`
      : 'Da cotação';
  }
  return 'Sem frete informado';
}

/**
 * @param {{code?: string, status?: number, message?: string}} result a refused
 *   `order.freight` command as the page reports it
 * @returns {{message: string, reload?: boolean}}
 */
export function freightErrorMessage(result) {
  const code = String(result.code ?? '');
  if (code === 'VERSION_CONFLICT')
    return { message: 'Este pedido mudou em outro lugar.', reload: true };
  if (code === 'FREIGHT_INVALID') return { message: FREIGHT_FORMAT_MESSAGE };
  if (code === 'FREIGHT_OVERFLOW')
    return { message: 'O valor passa do limite aceito.' };
  if (code === 'SHIPPING_QUOTE_STALE')
    return {
      message: 'A cotação ficou desatualizada. Consulte o frete de novo.',
    };
  if (code === 'FREIGHT_QUOTE_UNAVAILABLE')
    return { message: 'A cotação não está disponível agora.' };
  if (
    code === 'INVALID_SHIPPING_SERVICE' ||
    code === 'SHIPPING_QUOTE_NOT_FOUND'
  )
    return { message: 'Essa cotação não vale mais. Consulte o frete de novo.' };
  if (code === 'SIZE_PRICING_NOT_INITIALIZED')
    return {
      message: 'Informe os subtotais por tamanho nos itens antes do frete.',
    };
  if (
    ['ORDER_STATUS_CONFLICT', 'ORDER_LOCKED', 'ORDER_CANCELLED'].includes(code)
  )
    return { message: 'Este pedido não aceita mais alteração de frete.' };
  if (result.status === 403 || code === 'FORBIDDEN')
    return { message: 'Só o vendedor responsável informa o frete.' };
  if (result.status === 0)
    return { message: 'Sem conexão com o servidor. O frete não foi salvo.' };
  return { message: 'Não foi possível salvar o frete.' };
}
