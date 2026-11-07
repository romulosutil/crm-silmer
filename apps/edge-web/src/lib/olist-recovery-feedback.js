import { olistOrderFailure } from './olist-order-feedback.js';

/** @param {unknown} stage */
export function olistStageLabel(stage) {
  return (
    /** @type {Record<string,string>} */ ({
      customer: 'Cliente comprador',
      product: 'Produto pai',
      variation: 'Tamanho',
      sale: 'Venda',
      resources: 'Cadastros',
      complete: 'Concluído',
      preview: 'Conferência',
    })[String(stage)] ?? 'Etapa em acompanhamento'
  );
}

/** @param {unknown} state */
export function olistResourceLabel(state) {
  return (
    /** @type {Record<string,string>} */ ({
      pending: 'Aguardando conferência',
      reserved: 'Efeito reservado — aguarde',
      confirmed: 'Conferido no Olist',
      uncertain: 'Resultado incerto — não repetir a criação',
      rejected: 'Recusado',
    })[String(state)] ?? 'Situação em acompanhamento'
  );
}

/** @param {unknown} status */
export function olistReadStatus(status) {
  return (
    /** @type {Record<string,string>} */ ({
      queued: 'Consulta aguardando processamento',
      succeeded: 'Correspondência confirmada',
      blocked: 'Sem prova suficiente — análise necessária',
    })[String(status)] ?? 'Consulta em acompanhamento'
  );
}

/** @param {unknown} value */
export function olistRecoveryDate(value) {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Sao_Paulo',
      }).format(time)
    : 'Data não informada';
}

/** @param {unknown} value */
export function olistRemoteNumber(value) {
  return /^[1-9][0-9]{0,18}$/u.test(String(value ?? ''))
    ? String(value)
    : 'Ainda não confirmado';
}

/** Display a bounded sale number as text, never as an ERP URL.
 * @param {unknown} value */
export function olistSaleNumber(value) {
  return typeof value === 'string' &&
    value.trim() &&
    value.length <= 64 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : 'Ainda não confirmado';
}

/** No provider details, raw errors or untrusted code strings become UI copy.
 * @param {any} cause */
export function olistRecoveryFailure(cause) {
  if (
    [
      'OLIST_RECONCILIATION_REQUIRED',
      'OLIST_SALE_UNCERTAIN',
      'OLIST_SALE_RECONCILIATION_REQUIRED',
    ].includes(cause?.code)
  )
    return 'Há uma operação que exige reconciliação. Não repita a criação nem tente outro vínculo.';
  if (
    [
      'OLIST_SALE_DIVERGENT',
      'OLIST_SALE_READBACK_MISMATCH',
      'OLIST_SALE_REFERENCE_CONFLICT',
      'OLIST_PRODUCT_DIVERGENT',
      'OLIST_PRODUCT_FISCAL_DIVERGENT',
    ].includes(cause?.code)
  )
    return 'A venda ou os cadastros não correspondem ao pedido. Peça análise antes de continuar.';
  if (cause?.code === 'OLIST_ORDER_INCOMPLETE')
    return 'Complete a ficha e o cadastro fiscal antes de conferir a venda existente.';
  if (Number(cause?.status) === 404)
    return 'O registro não foi encontrado nesta conta ou neste pedido. Confira o identificador.';
  return olistOrderFailure(cause);
}
