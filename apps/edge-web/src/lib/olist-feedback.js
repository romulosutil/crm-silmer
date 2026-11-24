/** Fixed messages only: provider payloads and receipts never become UI copy. */
/** @param {any} cause @param {{direct?:boolean}} [options] */
export function olistFailure(cause, options = {}) {
  const direct = options.direct === true;
  const status = Number(cause?.status);
  const code = String(cause?.code ?? '');
  if (code === 'ORDER_NOT_CONFIRMED')
    return 'Disponível após confirmar o pedido.';
  if (code === 'OLIST_CUSTOMER_INVALID')
    return 'Complete os dados para gerar no Olist: o cadastro do comprador está incompleto ou inválido.';
  if (
    code === 'OLIST_SALE_EXACT_CENT_REQUIRED' ||
    code === 'OLIST_EXACT_CENT_REQUIRED' ||
    code === 'OLIST_FRACTIONAL_CENT_UNIT'
  )
    return 'Valor do tamanho não representável no Olist. Ajuste o subtotal antes de gerar.';
  if (code === 'OLIST_FREIGHT_INVALID' || code === 'OLIST_TOTAL_MISMATCH')
    return 'O frete ou o total do pedido mudou ou é inválido. Confira os valores antes de gerar.';
  if (code === 'OLIST_ORDER_INCOMPLETE')
    return 'Complete os dados para gerar no Olist.';
  if (code === 'OLIST_LEGACY_REVIEW_REQUIRED')
    return 'Venda histórica pendente de conferência. Novo envio deste pedido está bloqueado.';
  if (code === 'OLIST_CREATION_DISABLED')
    return 'Integração Olist indisponível.';
  if (code === 'OLIST_CUSTOMER_NOT_FOUND')
    return 'Comprador não localizado no Olist. Confira o nome e o telefone antes de revisar novamente.';
  if (code === 'OLIST_PAYMENT_DUE_REQUIRED')
    return direct
      ? 'Informe um vencimento válido para este pedido antes de gerar no Olist.'
      : 'Informe um vencimento válido para este pedido e confira uma nova prévia.';
  if (code === 'OLIST_PRODUCT_FISCAL_REQUIRED')
    return 'Confira NCM, origem e unidade dos produtos e solicite uma nova prévia.';
  if ([401, 403].includes(status))
    return 'Seu acesso mudou ou sua sessão expirou. Entre novamente para continuar.';
  if (code === 'OLIST_PREVIEW_EXPIRED')
    return 'A prévia expirou. Confira uma nova prévia antes de continuar.';
  if (
    [
      'OLIST_PREVIEW_STALE',
      'OLIST_PREVIEW_INVALID',
      'OLIST_CONNECTION_CHANGED',
    ].includes(code)
  )
    return direct
      ? 'O pedido, cadastro ou configuração mudou. Atualize a situação antes de gerar.'
      : 'O pedido, cadastro ou configuração mudou. Confira uma nova prévia.';
  if (code === 'ORDER_CANCELLED')
    return 'Este pedido foi cancelado. A geração Olist está bloqueada.';
  if (
    ['OLIST_NOT_CONFIGURED', 'OLIST_RECONNECT_REQUIRED', 'OLIST_AUTH'].includes(
      code,
    )
  )
    return 'A conexão Olist precisa ser conferida por um administrador.';
  if (status === 404)
    return 'Pedido não encontrado. Confira seu identificador.';
  if (status === 429)
    return 'Limite de consultas atingido. Aguarde antes de conferir novamente.';
  if (code === 'OLIST_EXPORT_CONFLICT')
    return 'Já existe uma operação Olist em acompanhamento ou aguardando conferência para este pedido.';
  if (status === 409)
    return 'A preparação mudou ou exige conferência administrativa. Atualize os dados.';
  return direct
    ? 'Não foi possível consultar o Olist agora. Tente atualizar a situação.'
    : 'Não foi possível conferir o Olist agora. Atualize a preparação antes de continuar.';
}
/** @param {string|undefined} action */
export function registrationAction(action) {
  const labels = /** @type {Record<string,string>} */ ({
    create: 'criação prevista, ainda não executada',
    reuse: 'cadastro existente conferido',
    blocked: 'conferência pendente',
  });
  return labels[action ?? 'blocked'] ?? 'conferência pendente';
}

const BUYER_FIELD_LABELS = /** @type {Record<string, string>} */ ({
  'buyer.registration.personType':
    'Cadastro do comprador: tipo de pessoa (física ou jurídica).',
  'buyer.registration.document': 'Cadastro do comprador: CPF ou CNPJ.',
  'buyer.registration.cpfCnpj': 'Cadastro do comprador: CPF ou CNPJ.',
  'buyer.registration.legalName':
    'Cadastro do comprador: nome completo ou razão social.',
  'buyer.registration.stateRegistration':
    'Cadastro do comprador: inscrição estadual (obrigatória para pessoa jurídica; use ISENTO apenas quando declarado).',
  'buyer.registration.postalCode': 'Cadastro do comprador: CEP.',
  'buyer.registration.street': 'Cadastro do comprador: endereço (logradouro).',
  'buyer.registration.number': 'Cadastro do comprador: número do endereço.',
  'buyer.registration.district': 'Cadastro do comprador: bairro.',
  'buyer.registration.city': 'Cadastro do comprador: cidade.',
  'buyer.registration.state': 'Cadastro do comprador: UF.',
  'buyer.registration.complement': 'Cadastro do comprador: complemento válido.',
  'buyer.registration.instagram': 'Cadastro do comprador: Instagram válido.',
  'buyer.phone': 'Cadastro do comprador: telefone válido.',
  'buyer.name': 'Cadastro do comprador: nome do contato.',
  'buyer.email': 'Cadastro do comprador: e-mail válido.',
  'buyer.source': 'Cadastro do comprador: referência de origem inválida.',
  document: 'Cadastro do comprador: CPF ou CNPJ.',
  cpfCnpj: 'Cadastro do comprador: CPF ou CNPJ.',
  legalName: 'Cadastro do comprador: nome completo ou razão social.',
  personType: 'Cadastro do comprador: tipo de pessoa (física ou jurídica).',
  stateRegistration:
    'Cadastro do comprador: inscrição estadual (obrigatória para pessoa jurídica; use ISENTO apenas quando declarado).',
  postalCode: 'Cadastro do comprador: CEP.',
  street: 'Cadastro do comprador: endereço (logradouro).',
  number: 'Cadastro do comprador: número do endereço.',
  district: 'Cadastro do comprador: bairro.',
  city: 'Cadastro do comprador: cidade.',
  state: 'Cadastro do comprador: UF.',
  complement: 'Cadastro do comprador: complemento válido.',
  instagram: 'Cadastro do comprador: Instagram válido.',
  addressStreet: 'Cadastro do comprador: endereço (logradouro).',
  addressNumber: 'Cadastro do comprador: número do endereço.',
  addressDistrict: 'Cadastro do comprador: bairro.',
  addressCity: 'Cadastro do comprador: cidade.',
  addressState: 'Cadastro do comprador: UF.',
});

const ITEM_FIELD_LABELS = /** @type {Record<string, string>} */ ({
  tipo: 'modelo',
  cor: 'cor',
  tipo_servico: 'aplicação',
  gola: 'gola',
  malhas: 'modelo de malha',
  grade: 'tamanhos e quantidades',
});

const GENERIC_SERVER_ISSUE_LABELS = new Set([
  'Pendência para gerar no Olist.',
  'Geração Olist ainda indisponível.',
]);

/** @param {{code:string,field?:string,label?:string}|string} issue @param {any[]} [groups] */
export function olistIssueLabel(issue, groups = []) {
  if (typeof issue === 'string') return issue;
  if (!issue) return '';
  const field = issue.field ?? '';
  const safeGroups = Array.isArray(groups) ? groups : [];
  const groupIndex = safeGroups.findIndex((group) => {
    const id = group?.groupId ?? group?.id;
    return typeof id === 'string' && id.length > 0 && field.includes(id);
  });
  const group = safeGroups[groupIndex];
  const line = group?.lines?.find((/** @type {any} */ entry) => {
    const id = entry?.lineId ?? entry?.id;
    return typeof id === 'string' && id.length > 0 && field.includes(id);
  });
  const ids =
    /^(?:sizePricing|priceBreakdown)\.([0-9a-f-]{36})\.([0-9a-f-]{36})$/iu.exec(
      field,
    );
  const context = group
    ? `Item ${groupIndex + 1}${line ? `, tamanho ${line.size}` : ''}: `
    : ids
      ? `Grupo ${ids[1]}, linha ${ids[2]}: `
      : '';
  const code = String(issue.code ?? '');
  if (code === 'ORDER_NOT_CONFIRMED')
    return 'Disponível após confirmar o pedido.';
  if (code === 'OLIST_CUSTOMER_NOT_FOUND')
    return 'Comprador não localizado no Olist. Confira o nome e o telefone antes de revisar novamente.';
  if (code === 'OLIST_PAYMENT_DUE_REQUIRED')
    return 'Informe o vencimento deste pedido antes de gerar no Olist.';
  if (code === 'OLIST_PRODUCT_FISCAL_REQUIRED')
    return 'Informe NCM, origem e unidade dos produtos antes de gerar no Olist.';
  if (
    /FRACTION|INEXACT/u.test(code) ||
    code === 'OLIST_EXACT_CENT_REQUIRED' ||
    code === 'OLIST_SALE_EXACT_CENT_REQUIRED' ||
    code === 'OLIST_SIZE_PRICE_INEXACT'
  )
    return (
      context +
      'Valor do tamanho não representável no Olist: o subtotal exige fração de centavo por unidade. O pedido continua válido no CRM; a exportação inteira está bloqueada.'
    );
  if (
    code === 'OLIST_FREIGHT_INVALID' ||
    field === 'freight' ||
    field === 'freightCents'
  )
    return 'Frete do pedido inválido para exportação.';
  if (
    code === 'OLIST_TOTAL_MISMATCH' ||
    field === 'amounts.totalCents' ||
    field === 'finalAmountCents'
  )
    return 'Total do pedido diverge da soma das peças e do frete.';
  if (code === 'LEGACY_PRICE_BREAKDOWN_REQUIRED')
    return 'Complemento para o Olist: informe os subtotais negociados por tamanho (sem dividir automaticamente o total histórico).';
  if (code === 'ORDER_SOURCE_STALE')
    return 'Complemento para o Olist: o pedido mudou e exige nova conferência do complemento.';
  if (code === 'STORE_ORDER_COMPLEMENT_REQUIRED')
    return 'Complemento para o Olist: prepare os dados complementares do pedido da loja.';
  if (code === 'STORE_DELIVERY_REQUIRED')
    return 'Complemento para o Olist: informe a previsão de entrega complementar.';
  if (code === 'STORE_APPLICATION_REQUIRED')
    return 'Complemento para o Olist: informe a aplicação complementar do item.';
  if (code === 'STORE_ARTWORK_REQUIRED')
    return 'Pedido da loja: origem da arte precisa de conferência.';
  if (code === 'STORE_ITEM_FIELD_REQUIRED')
    return 'Pedido da loja: há especificações ausentes na ficha original.';
  if (code === 'STORE_BUYER_FIELD_REQUIRED') {
    const key = field.replace(/^registration\./u, '');
    return (
      BUYER_FIELD_LABELS[key] ||
      BUYER_FIELD_LABELS[`buyer.registration.${key}`] ||
      'Cadastro do comprador incompleto no complemento da loja.'
    );
  }
  if (/SUBTOTAL|REVIEW/u.test(code))
    return context + 'Informe e revise o subtotal por tamanho.';
  const buyerLabel =
    BUYER_FIELD_LABELS[field] ||
    BUYER_FIELD_LABELS[`buyer.registration.${field}`] ||
    BUYER_FIELD_LABELS[code];
  if (buyerLabel) return buyerLabel;
  if (/BUYER|CUSTOMER_FISCAL|CUSTOMER_INVALID/u.test(code))
    return 'Cadastro do comprador incompleto ou divergente. Uma pessoa autorizada deve conferir os dados de origem.';
  if (/SETTINGS|PRODUCT_FISCAL/u.test(code))
    return 'Parâmetros comerciais ou fiscais precisam de conferência administrativa.';
  if (/SOURCE|BREAKDOWN/u.test(code))
    return 'A composição de preços ou os dados complementares do pedido precisam de revisão autorizada.';
  if (/RECONNECT|AUTH|CONNECTION/u.test(code))
    return 'A conexão Olist precisa de conferência administrativa.';
  if (/AMBIGUOUS|DIVERGENT|UNCERTAIN|RECONCILIATION/u.test(code))
    return (
      context +
      'Cadastro ou venda exige conferência administrativa; não repita a criação.'
    );
  if (/RATE_LIMIT/u.test(code))
    return 'Limite de consultas atingido. Aguarde antes de conferir novamente.';
  if (/CREATION_DISABLED|NOT_CONFIGURED/u.test(code))
    return 'Integração Olist indisponível.';
  if (/CANCELLED/u.test(code))
    return 'Pedido cancelado: geração Olist bloqueada.';
  const item = /^items\[(\d+)\]\.(\w+)$/u.exec(field);
  if (item) {
    const point = ITEM_FIELD_LABELS[item[2]];
    return point
      ? `Item ${Number(item[1]) + 1}: complete ${point} no pedido.`
      : `Item ${Number(item[1]) + 1}: complete as especificações do pedido.`;
  }
  if (field === 'items') return 'O pedido precisa de ao menos um item.';
  if (field === 'artwork') return 'Origem da arte pendente no pedido.';
  if (field === 'paymentCondition')
    return 'Forma de pagamento pendente no pedido.';
  if (field === 'summary.data_entrega_confirmada')
    return 'Previsão de entrega pendente no pedido.';
  if (
    typeof issue.label === 'string' &&
    issue.label.trim() &&
    !GENERIC_SERVER_ISSUE_LABELS.has(issue.label.trim())
  ) {
    return issue.label.trim();
  }
  return (
    context +
    'Os dados do pedido ou do cadastro precisam de conferência antes da exportação.'
  );
}

/**
 * Uma linha por motivo: várias pendências com o mesmo texto não repetem a lista.
 * @param {({code:string,field?:string,label?:string}|string)[]} [issues] @param {any[]} [groups]
 */
export function olistIssueLabels(issues = [], groups = []) {
  return [
    ...new Set(
      issues.map((issue) => olistIssueLabel(issue, groups)).filter(Boolean),
    ),
  ];
}

const BUYER_FIELD_KEYS = new Set([
  'document',
  'legalName',
  'personType',
  'stateRegistration',
  'postalCode',
  'street',
  'number',
  'district',
  'city',
  'state',
  'complement',
  'instagram',
  'addressStreet',
  'addressNumber',
  'addressDistrict',
  'addressCity',
  'addressState',
  'phone',
  'name',
  'email',
]);

/**
 * Orienta quem tem autoridade para corrigir as pendências listadas no bloco Olist,
 * sem conceder permissão extra (OLC-02, OLC-13, OLC-14).
 * @param {{isStore?:boolean,hasSizePricing?:boolean,issues?:{code?:string,field?:string}[]}} [input]
 */
export function olistIssueCorrectionHint(input = {}) {
  const issues = Array.isArray(input.issues) ? input.issues : [];
  if (input.isStore)
    return 'Quem pode corrigir: um administrador deve completar o cadastro do comprador e os dados complementares em Complemento para o Olist.';
  /** @param {{code?:string,field?:string}} entry */
  const isBuyerEntry = (entry) => {
    const field = String(entry?.field ?? '');
    const code = String(entry?.code ?? '');
    return (
      field.startsWith('buyer.') ||
      field.startsWith('registration.') ||
      /BUYER|CUSTOMER/u.test(code) ||
      BUYER_FIELD_KEYS.has(code) ||
      BUYER_FIELD_KEYS.has(field)
    );
  };
  /** @param {{code?:string,field?:string}} entry */
  const isSettingsEntry = (entry) => {
    const field = String(entry?.field ?? '');
    const code = String(entry?.code ?? '');
    return (
      field.startsWith('settings.') ||
      field === 'connection' ||
      /SETTINGS|PRODUCT_FISCAL|CREATION_DISABLED|NOT_CONFIGURED|RECONNECT|AUTH/u.test(
        code,
      )
    );
  };
  const hasBuyer = issues.some(isBuyerEntry);
  const hasSettings = issues.some(isSettingsEntry);
  const hasOrder = issues.some(
    (entry) => !isBuyerEntry(entry) && !isSettingsEntry(entry),
  );
  if (hasBuyer && hasOrder)
    return 'Quem pode corrigir: o vendedor responsável pela conversa (ou um administrador) deve completar o cadastro do comprador no Inbox e revisar a composição do pedido antes de gerar no Olist.';
  if (hasBuyer)
    return 'Quem pode corrigir: o vendedor responsável pela conversa (ou um administrador) deve completar o cadastro obrigatório do comprador no Inbox antes de gerar no Olist.';
  if (hasOrder && input.hasSizePricing === false)
    return 'Quem pode corrigir: o vendedor responsável pelo pedido (ou um administrador) deve completar os subtotais em Complemento para o Olist.';
  if (hasOrder)
    return 'Quem pode corrigir: o vendedor responsável pelo pedido (ou um administrador) deve revisar os itens e valores do pedido.';
  if (hasSettings)
    return 'Quem pode corrigir: um administrador deve conferir os parâmetros comerciais da integração Olist.';
  return 'Quem pode corrigir: o vendedor responsável pelo pedido ou um administrador deve completar os dados pendentes antes de gerar no Olist.';
}

/**
 * Motivo seguro e fixo para o código público da operação ou da tentativa.
 * Código desconhecido nunca vira texto livre.
 * @param {unknown} code @param {string} [state]
 */
export function olistOperationReason(code, state = '') {
  const value = String(code ?? '');
  const known = /** @type {Record<string,string>} */ ({
    OLIST_RESOURCE_OUTCOME_UNKNOWN:
      'O resultado do cadastro não pôde ser confirmado e ele pode existir no Olist.',
    OLIST_SALE_UNCERTAIN:
      'O resultado da venda não pôde ser confirmado e ela pode existir no Olist.',
    OLIST_SALE_RECONCILIATION_REQUIRED:
      'A venda exige conferência administrativa antes de qualquer outra ação.',
    OLIST_RESOURCE_RECONCILIATION_REQUIRED:
      'O cadastro exige conferência administrativa antes de qualquer outra ação.',
    OLIST_RECONCILIATION_REQUIRED:
      'A operação exige conferência administrativa antes de qualquer outra ação.',
    OLIST_AMBIGUOUS_MATCH:
      'Mais de um cadastro corresponde aos dados; nenhum foi escolhido automaticamente.',
    OLIST_INCOMPLETE_LOOKUP:
      'A consulta ao Olist ficou incompleta e não prova a ausência do cadastro.',
    OLIST_SALE_DIVERGENT:
      'A venda encontrada diverge do pedido e não foi aceita.',
    OLIST_RESOURCE_DIVERGENT:
      'Um cadastro encontrado diverge do pedido e não foi aceito.',
    OLIST_CUSTOMER_DIVERGENT:
      'O cadastro do comprador no Olist diverge dos dados do pedido.',
    OLIST_PRODUCT_DIVERGENT: 'O produto no Olist diverge dos dados do pedido.',
    OLIST_PRODUCT_FISCAL_DIVERGENT:
      'Os dados fiscais do produto no Olist divergem dos parâmetros conferidos.',
    OLIST_VARIATION_DIVERGENT:
      'A variação no Olist diverge do tamanho do pedido.',
    OLIST_SALE_READBACK_MISMATCH:
      'A venda lida depois do envio não confere com o pedido.',
    OLIST_SALE_REQUEST_CHANGED:
      'O pedido mudou depois da solicitação congelada da venda.',
    OLIST_SALE_REFERENCE_CONFLICT:
      'A referência da venda pertence a outro registro.',
    OLIST_UPSTREAM_REJECTED: 'O Olist recusou a solicitação desta etapa.',
    OLIST_UNAVAILABLE: 'O Olist estava indisponível nesta etapa.',
    OLIST_RATE_LIMITED: 'O limite de consultas do Olist foi atingido.',
    OLIST_AUTH: 'A conexão Olist precisa ser conferida por um administrador.',
    OLIST_RECONNECT_REQUIRED:
      'A conexão Olist precisa ser refeita por um administrador.',
    OLIST_NOT_CONFIGURED:
      'A integração Olist não está configurada para esta operação.',
    OLIST_ACCOUNT_MISMATCH:
      'A conta conectada não corresponde à conta da operação.',
    OLIST_CONNECTION_CHANGED: 'A conexão Olist mudou durante a operação.',
    OLIST_INVALID_RESPONSE: 'O Olist devolveu uma resposta inválida.',
    OLIST_CREATION_DISABLED: 'A geração de vendas está desativada.',
    ORDER_CANCELLED: 'O pedido foi cancelado antes da etapa de venda.',
    ORDER_NOT_CONFIRMED:
      'O pedido não estava confirmado antes da etapa de venda.',
    OLIST_CUSTOMER_INVALID:
      'O cadastro do comprador estava incompleto ou inválido para gerar no Olist.',
    OLIST_SALE_PLAN_INVALID:
      'Os dados comerciais do pedido mudaram ou ficaram inválidos antes do envio.',
    OLIST_SALE_EXACT_CENT_REQUIRED:
      'Valor do tamanho não representável no Olist sem fração de centavo.',
    OLIST_FRACTIONAL_CENT_UNIT:
      'Valor do tamanho não representável no Olist sem fração de centavo.',
    OLIST_FREIGHT_INVALID:
      'O valor do frete do pedido estava inválido para envio ao Olist.',
    OLIST_TOTAL_MISMATCH:
      'O total do pedido divergiu da soma das peças e do frete.',
    OLIST_SALE_ALREADY_EXISTS:
      'Já pode existir uma venda equivalente no Olist; exige conferência administrativa.',
    OLIST_PERSISTENCE_FAILED:
      'Falha ao persistir o retorno desta etapa; exige conferência administrativa.',
    OLIST_RESOURCE_PERSISTENCE_FAILED:
      'Falha ao persistir o retorno do cadastro; exige conferência administrativa.',
    OLIST_DISPATCH_DISABLED:
      'O envio automático ao Olist está desativado no servidor.',
    OLIST_DISPATCH_FAILED:
      'Não foi possível concluir o envio desta etapa no Olist.',
    OLIST_JOB_INVALID: 'A tarefa de envio do pedido estava inválida.',
    OLIST_JOB_LEASE_LOST:
      'A execução da etapa perdeu a reserva antes de concluir.',
    OLIST_RESOURCE_UNCERTAIN:
      'O resultado do cadastro não pôde ser confirmado e ele pode existir no Olist.',
    OLIST_EXPORT_INVALIDATED:
      'Invalidada por uma pessoa administradora antes de qualquer venda.',
    OLIST_EXPORT_RESUMED:
      'Etapa interrompida sem efeito no Olist; a geração foi retomada em uma nova operação.',
  });
  if (known[value]) return known[value];
  if (state === 'rejected')
    return 'A etapa foi recusada. O detalhe do provedor não é exibido.';
  if (state === 'invalidated')
    return 'A operação foi invalidada antes de concluir.';
  if (
    /UNCERTAIN|UNKNOWN|RECONCILIATION|DIVERGENT|AMBIGUOUS/u.test(value) ||
    ['uncertain', 'outcome_unknown', 'divergent'].includes(state)
  )
    return 'O resultado desta etapa não pôde ser provado e exige conferência administrativa.';
  return '';
}

/**
 * Falha de uma ação administrativa de recuperação (conferir, vincular,
 * invalidar). Mensagem fixa em português; o corpo do provedor nunca é exibido.
 * @param {any} cause @param {'reconcile'|'preview'|'link'|'invalidate'|'read'|'load'} [action]
 */
export function olistRecoveryFailure(cause, action = 'load') {
  const status = Number(cause?.status);
  const code = String(cause?.code ?? '');
  if ([401, 403].includes(status))
    return 'Seu acesso mudou ou sua sessão expirou. Entre novamente com uma conta de administrador.';
  // Sem resposta ou 5xx: o comando pode ter sido gravado. A tela relê o
  // diagnóstico e diz isso, sem oferecer nada que crie.
  if ((status === 0 || status >= 500) && action === 'link')
    return 'O resultado do vínculo é incerto e pode ter sido gravado. O diagnóstico foi atualizado: confira o progresso antes de tentar de novo.';
  if ((status === 0 || status >= 500) && action === 'reconcile')
    return 'O resultado da solicitação é incerto e pode ter sido registrado. O diagnóstico foi atualizado: confira Conferências solicitadas antes de tentar de novo.';
  // Invalidar é um comando local e idempotente: nada é lido nem escrito no
  // Olist, e reenviar com a mesma chave é seguro.
  if ((status === 0 || status >= 500) && action === 'invalidate')
    return 'Não foi possível confirmar a invalidação: ela pode não ter sido registrada. O diagnóstico foi atualizado. Se a geração continuar ativa, envie de novo; o reenvio não duplica o registro.';
  if (action === 'invalidate') {
    if (code === 'OLIST_INVALIDATION_BLOCKED')
      return 'Esta geração não pode ser invalidada: ela já passou da preparação ou teve uma tentativa de venda. Nada foi alterado. Use Conferir no Olist para esclarecer a venda.';
    if (code === 'OLIST_EXPORT_IN_FLIGHT')
      return 'A geração está em execução agora. Aguarde alguns instantes, atualize o diagnóstico e tente invalidar de novo. Nada foi alterado.';
    if (code === 'OLIST_RESOURCE_RECONCILIATION_REQUIRED')
      return 'Há um cadastro ainda sem resultado confirmado. Use Conferir no Olist nesse cadastro; quando ele ficar confirmado, a geração poderá ser invalidada. Nada foi alterado.';
    if (code === 'OLIST_EXPORT_UNAVAILABLE')
      return 'Esta geração não está mais disponível. Atualize o diagnóstico antes de continuar.';
  }
  if (status === 429 || code === 'OLIST_RATE_LIMITED')
    return 'Limite de consultas atingido. Aguarde um momento antes de tentar de novo.';
  if (code === 'VERSION_CONFLICT')
    return 'O estado da etapa mudou desde o diagnóstico. Atualize o diagnóstico e confira novamente.';
  if (code === 'OLIST_RECONCILIATION_REQUIRED')
    return 'Esta operação já tem venda ou cadastro reservado ou incerto, então o vínculo manual não é permitido. Use Conferir no Olist.';
  if (code === 'OLIST_EXPORT_UNAVAILABLE')
    return 'Não há operação Olist neste pedido para conferir.';
  if (code === 'OLIST_PREVIEW_EXPIRED')
    return 'A conferência expirou. Confira a venda novamente.';
  if (
    [
      'OLIST_PREVIEW_STALE',
      'OLIST_PREVIEW_INVALID',
      'OLIST_CONNECTION_CHANGED',
      'OLIST_SALE_REQUEST_CHANGED',
    ].includes(code)
  )
    return 'O pedido, o cadastro ou a configuração mudou desde a conferência. Confira a venda novamente.';
  if (
    [
      'OLIST_SALE_REFERENCE_CONFLICT',
      'OLIST_EXPORT_CONFLICT',
      'OLIST_SALE_DIVERGENT',
      'OLIST_SALE_READBACK_MISMATCH',
      'OLIST_CUSTOMER_DIVERGENT',
      'OLIST_PRODUCT_DIVERGENT',
      'OLIST_PRODUCT_FISCAL_DIVERGENT',
      'OLIST_VARIATION_DIVERGENT',
      'OLIST_RESOURCE_DIVERGENT',
    ].includes(code)
  )
    return 'A venda encontrada não corresponde a este pedido, ou já está vinculada a outro registro. Nenhum vínculo foi criado.';
  if (['OLIST_INCOMPLETE_LOOKUP', 'OLIST_AMBIGUOUS_MATCH'].includes(code))
    return 'A consulta ao Olist ficou incompleta ou ambígua. Nenhum vínculo foi criado.';
  if (['IDEMPOTENCY_RECORD_PENDING', 'IDEMPOTENCY_KEY_REUSED'].includes(code))
    return 'Esta solicitação já está em processamento. Aguarde e atualize o diagnóstico.';
  if (
    [
      'OLIST_NOT_CONFIGURED',
      'OLIST_RECONNECT_REQUIRED',
      'OLIST_AUTH',
      'OLIST_ACCOUNT_MISMATCH',
    ].includes(code)
  )
    return 'A conexão Olist precisa ser conferida em Conexão da empresa.';
  if (code === 'OLIST_ORDER_INCOMPLETE' || code === 'OLIST_PREVIEW_TOO_LARGE')
    return 'O pedido ainda não está completo para conferir uma venda existente.';
  if (code === 'ORDER_CANCELLED')
    return 'Este pedido foi cancelado. A ação está bloqueada.';
  if (status === 404)
    return action === 'preview'
      ? 'Venda não encontrada no Olist para este pedido. Confira o ID informado.'
      : 'Recurso ou pedido não encontrado. Atualize o diagnóstico.';
  if (status === 422)
    return 'Os dados não permitem esta ação. Confira o pedido e a venda informada.';
  if (
    status === 400 &&
    (action === 'reconcile' || action === 'link' || action === 'invalidate')
  )
    return 'Confira os dados informados. O motivo não pode ter quebra de linha nem caracteres de controle: escreva em uma linha só e tente de novo.';
  if (status === 400) return 'Confira os dados informados e tente novamente.';
  if (status === 409)
    return 'O estado da operação mudou ou exige conferência. Atualize o diagnóstico antes de continuar.';
  return action === 'load'
    ? 'Não foi possível carregar o diagnóstico administrativo agora.'
    : 'Não foi possível concluir agora. Atualize o diagnóstico antes de tentar de novo.';
}
