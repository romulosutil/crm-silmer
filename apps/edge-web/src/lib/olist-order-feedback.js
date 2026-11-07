// OLIST-T12: provider/internal detail never becomes UI copy.
/** @type {Readonly<Record<string, string>>} */
const ISSUES = Object.freeze({
  OLIST_CREATION_DISABLED: 'A geração real continua desligada.',
  OLIST_NOT_CONFIGURED:
    'A integração ainda não foi configurada pelo administrador.',
  OLIST_RECONNECT_REQUIRED:
    'Peça ao administrador para reconectar a conta Olist.',
  OLIST_SETTINGS_REQUIRED:
    'Peça ao administrador para completar os parâmetros comerciais.',
  OLIST_SETTINGS_INVALID:
    'Peça ao administrador para revisar os parâmetros comerciais.',
  OLIST_SETTINGS_REMOTE_MISSING:
    'Uma referência comercial mudou no Olist. Peça revisão ao administrador.',
  OLIST_PRODUCT_FISCAL_REQUIRED:
    'Peça ao administrador para completar os dados fiscais dos produtos.',
  OLIST_BUYER_REQUIRED:
    'Complete o cadastro fiscal e o contato do comprador na origem.',
  OLIST_BUYER_INVALID:
    'Revise os dados fiscais e de contato do comprador na origem.',
  OLIST_ORDER_REQUIRED:
    'Complete os campos principais, a arte, a entrega e o pagamento do pedido.',
  OLIST_SOURCE_INCOMPLETE:
    'Complete a composição suplementar do pedido, sem alterar o histórico.',
  OLIST_SOURCE_INVALID:
    'Revise a composição por tamanho e os campos principais do pedido.',
  OLIST_TOTAL_MISMATCH:
    'A composição por tamanho deve corresponder ao total do pedido.',
  SIZE_PRICING_NOT_INITIALIZED: 'Informe e revise os subtotais por tamanho.',
  SIZE_SUBTOTAL_REQUIRED: 'Informe o subtotal de cada tamanho.',
  SIZE_SUBTOTAL_REVIEW_REQUIRED:
    'Revise o subtotal após a mudança de quantidade.',
  OLIST_FRACTIONAL_CENT_UNIT:
    'O subtotal deste tamanho não pode ser representado exatamente no Olist. O pedido permanece válido no CRM.',
  ORDER_SOURCE_REQUIRED:
    'Complete a composição suplementar do pedido, sem alterar o histórico.',
  LEGACY_PRICE_BREAKDOWN_REQUIRED:
    'Informe os subtotais históricos por tamanho no complemento do pedido.',
  STORE_ORDER_COMPLEMENT_REQUIRED:
    'Complete o cadastro fiscal, a aplicação e a entrega no complemento da loja.',
  ORDER_SOURCE_STALE:
    'A composição suplementar mudou. Peça uma nova conferência à pessoa autorizada.',
  OLIST_OPERATION_EXISTS:
    'Já existe uma operação para este pedido. Atualize o estado antes de continuar.',
  OLIST_AMBIGUOUS_MATCH:
    'Há mais de um cadastro possível. É necessária uma conferência humana.',
  OLIST_RESOURCE_RECONCILIATION_REQUIRED:
    'Um cadastro precisa de reconciliação. Não repita a criação.',
  OLIST_INCOMPLETE_LOOKUP:
    'A consulta não foi concluída. Aguarde antes de fazer uma nova conferência.',
  ORDER_CANCELLED: 'Pedido cancelado. A geração está bloqueada.',
  OLIST_ORDER_CANCELLED: 'Pedido cancelado. A geração está bloqueada.',
  OLIST_AUTH: 'Peça ao administrador para reconectar a conta Olist.',
  OLIST_RATE_LIMITED: 'Aguarde um momento antes de consultar novamente.',
  OLIST_RESOURCE_DIVERGENT:
    'Um cadastro diverge dos dados conferidos. Peça revisão antes de continuar.',
  OLIST_CUSTOMER_DIVERGENT:
    'O cadastro do comprador diverge dos dados conferidos. Peça revisão antes de continuar.',
  OLIST_VARIATION_DIVERGENT:
    'O tamanho encontrado diverge do grupo conferido. Peça revisão antes de continuar.',
});

/** Known field names only; neither provider strings nor private IDs are shown.
 * @param {unknown} field */
export function olistIssueLocation(field) {
  const value = String(field ?? '');
  /** @type {Record<string, string>} */
  const labels = {
    personType: 'Tipo de pessoa',
    document: 'CPF ou CNPJ',
    legalName: 'Nome ou razão social',
    postalCode: 'CEP',
    city: 'Cidade',
    state: 'UF',
    street: 'Logradouro',
    district: 'Bairro',
    number: 'Número do endereço',
    stateRegistration: 'Inscrição estadual ou ISENTO',
    phone: 'Telefone',
    name: 'Nome do comprador',
    email: 'E-mail',
    tipo: 'Tipo de roupa',
    cor: 'Cor',
    tipo_servico: 'Técnica',
    malhas: 'Modelo de malha',
    gola: 'Gola',
    grade: 'Tamanhos',
    artwork: 'Arte do pedido',
    paymentCondition: 'Forma de pagamento',
    'summary.data_entrega_confirmada': 'Entrega prometida',
    finalAmount: 'Total por tamanho',
    finalAmountCents: 'Total por tamanho',
  };
  const item = /^items\[(\d+)\]\.(\w+)$/u.exec(value);
  if (item && labels[item[2]])
    return `Grupo ${Number(item[1]) + 1}: ${labels[item[2]]}`;
  if (value.startsWith('buyer.'))
    return labels[value.split('.').at(-1) ?? ''] ?? 'Cadastro do comprador';
  if (value.startsWith('settings.')) return 'Parâmetros comerciais da empresa';
  if (value.startsWith('sizePricing') || value.startsWith('priceBreakdown'))
    return 'Composição por tamanho';
  return labels[value] ?? 'Preparação do pedido';
}

/** @param {unknown} code */
export function olistIssueLabel(code) {
  return (
    ISSUES[String(code)] ??
    'Há uma pendência nesta etapa. Peça a uma pessoa autorizada para conferir a origem.'
  );
}

/** @param {any} cause */
export function olistOrderFailure(cause) {
  if ([401, 403].includes(Number(cause?.status)))
    return 'Seu acesso mudou ou sua sessão expirou. Entre novamente para continuar.';
  if (Number(cause?.status) === 404) return 'Pedido não encontrado.';
  if (Number(cause?.status) === 429)
    return 'Aguarde um momento antes de consultar novamente.';
  if (
    [
      'OLIST_PREVIEW_STALE',
      'OLIST_PREVIEW_EXPIRED',
      'OLIST_PREVIEW_INVALID',
    ].includes(cause?.code)
  )
    return 'A prévia mudou ou expirou. Confira uma nova prévia antes de continuar.';
  if (ISSUES[cause?.code]) return olistIssueLabel(cause.code);
  if (Number(cause?.status) === 409)
    return 'O pedido, a conta ou os parâmetros mudaram. Atualize o estado e faça uma nova conferência.';
  return 'Não foi possível concluir a consulta. Tente novamente em instantes.';
}

/** @param {unknown} action */
export function registrationActionLabel(action) {
  return action === 'reuse'
    ? 'Reutilizar cadastro conferido'
    : action === 'create'
      ? 'Cadastro necessário no Olist'
      : 'Conferência pendente';
}

/** @param {unknown} state */
export function olistStateLabel(state) {
  return (
    {
      queued: 'Preparação registrada',
      pending: 'Preparação registrada',
      resolving: 'Conferindo cadastros',
      ready: 'Cadastros conferidos',
      reserved: 'Efeito reservado — aguarde a conferência',
      confirmed: 'Venda confirmada no Olist',
      linked: 'Venda existente vinculada',
      rejected: 'Operação recusada',
      invalidated: 'Preparação invalidada',
      uncertain: 'Resultado incerto — não repetir a criação',
      blocked: 'Operação bloqueada',
    }[String(state)] ?? 'Operação em acompanhamento'
  );
}
