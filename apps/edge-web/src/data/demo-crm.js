/* Dados exclusivamente demonstrativos das telas ainda sem contrato HTTP. */
/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');
/** @param {number} v */
const brl = (v) =>
  v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
/** @param {number} v */
const brlExato = (v) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** @param {string} iso */
const dataBR = (iso) => {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};

const STAGES = [
  ['product', 'Produto'],
  ['specification', 'Especificação'],
  ['print', 'Estampa'],
  ['logistics', 'Logística'],
  ['closing', 'Fechamento'],
];

const deals = [
  {
    id: 'd1',
    stage: 'product',
    label: 'Ateliê Bela Vista',
    client: 'c1',
    context: 'Quantidade estimada: 240',
    responsible: 'Marcos Lima',
    pending: 'Confirmar quantidade por tamanho',
    time: '2h nesta etapa',
    blockerCount: 0,
  },
  {
    id: 'd2',
    stage: 'product',
    label: 'Studio Malu',
    context: 'Quantidade estimada: 80',
    client: 'c2',
    responsible: 'Não atribuído',
    pending: 'Definir responsável',
    time: '1d 4h nesta etapa',
    blockerCount: 1,
  },
  {
    id: 'd3',
    stage: 'product',
    label: 'Escola Pequeno Príncipe',
    context: 'Quantidade estimada: 120',
    client: 'c7',
    responsible: 'Ana Duarte',
    pending: 'Confirmar modelo no catálogo',
    time: '7h nesta etapa',
    blockerCount: 0,
  },
  {
    id: 'd4',
    stage: 'specification',
    label: 'Confecções Rio',
    context: 'Quantidade estimada: 600',
    client: 'c3',
    responsible: 'Ana Duarte',
    pending: 'Aprovar malha e viés de gola',
    time: '5h nesta etapa',
    blockerCount: 0,
  },
  {
    id: 'd5',
    stage: 'specification',
    label: 'Bar do Zeca',
    context: 'Quantidade estimada: 60',
    client: 'c8',
    responsible: 'Marcos Lima',
    pending: 'Grade divergente do total',
    time: '2d nesta etapa',
    blockerCount: 1,
  },
  {
    id: 'd6',
    stage: 'print',
    label: 'Grupo Vitório',
    context: 'Quantidade estimada: 150',
    client: 'c4',
    responsible: 'Ana Duarte',
    pending: 'Aprovar arte e locais de aplicação',
    time: '3h nesta etapa',
    blockerCount: 2,
  },
  {
    id: 'd7',
    stage: 'print',
    label: 'Academia Pulse',
    context: 'Quantidade estimada: 90',
    client: 'c9',
    responsible: 'Ana Duarte',
    pending: 'Receber arquivo da arte',
    time: '1d 2h nesta etapa',
    blockerCount: 0,
  },
  {
    id: 'd8',
    stage: 'logistics',
    label: 'Boutique Anzu',
    context: 'Quantidade estimada: 40',
    client: 'c5',
    responsible: 'Marcos Lima',
    pending: 'Confirmar endereço de entrega',
    time: '1d nesta etapa',
    blockerCount: 0,
  },
  {
    id: 'd9',
    stage: 'closing',
    label: 'Ateliê Nord',
    context: 'Valor final: R$ 22.900',
    client: 'c6',
    responsible: 'Ana Duarte',
    pending: 'Aguardando comprovante do PIX',
    time: '6h nesta etapa',
    blockerCount: 0,
  },
  {
    id: 'd10',
    stage: 'closing',
    label: 'Clínica Vitalis',
    context: 'Valor final: R$ 7.150',
    client: 'c10',
    responsible: 'Marcos Lima',
    pending: 'Conferir comprovante recebido',
    time: '11h nesta etapa',
    blockerCount: 0,
  },
];

const vendas = [
  {
    pedido: '01-CRM',
    cliente: 'Ateliê Bela Vista',
    valor: 12400,
    data: '2026-08-11',
    vendedor: 'Ana Duarte',
    pagamento: 'pagamento_confirmado',
  },
  {
    pedido: '02-CRM',
    cliente: 'Uniformes Alfa',
    valor: 8900,
    data: '2026-08-13',
    vendedor: 'Marcos Lima',
    pagamento: 'pagamento_confirmado',
  },
  {
    pedido: '03-CRM',
    cliente: 'Confecções Rio',
    valor: 31200,
    data: '2026-08-18',
    vendedor: 'Ana Duarte',
    pagamento: 'pagamento_confirmado',
  },
  {
    pedido: '04-CRM',
    cliente: 'Studio Malu',
    valor: 4750,
    data: '2026-08-20',
    vendedor: 'Marcos Lima',
    pagamento: 'pagamento_confirmado',
  },
  {
    pedido: '05-CRM',
    cliente: 'Colégio Novo Rumo',
    valor: 26800,
    data: '2026-08-24',
    vendedor: 'Ana Duarte',
    pagamento: 'pagamento_confirmado',
  },
  {
    pedido: '06-CRM',
    cliente: 'Boutique Anzu',
    valor: 6320,
    data: '2026-08-26',
    vendedor: 'Marcos Lima',
    pagamento: 'aprovado_aguardando_pix',
  },
  {
    pedido: '07-CRM',
    cliente: 'Grupo Vitório',
    valor: 18450,
    data: '2026-08-28',
    vendedor: 'Ana Duarte',
    pagamento: 'pagamento_confirmado',
  },
  {
    pedido: '08-CRM',
    cliente: 'Ateliê Nord',
    valor: 22900,
    data: '2026-09-01',
    vendedor: 'Ana Duarte',
    pagamento: 'pix_enviado',
  },
  {
    pedido: '09-CRM',
    cliente: 'Sindicato Metal',
    valor: 9600,
    data: '2026-09-02',
    vendedor: 'Marcos Lima',
    pagamento: 'pagamento_confirmado',
  },
  {
    pedido: '10-CRM',
    cliente: 'Padaria Trigo Real',
    valor: 3480,
    data: '2026-09-03',
    vendedor: 'Marcos Lima',
    pagamento: 'pagamento_confirmado',
  },
  {
    pedido: '11-CRM',
    cliente: 'Time Falcões FC',
    valor: 14200,
    data: '2026-09-05',
    vendedor: 'Ana Duarte',
    pagamento: 'pagamento_confirmado',
  },
  {
    pedido: '12-CRM',
    cliente: 'Clínica Vitalis',
    valor: 7150,
    data: '2026-09-06',
    vendedor: 'Marcos Lima',
    pagamento: 'comprovante_recebido',
  },
];

const dias = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(2026, 7, 9 + i);
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return {
    iso,
    label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`,
    valor: vendas
      .filter((v) => v.data === iso)
      .reduce((s, v) => s + v.valor, 0),
  };
});

const totalVendido = vendas.reduce((s, v) => s + v.valor, 0);
const porVendedor = ['Ana Duarte', 'Marcos Lima'].map((nome) => {
  const seus = vendas.filter((v) => v.vendedor === nome);
  return {
    nome,
    quantidade: seus.length,
    total: seus.reduce((s, v) => s + v.valor, 0),
  };
});

const canais = [
  { canal: 'WhatsApp oficial', conversas: 26, leads: 17 },
  { canal: 'Instagram Direct', conversas: 9, leads: 6 },
  { canal: 'Site → WhatsApp', conversas: 3, leads: 1 },
];

const perdidos = [
  {
    negocio: 'Confeitaria Doce Ponto',
    etapa: 'Fechamento',
    valor: 9800,
    motivo: 'Preço acima do orçamento do cliente',
  },
  {
    negocio: 'Auto Center Rota 3',
    etapa: 'Logística',
    valor: 5400,
    motivo: 'Prazo não atendia a data do evento',
  },
  {
    negocio: 'Coral Municipal',
    etapa: 'Especificação',
    valor: 4200,
    motivo: 'Cliente sem resposta há 12 dias',
  },
  {
    negocio: 'Loja Verde Água',
    etapa: 'Produto',
    valor: 1900,
    motivo: 'Comprou de outro fornecedor',
  },
];

const pendencias = [
  {
    texto: '2 mensagens na fila de reconciliação',
    detalhe: 'Webhook do Instagram devolveu 500 às 08:12',
    tom: 'error',
    acao: 'Abrir fila',
  },
  {
    texto: '3 comprovantes aguardando conferência',
    detalhe: 'Nenhum pagamento é confirmado automaticamente',
    tom: 'warning',
    acao: 'Conferir',
  },
  {
    texto: '1 Ficha aguardando envio para Rose',
    detalhe: 'Pedido 09-CRM · aprovada às 17:40',
    tom: 'warning',
    acao: 'Enviar Ficha',
  },
  {
    texto: '1 conversa sem responsável',
    detalhe: 'Studio Malu · em atendimento há 1d 4h',
    tom: 'error',
    acao: 'Atribuir',
  },
];

const canaisSaude = [
  {
    canal: 'WhatsApp oficial',
    estado: 'conectado',
    evento: 'último evento há 2 min',
  },
  {
    canal: 'Instagram Direct',
    estado: 'reconectando',
    evento: 'último evento há 41 min',
  },
  {
    canal: 'Vendedor Silmer (n8n)',
    estado: 'conectado',
    evento: 'workflow v14 · 38 execuções hoje',
  },
];

const conversas = [
  {
    id: 'k1',
    nome: 'Marina Alves',
    empresa: 'Ateliê Bela Vista',
    canal: 'WhatsApp',
    identificador: '+55 62 99812-4477',
    estado: 'Convertida em lead',
    tom: 'success',
    responsavel: 'Marcos Lima',
    hora: '09:24',
    naoLidas: 0,
    clienteId: 'c1',
    resumo: 'Confirmo 240 peças, sendo 80 P, 100 M e 60 G.',
    negocio: 'Ateliê Bela Vista · Produto',
    mensagens: [
      {
        de: 'cliente',
        autor: 'Marina Alves',
        hora: '08:58',
        texto:
          'Bom dia! Preciso de camisetas para o time do ateliê, umas 240 peças.',
      },
      {
        de: 'agente',
        autor: 'Vendedor Silmer',
        hora: '08:58',
        texto:
          'Bom dia, Marina! Vou organizar seu pedido para o time. Qual nome devo usar para o cliente e como identificamos este pedido?',
      },
      {
        de: 'cliente',
        autor: 'Marina Alves',
        hora: '09:06',
        texto: 'Cliente Ateliê Bela Vista, pedido "Aniversário 10 anos".',
      },
      {
        de: 'agente',
        autor: 'Vendedor Silmer',
        hora: '09:07',
        texto: 'Registrado. Você quer solicitar um orçamento para esse pedido?',
      },
      {
        de: 'cliente',
        autor: 'Marina Alves',
        hora: '09:24',
        texto: 'Sim! Confirmo 240 peças, sendo 80 P, 100 M e 60 G.',
      },
    ],
    sugestao: null,
    nota: 'Negócio criado em Produto às 09:25 por comando autorizado do Vendedor Silmer. Grade informada aguarda conferência na etapa Especificação.',
  },
  {
    id: 'k2',
    nome: '@studiomalu',
    empresa: 'Studio Malu',
    canal: 'Instagram',
    identificador: '@studiomalu',
    estado: 'Em atendimento',
    tom: 'info',
    responsavel: 'Não atribuído',
    hora: '09:02',
    naoLidas: 2,
    clienteId: 'c2',
    resumo: 'Vocês fazem cropped em suplex? Queria 80 peças estampadas.',
    negocio: 'Studio Malu · Produto',
    mensagens: [
      {
        de: 'cliente',
        autor: '@studiomalu',
        hora: '08:41',
        texto: 'Oi! Vocês fazem cropped em suplex?',
      },
      {
        de: 'agente',
        autor: 'Vendedor Silmer',
        hora: '08:41',
        texto:
          'Fazemos, sim. Para eu registrar corretamente: quantas peças e qual modelo você imagina?',
      },
      {
        de: 'cliente',
        autor: '@studiomalu',
        hora: '09:02',
        texto: 'Umas 80 peças estampadas. Quanto sai cada uma? Preciso hoje.',
      },
    ],
    sugestao: {
      titulo: 'Transferir para uma pessoa',
      motivo:
        'O cliente insistiu em preço antes de concluir a qualificação. O agente não informa valor sem orçamento aprovado.',
      acao: 'Assumir atendimento',
    },
    nota: 'Conversa sem responsável há 1d 4h. O negócio existe no Kanban, mas segue bloqueado em Produto até haver responsável.',
  },
  {
    id: 'k3',
    nome: 'Renata Pontes',
    empresa: 'Colégio Novo Rumo',
    canal: 'WhatsApp',
    identificador: '+55 62 98330-1102',
    estado: 'Nova',
    tom: 'warning',
    responsavel: 'Não atribuído',
    hora: '10:11',
    naoLidas: 1,
    clienteId: 'c11',
    resumo: 'Preciso repetir o pedido dos uniformes do ano passado.',
    negocio: null,
    mensagens: [
      {
        de: 'cliente',
        autor: 'Renata Pontes',
        hora: '10:11',
        texto:
          'Oi! Preciso repetir o pedido dos uniformes do ano passado, mesma malha e cores.',
      },
    ],
    sugestao: {
      titulo: 'Transformar em lead',
      motivo:
        'Intenção comercial identificada e contato já vinculado ao pedido 05-CRM. Um novo negócio seria criado em Produto.',
      acao: 'Transformar em lead',
    },
    nota: 'Contato recorrente: 1 pedido concluído. O histórico de relacionamento é preservado e um novo negócio é criado sem duplicar o contato.',
  },
  {
    id: 'k4',
    nome: 'Igor Salles',
    empresa: 'Grupo Vitório',
    canal: 'WhatsApp',
    identificador: '+55 11 97744-6620',
    estado: 'Requer atenção',
    tom: 'error',
    responsavel: 'Ana Duarte',
    hora: 'ontem',
    naoLidas: 0,
    clienteId: 'c4',
    resumo: 'Enviei a arte em PDF, chegou?',
    negocio: 'Grupo Vitório · Estampa',
    mensagens: [
      {
        de: 'cliente',
        autor: 'Igor Salles',
        hora: '17:22',
        texto: 'Enviei a arte em PDF, chegou?',
      },
      {
        de: 'agente',
        autor: 'Vendedor Silmer',
        hora: '17:22',
        texto:
          'Recebi o arquivo e associei ao item camiseta. Vou confirmar os locais de aplicação com o time.',
      },
      {
        de: 'humano',
        autor: 'Ana Duarte',
        hora: '17:40',
        texto:
          'Igor, a arte chegou em baixa resolução para a frente. Consegue enviar em 300dpi?',
      },
    ],
    sugestao: null,
    nota: 'Falha de envio no canal às 17:41: a janela de atendimento de 24h expirou. A mensagem está na fila de reconciliação e pode ser reenviada por template.',
  },
  {
    id: 'k5',
    nome: 'Padaria Trigo Real',
    empresa: 'Padaria Trigo Real',
    canal: 'WhatsApp',
    identificador: '+55 62 99120-8845',
    estado: 'Em análise',
    tom: 'info',
    responsavel: 'Marcos Lima',
    hora: 'ontem',
    naoLidas: 0,
    clienteId: 'c12',
    resumo: 'Queria saber se vocês bordam logo em avental.',
    negocio: null,
    mensagens: [
      {
        de: 'cliente',
        autor: 'Padaria Trigo Real',
        hora: '14:03',
        texto: 'Queria saber se vocês bordam logo em avental.',
      },
      {
        de: 'agente',
        autor: 'Vendedor Silmer',
        hora: '14:03',
        texto:
          'Bordamos, sim. É para uso da equipe da padaria? Quantas peças você imagina?',
      },
      {
        de: 'cliente',
        autor: 'Padaria Trigo Real',
        hora: '14:35',
        texto: 'Ainda não sei, vou conversar com o meu sócio.',
      },
    ],
    sugestao: null,
    nota: 'Resposta "ainda não sei" registrada como pendente. O agente segue coletando outros dados, sem criar negócio até haver intenção confirmada.',
  },
  {
    id: 'k6',
    nome: '@academiapulse',
    empresa: 'Academia Pulse',
    canal: 'Instagram',
    identificador: '@academiapulse',
    estado: 'Em atendimento',
    tom: 'info',
    responsavel: 'Ana Duarte',
    hora: 'ontem',
    naoLidas: 0,
    clienteId: 'c9',
    resumo: 'Mandei o arquivo pelo WhatsApp também, pode ser?',
    negocio: 'Academia Pulse · Estampa',
    mensagens: [
      {
        de: 'cliente',
        autor: '@academiapulse',
        hora: '11:18',
        texto: 'Mandei o arquivo pelo WhatsApp também, pode ser?',
      },
      {
        de: 'humano',
        autor: 'Ana Duarte',
        hora: '11:26',
        texto:
          'Pode! Vinculei os dois contatos ao mesmo pedido, então nada se perde.',
      },
    ],
    sugestao: null,
    nota: 'Identidades de Instagram e WhatsApp vinculadas por decisão humana auditável em 06/09. O mesmo negócio continua ativo nos dois canais.',
  },
  {
    id: 'k7',
    nome: 'Débora Cruz',
    empresa: null,
    canal: 'WhatsApp',
    identificador: '+55 62 99001-7731',
    estado: 'Encerrada sem lead',
    tom: 'default',
    responsavel: 'Marcos Lima',
    hora: '04/09',
    naoLidas: 0,
    clienteId: null,
    resumo: 'Era engano, desculpe!',
    negocio: null,
    mensagens: [
      {
        de: 'cliente',
        autor: 'Débora Cruz',
        hora: '09:12',
        texto: 'Vocês fazem entrega de bolo?',
      },
      {
        de: 'agente',
        autor: 'Vendedor Silmer',
        hora: '09:12',
        texto:
          'Aqui é a Silmer, de vestuário personalizado. Posso ajudar com uniformes ou peças estampadas?',
      },
      {
        de: 'cliente',
        autor: 'Débora Cruz',
        hora: '09:20',
        texto: 'Era engano, desculpe!',
      },
    ],
    sugestao: null,
    nota: 'Encerrada como Sem lead em 04/09 por Marcos Lima. Nunca é tratada como negócio perdido e o histórico foi preservado.',
  },
];

const clientes = [
  {
    id: 'c1',
    nome: 'Ateliê Bela Vista',
    contato: 'Marina Alves',
    canal: 'WhatsApp',
    identificador: '+55 62 99812-4477',
    cidade: 'Goiânia, GO',
    perfil: 'Uso próprio',
    responsavel: 'Marcos Lima',
    desde: '03/2025',
    pedidos: 3,
    total: 38400,
    ultimo: '2026-08-11',
    abertos: 1,
    historico: [
      {
        tipo: 'negocio',
        titulo: 'Ateliê Bela Vista · aberto em Produto',
        quando: '07/09/2026',
        detalhe: '240 peças estimadas · responsável Marcos Lima',
      },
      {
        tipo: 'pedido',
        titulo: 'Pedido 01-CRM · Ficha enviada para Rose',
        quando: '11/08/2026',
        detalhe: 'R$ 12.400 · pagamento confirmado · Ana Duarte',
      },
      {
        tipo: 'conversa',
        titulo: 'Conversa retomada no WhatsApp',
        quando: '11/08/2026',
        detalhe: 'Boas-vindas enviadas com número do pedido e data confirmada',
      },
      {
        tipo: 'pedido',
        titulo: 'Pedido 2024-118 (histórico importado)',
        quando: '02/2026',
        detalhe: 'R$ 14.900 · 180 peças · sublimação total',
      },
      {
        tipo: 'pedido',
        titulo: 'Pedido 2024-071 (histórico importado)',
        quando: '09/2025',
        detalhe: 'R$ 11.100 · 140 peças · bordado',
      },
    ],
  },
  {
    id: 'c3',
    nome: 'Confecções Rio',
    contato: 'Paulo Menezes',
    canal: 'WhatsApp',
    identificador: '+55 21 98812-3390',
    cidade: 'Rio de Janeiro, RJ',
    perfil: 'Revenda / atacado',
    responsavel: 'Ana Duarte',
    desde: '11/2024',
    pedidos: 5,
    total: 96300,
    ultimo: '2026-08-18',
    abertos: 1,
    historico: [
      {
        tipo: 'negocio',
        titulo: 'Confecções Rio · aberto em Especificação',
        quando: '07/09/2026',
        detalhe: '600 peças estimadas · aprovar malha e viés de gola',
      },
      {
        tipo: 'pedido',
        titulo: 'Pedido 03-CRM · Ficha enviada para Rose',
        quando: '18/08/2026',
        detalhe: 'R$ 31.200 · pagamento confirmado · Ana Duarte',
      },
      {
        tipo: 'pedido',
        titulo: 'Pedido 2024-203 (histórico importado)',
        quando: '05/2026',
        detalhe: 'R$ 28.400 · 520 peças',
      },
      {
        tipo: 'conversa',
        titulo: 'Handoff para Ana Duarte',
        quando: '04/2026',
        detalhe: 'Cliente pediu condição especial de atacado',
      },
    ],
  },
  {
    id: 'c2',
    nome: 'Studio Malu',
    contato: 'Malu Ferraz',
    canal: 'Instagram',
    identificador: '@studiomalu',
    cidade: 'Anápolis, GO',
    perfil: 'Revenda / atacado',
    responsavel: 'Não atribuído',
    desde: '08/2026',
    pedidos: 1,
    total: 4750,
    ultimo: '2026-08-20',
    abertos: 1,
    historico: [
      {
        tipo: 'negocio',
        titulo: 'Studio Malu · aberto em Produto',
        quando: '06/09/2026',
        detalhe: '1 bloqueio: definir responsável',
      },
      {
        tipo: 'pedido',
        titulo: 'Pedido 04-CRM · Ficha enviada para Rose',
        quando: '20/08/2026',
        detalhe: 'R$ 4.750 · pagamento confirmado · Marcos Lima',
      },
    ],
  },
  {
    id: 'c4',
    nome: 'Grupo Vitório',
    contato: 'Igor Salles',
    canal: 'WhatsApp',
    identificador: '+55 11 97744-6620',
    cidade: 'São Paulo, SP',
    perfil: 'Uso próprio',
    responsavel: 'Ana Duarte',
    desde: '02/2026',
    pedidos: 2,
    total: 33350,
    ultimo: '2026-08-28',
    abertos: 1,
    historico: [
      {
        tipo: 'negocio',
        titulo: 'Grupo Vitório · aberto em Estampa',
        quando: '07/09/2026',
        detalhe: '2 bloqueios: arte em baixa resolução e locais de aplicação',
      },
      {
        tipo: 'conversa',
        titulo: 'Falha de envio no canal',
        quando: '06/09/2026',
        detalhe: 'Janela de 24h expirada · mensagem na fila de reconciliação',
      },
      {
        tipo: 'pedido',
        titulo: 'Pedido 07-CRM · Ficha enviada para Rose',
        quando: '28/08/2026',
        detalhe: 'R$ 18.450 · pagamento confirmado · Ana Duarte',
      },
    ],
  },
  {
    id: 'c6',
    nome: 'Ateliê Nord',
    contato: 'Célia Nord',
    canal: 'WhatsApp',
    identificador: '+55 62 99640-2218',
    cidade: 'Goiânia, GO',
    perfil: 'Uso próprio',
    responsavel: 'Ana Duarte',
    desde: '06/2026',
    pedidos: 1,
    total: 22900,
    ultimo: '2026-09-01',
    abertos: 1,
    historico: [
      {
        tipo: 'negocio',
        titulo: 'Ateliê Nord · em Fechamento',
        quando: '07/09/2026',
        detalhe: 'Aprovado aguardando PIX · chave enviada em 01/09',
      },
      {
        tipo: 'pedido',
        titulo: 'Pedido 08-CRM reservado',
        quando: '01/09/2026',
        detalhe:
          'R$ 22.900 · Ficha será gerada após confirmação humana do pagamento',
      },
    ],
  },
  {
    id: 'c5',
    nome: 'Boutique Anzu',
    contato: 'Rafaela Anzu',
    canal: 'Instagram',
    identificador: '@boutiqueanzu',
    cidade: 'Brasília, DF',
    perfil: 'Revenda / atacado',
    responsavel: 'Marcos Lima',
    desde: '07/2026',
    pedidos: 1,
    total: 6320,
    ultimo: '2026-08-26',
    abertos: 1,
    historico: [
      {
        tipo: 'negocio',
        titulo: 'Boutique Anzu · em Logística',
        quando: '07/09/2026',
        detalhe: 'Confirmar endereço de entrega',
      },
      {
        tipo: 'pedido',
        titulo: 'Pedido 06-CRM · aprovado aguardando PIX',
        quando: '26/08/2026',
        detalhe: 'R$ 6.320 · entra no valor vendido uma única vez',
      },
    ],
  },
  {
    id: 'c10',
    nome: 'Clínica Vitalis',
    contato: 'Dr. Enzo Prado',
    canal: 'WhatsApp',
    identificador: '+55 62 98221-4409',
    cidade: 'Goiânia, GO',
    perfil: 'Uso próprio',
    responsavel: 'Marcos Lima',
    desde: '09/2026',
    pedidos: 1,
    total: 7150,
    ultimo: '2026-09-06',
    abertos: 1,
    historico: [
      {
        tipo: 'negocio',
        titulo: 'Clínica Vitalis · em Fechamento',
        quando: '07/09/2026',
        detalhe: 'Comprovante recebido · tarefa de conferência aberta',
      },
      {
        tipo: 'pedido',
        titulo: 'Pedido 12-CRM reservado',
        quando: '06/09/2026',
        detalhe: 'R$ 7.150 · o CRM não confirma pagamento por imagem recebida',
      },
    ],
  },
  {
    id: 'c11',
    nome: 'Colégio Novo Rumo',
    contato: 'Renata Pontes',
    canal: 'WhatsApp',
    identificador: '+55 62 98330-1102',
    cidade: 'Aparecida de Goiânia, GO',
    perfil: 'Uso próprio',
    responsavel: 'Ana Duarte',
    desde: '05/2026',
    pedidos: 1,
    total: 26800,
    ultimo: '2026-08-24',
    abertos: 0,
    historico: [
      {
        tipo: 'conversa',
        titulo: 'Nova conversa no WhatsApp',
        quando: '07/09/2026',
        detalhe:
          'Sugestão de transformar em lead aguardando confirmação humana',
      },
      {
        tipo: 'pedido',
        titulo: 'Pedido 05-CRM · Ficha enviada para Rose',
        quando: '24/08/2026',
        detalhe: 'R$ 26.800 · 420 peças · pagamento confirmado',
      },
    ],
  },
];

export {
  STAGES,
  deals,
  vendas,
  dias,
  totalVendido,
  porVendedor,
  canais,
  perdidos,
  pendencias,
  canaisSaude,
  conversas,
  clientes,
  brl,
  brlExato,
  dataBR,
};
