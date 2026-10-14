# Cliente, Pedido manual e assuntos — requisitos

Decisão: [RFC 019](../../../docs/rfc/019-cliente-pedido-manual-e-assuntos.md) /
[ADR 032](../../../docs/adr/032-separar-pedido-conversa-e-assunto.md).

## Pedido sem canal

- **CP-01:** Vendedor autorizado pode cadastrar Contato com nome, sem criar
  identidade de canal ou Conversa; nomes iguais não são unidos.
- **CP-02:** Pedidos oferece “Novo pedido” com busca paginada por nome,
  seleção por teclado e cadastro de Contato ausente.
- **CP-03:** Criar Pedido para Contato selecionado cria um `pendente` numerado,
  sem Conversa, com vendedor responsável; replay da mesma chave retorna o
  mesmo Pedido, e novo comando cria outro Pedido intencional.
- **CP-04:** Dono do Pedido manual ou administrador pode editar seções,
  arquivos, gerar, reabrir e registrar lastro; outros vendedores leem e só
  imprimem confirmados. A API aplica a regra mesmo sem a interface.
- **CP-05:** Campos comerciais da ficha são editáveis no pendente; número,
  status, cliente e totais obedecem às regras do domínio. Nome do pendente
  acompanha o Contato; o confirmado conserva o snapshot.
- **CP-06:** A lista e a busca de Pedidos incluem os manuais. A criação não
  aciona automação; Pedido da loja continua pago e travado.

## Ciclo de atendimento

- **CP-07:** Dono da Conversa ou administrador pode encerrá-la com motivo
  `concluido` ou `sem_pedido`; o CRM registra autor, hora e auditoria.
- **CP-08:** Confirmar Pedido ou tempo sem mensagem não encerram a Conversa.
  Arquivar continua independente do fechamento.
- **CP-09:** Mensagem válida posterior a ciclo encerrado abre novo ciclo para
  a mesma identidade, preservando histórico e ordens anteriores sem duplicar
  a mensagem.
- **CP-10:** Inbox apresenta estado e ação de encerramento acessíveis por
  teclado, com foco, feedback e confirmação quando houver pendente.

## Assuntos e agente

- **CP-11:** Conversa pode conter vários Assuntos; um Assunto pode apontar a
  Pedido do mesmo Contato ou ser sem Pedido.
- **CP-12:** Mensagem pode ter vínculos com mais de um Assunto e pode ficar
  sem classificação até decisão; atribuição e correção são auditadas.
- **CP-13:** Pedido pode ser retomado em outro ciclo da mesma identidade ou
  de outra identidade do Contato após correlação verificável.
- **CP-14:** A Inbox lista todos os Pedidos e Assuntos da Conversa, com
  indicação do alvo atual; seleção humana tem prioridade sobre sugestão do
  agente.
- **CP-15:** Briefing do agente é isolado por Assunto. Projeção exige
  `subject_id` e `order_id` válidos e inequívocos; nunca escolhe “último
  pendente”.
- **CP-16:** Se a mensagem for ambígua, o agente pergunta a qual Pedido ela
  se refere ou transfere, sem mutar ficha ou condição comercial.
- **CP-17:** Assunto e Pedido alvo são validados com Contato, autorização,
  epoch, revisão, idempotência e auditoria; replays não criam Assunto, Pedido
  ou mensagem duplicados.
- **CP-18:** Até o workflow adotar esse contrato, a via legada mantém um
  pendente por Conversa. A ampliação depende de implantação CRM antes do n8n.
