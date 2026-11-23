const CURRENCY = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Financial zero is a value, not an absent price. @param {unknown} cents */
export function billingMoney(cents) {
  return Number.isSafeInteger(cents) && Number(cents) >= 0
    ? CURRENCY.format(Number(cents) / 100)
    : '—';
}

/** Defense in depth for private checkout/receipt links. @param {unknown} value */
export function billingUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    const allowed = ['infinitepay.io', 'infinitepay.com.br'].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      allowed
      ? url.href
      : '';
  } catch {
    return '';
  }
}

/**
 * RFC 074 (LPC-01): the customer receives the CRM's own payment page,
 * `{origem do CRM}/pagar/{token}`. Only a same-origin `/pagar/` address is
 * shown or copied; anything else from the API is dropped.
 *
 * @param {unknown} value
 * @param {string} [origin] the CRM origin; the page's own by default
 */
export function billingLinkUrl(value, origin = globalThis.location?.origin) {
  if (typeof value !== 'string' || !origin) return '';
  try {
    const url = new URL(value);
    return url.origin === origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/pagar\/[0-9A-Za-z]{6,64}$/u.test(url.pathname)
      ? url.href
      : '';
  } catch {
    return '';
  }
}

const REASONS = Object.freeze({
  BILLING_DISABLED:
    'Novas cobranças estão desativadas. As movimentações e os recebimentos continuam visíveis.',
  BILLING_ORDER_NOT_CONFIRMED: 'Confirme o pedido antes de cobrar.',
  ORDER_CANCELLED:
    'Pedido cancelado. As movimentações continuam visíveis; novos links e registros estão bloqueados.',
  BILLING_STORE_ORDER: 'Este pedido usa o checkout da loja.',
  BILLING_LEGACY_PAYMENT:
    'Este pedido já tem um pagamento manual. Revise esse registro antes de usar as cobranças integradas.',
  BILLING_REVIEW_REQUIRED:
    'Este pedido precisa de conferência. Até resolver, não é possível cobrar, enviar link ou registrar pagamento por fora.',
  BILLING_ACTIVE_CHARGE:
    'Já existe uma cobrança em andamento para este pedido.',
  BILLING_INVALID_PERCENT: 'Escolha a condição: 0%, 50% ou 100%.',
  BILLING_ALREADY_PAID: 'O valor integral deste pedido já foi recebido.',
  FORBIDDEN:
    'Só o responsável pelo pedido ou um administrador opera as cobranças deste pedido.',
  BILLING_UNKNOWN:
    'Não sabemos se a InfinitePay abriu o pagamento. Confirme o resultado na InfinitePay antes de continuar.',
  BILLING_LINK_NOT_OPEN:
    'O cliente já clicou em Pagar neste link. Acompanhe o pagamento.',
  BILLING_LINK_AMOUNT_INVALID:
    'O valor de um link vai de R$ 1,00 até o livre para cobrar.',
  BILLING_LINK_EXCEEDS_FREE:
    'O valor passa do livre para cobrar. Os valores foram atualizados; revise o link.',
  BILLING_RECEIPT_EXCEEDS_FREE:
    'Este valor usa dinheiro reservado em links abertos. Os valores foram atualizados; revise o registro.',
  BILLING_LINK_IN_PAYMENT:
    'O cliente está pagando este link na InfinitePay. Aguarde ou verifique o pagamento.',
  BILLING_LINK_UNKNOWN:
    'Este link está em Resultado a conferir. Confirme o resultado antes de registrar.',
  BILLING_USE_PAYMENT_LINK:
    'As cobranças agora usam o link de pagamento do CRM. Atualize as cobranças e envie o link pelo Próximo passo.',
});

/** @param {string|undefined} code */
export function billingReason(code) {
  return (
    REASONS[/** @type {keyof typeof REASONS} */ (String(code ?? ''))] ??
    'Não foi possível concluir a operação. Atualize as cobranças e tente de novo.'
  );
}

/** @param {any} cause */
export function billingError(cause) {
  const code = String(cause?.code ?? '');
  if (Object.hasOwn(REASONS, code) && code !== 'BILLING_ACTIVE_CHARGE')
    return billingReason(code);
  if (Number(cause?.status) === 409)
    return 'O pedido ou as cobranças mudaram. Os valores foram atualizados; revise antes de continuar.';
  if (Number(cause?.status) === 403) return billingReason('FORBIDDEN');
  if (code.startsWith('BILLING_')) return billingReason(code);
  if (Number(cause?.status) >= 500)
    return 'O serviço de cobranças está indisponível. Atualize as cobranças antes de tentar de novo.';
  return 'Não foi possível concluir a operação. Confira os valores e atualize as cobranças.';
}
