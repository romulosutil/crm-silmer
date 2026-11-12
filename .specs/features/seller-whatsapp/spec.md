# WhatsApp por vendedor — requisitos propostos

Status: em revisão, não implementado. [RFC 067](../../../docs/rfc/067-whatsapp-por-vendedor-e-meus-clientes.md),
[tarefas](tasks.md). ADR da evolução pendente de decisão; preservar ADRs
050/088, ORC-01–05/07/08, INB-01, MSG-01–04 e PRV-01–03. Escopo só WhatsApp.

## Etapa 1 — configuração pessoal e atendimento corrente

| ID     | Critério proposto                                                                                                                                                                                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WAP-01 | Vendedor ativo conecta sua linha por Meus clientes ou Conta → Meu WhatsApp. Sem vínculo, a aba abre configuração; conectado, abre carteira sem novo QR. Financeiro/inativo não podem parear.                                                                                                                                 |
| WAP-02 | Comando explícito, autenticado, com CSRF, origem, versão, limite de frequência e idempotência inicia/retoma uma tentativa. GET/navegação não cria/reinicia/desconecta sessão; duas abas não criam duas instâncias.                                                                                                           |
| WAP-03 | QR/código temporário acessível somente ao titular atual, sem credencial Evolution, cache, storage, log, telemetria ou execução n8n persistida. Expiração e geração invalidam desafios antigos; UI opera por teclado e preserva foco. Homologar alternativa com código no mesmo celular ou aceitar explicitamente duas telas. |
| WAP-04 | Confirmar pelo provedor o número esperado, conexão e webhook antes de ativar/importar dados. Uma linha ativa por vendedor e um titular por número; corrida tem um vencedor. Número errado/duplicado bloqueia sem revelar outro usuário ou apropriar linha existente.                                                         |
| WAP-05 | Nova conversa pessoal nasce humana e atribuída ao titular na mesma transação, sem aparecer como sem dono na fila geral. Titular inativo bloqueia operação e exige revisão administrativa; parear não liga IA. Esse comportamento depende do aceite D1/ADR.                                                                   |
| WAP-06 | Carteira deriva do vínculo com a linha, incluindo atendimentos encerrados. Conta/número/geração são revalidados em entrada, reserva, envio e callback; nenhuma resposta usa linha geral ou outra linha como fallback.                                                                                                        |
| WAP-07 | Escopo é obrigatório no servidor antes de busca/paginação/contagem, também em Clientes geral, IDs diretos, histórico, mídia, assuntos, contexto, replay e SSE. Outro vendedor não lê dados exclusivos da linha; Admin lê sob capacidade atual. Pedido conserva ACL comercial sem conceder chat oculto.                       |
| WAP-08 | Mesmo cliente em duas linhas mantém vínculos separados, sem fusão automática. Correlação verificável não libera dados/conversas privados de outra linha. Transferência genérica para outro vendedor é negada na etapa 1.                                                                                                     |
| WAP-09 | Registrar novas mensagens de cliente e saídas pelo CRM/aparelho. Saída do aparelho é fato já ocorrido, sem novo envio/bot/pedido ou revisão inbound; indicar origem e autoria da linha sem inventar operador físico. Eco antes/depois do retorno HTTP não duplica nem confunde saída desconhecida com envio CRM.             |
| WAP-10 | Preservar idempotência por conta/ID, epoch, reservas e resultado incerto. Criação, pareamento e logout têm ledger e reconciliação após timeout; callbacks antigos não reativam conexão. Não repetir efeito externo incerto.                                                                                                  |
| WAP-11 | Pessoa consulta estado e reconecta a própria linha sem suporte. Desconexão/revogação mantém carteira e história, bloqueia despachos não iniciados e informa falta de sincronização. Fechar modal para consultas; não desfaz conexão já concluída. Efeito iniciado pode concluir.                                             |
| WAP-12 | Reutilizar monólito/worker/PostgreSQL/Evolution privados e n8n; credenciais no servidor, sem painel Evolution ao vendedor, novo serviço por linha ou workflow manual copiado. Falha fica visível. Ativação depende de gates com duas linhas, capacidade, privacidade, recovery e flags inicialmente desligadas.              |

## Etapa 2 — carteira anterior e continuidade

| ID     | Critério proposto                                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WAP-13 | Importação de clientes/histórico disponível exige prévia, seleção comercial, período/limites aprovados, checkpoint e retomada idempotente. Agenda completa/histórico integral não são presumidos; excluir grupos, broadcasts, status, newsletters e contatos pessoais alheios. |
| WAP-14 | Cadastro sem conversa não vira inbound/pedido. Mensagem importada preserva data e origem e não dispara bot, handoff, recuperação, lembrete ou venda/lead novo. Lacuna/arquivo ausente tem indicação explícita; recontagem histórica exige decisão específica.                  |
| WAP-15 | Troca de número prova a nova identidade e revoga a geração anterior sem mover remetentes antigos. Sucessão entre funcionários exige Admin, motivo, escopo, versão e auditoria; revogar acesso/reservas e atribuir de forma atômica, preservando crédito comercial e histórico. |
| WAP-16 | Rollback bloqueia novas conexões/importações e envios pessoais, preservando ACL, ledger e incertezas. Retomada não cria outra instância, publica carteira nem usa outra linha para contornar falha.                                                                            |

## Matriz mínima de verificação

| Cenário                                                               | Resultado esperado                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A pareia; B força ID/QR/rota, busca geral, contagem ou cursor de A    | Sem QR, clientes exclusivos, mensagens, mídia ou metadados da linha A; Financeiro/inativo também negados. |
| A e B tentam o mesmo número; duas abas de A iniciam conexão           | Um vínculo/tentativa efetivo; conflito seguro e reconciliação, sem roubo ou duplicação.                   |
| QR expira, navegador fecha ou callback antigo chega após revogação    | Renovação explícita/releitura autorizada; acesso perdido não se restaura.                                 |
| Número conectado difere do informado, ou é a linha geral já existente | Ativação bloqueada antes de expor/importar canal; linha existente preservada.                             |
| Mesmo cliente fala com linhas A e B                                   | Cada vendedor vê seu relacionamento; enviar pelo CRM usa a conta de origem.                               |
| Mensagem enviada pelo aplicativo; eco do CRM antes/depois de HTTP     | Uma mensagem por efeito real, autoria/origem corretas; sem novo envio ou bot.                             |
| Mensagem fora de ordem ou lacuna após reconexão                       | Estados monotônicos, sem duplicata; lacuna não é declarada preenchida sem prova.                          |
| Troca de dono, desativação ou disconnect durante reserva/despacho     | Sem novo efeito após fence; efeito iniciado permanece auditado; leitura/SSE revogados.                    |
| n8n/Evolution falha ou criação termina sem resposta                   | Pendência visível, consulta/reconciliação; sem fallback para outra linha ou retry criador.                |
| Importação parcial repetida e sucessão com sessão antiga aberta       | Retomada sem duplicação/disparo retroativo; antigo titular perde acesso sem alterar vendas passadas.      |

Executar negativos também por API, comandos repetidos e sessões abertas. UAT
com duas linhas e cliente sintético valida cada caminho antes de declarar
prontidão; um QR renderizado não comprova atendimento ponta a ponta.
