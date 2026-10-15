# ADR 036 — Padrões de jornada: próximo passo único, filtros em folha e progresso real

Status: aceita em 15/10/2026 pelo PO (Rômulo), que aprovou o RFC 024 com as
opções recomendadas.

Decisores: PO (Rômulo) e Tech Lead UX.
RFC: [024](../rfc/024-jornadas-com-menos-botoes.md).
Evidência: auditoria de controles de 15/10/2026 (no RFC) e
[pesquisa com usuários sintéticos](../product/pesquisa-ux-sintetica-2026-10-15.md).
Requisitos: PFI-15 a PFI-20, PCX-10 a PCX-14 e PLI-09 a PLI-10 em
[Pedidos MVP](../../.specs/features/pedidos-mvp/spec.md); PNL-01 a PNL-04 em
[CRM MVP](../../.specs/features/crm-mvp/spec.md). Emendas: PFI-01, PFI-06,
PFI-08, PFI-09, PFI-13, PIT-06, PLA-01, PLA-07, TEC-03, ARQ-01, PCX-02,
PCX-05 e PLI-02; PCX-06 a PCX-09 ficam superados.
Tarefas: T121–T133 em [Pedidos MVP](../../.specs/features/pedidos-mvp/tasks.md)
(T131 adiada). Branch de integração: `ux/jornadas`. Issues e PRs: a vincular
quando as fatias forem integradas.
Relacionados: [ADR 035](035-fundacao-visual-whitelabel-mobile-first.md) e
[RFC 022](../rfc/022-fundacao-visual-whitelabel.md) (fundação visual e
mobile-first), [ADR 001](001-adotar-vue-no-frontend.md),
[ADR 015](015-conversa-nao-volta-para-o-bot.md),
[ADR 016](016-itens-com-os-sete-pontos-da-ficha.md),
[ADR 020](020-tecnica-por-item-e-arte-do-pedido.md),
[ADR 031](031-aviso-de-pedido-novo-do-site.md) e
[`design.md`](../../design.md) §16.

## Contexto

O PO relatou "muitos botões e jornada nada intuitiva". A auditoria de
15/10/2026 contou, no celular, 17 controles no pedido aberto (em 3.600 a
4.800 px de tela), 19 na Caixa de Entrada, 16 em Pedidos e 14 na conversa. O
pedido tinha oito seções, quatro "Editar" sem objeto, dois modelos de edição
e a lista do que falta no fim da página; a conversa tinha duas primárias na
mesma região e uma gaveta que repetia "Sem pedido"; a Caixa de Entrada
somava abas, seletor de fila e busca; Pedidos tinha oito chips; o Painel não
dizia o que fazer agora. O ADR 035 já fixou uma ação primária por região, mas
não dizia como uma jornada inteira escolhe a próxima ação nem como esconder
filtros e seções sem esconder estado.

## Decisão

1. **Próximo passo único com progresso real.** Uma tarefa com passos mostra
   "N de total" a partir de pendências reais do domínio (no pedido,
   `missingFields` agrupado em Entrega prometida, Itens e Arte do pedido) e só
   o próximo passo tem botão, com verbo e objeto. O total é fixo e visitar
   uma seção não conta como feito; sem leitura, não há número. A ação final
   só vira primária quando não há pendência; antes disso, se aparece, é
   `aria-disabled` com o motivo.
2. **Orçamento de ações por região.** No máximo uma primária e duas
   secundárias visíveis; o resto vai para "Mais". Rótulos são verbo + objeto.
3. **Ação indisponível continua focável.** `aria-disabled="true"` com o
   motivo ao lado; ativá-la não executa nada.
4. **Filtros em folha.** Listas mostram busca, até três atalhos com contagem e
   o botão "Filtros", que abre uma folha com os grupos; os ativos ficam num
   resumo removível, a contagem do resultado substitui o resumo antigo e os
   links por query string continuam valendo.
5. **Acordeão no celular.** Até 768 px, páginas de seções mostram uma seção
   aberta por vez, com o estado em texto no cabeçalho (exposto a leitor de
   tela) e abertura inicial pelo hash ou pelo primeiro passo pendente; acima
   disso, tudo aberto.
6. **Um só modelo de edição.** Dados editáveis ficam atrás de "Editar" +
   seção ou do diálogo da ação final. No pedido, valor final e forma de
   pagamento passam a ser digitados no diálogo "Gerar o pedido" (pergunta D2,
   aprovada).
7. **Objeto ligado vira link.** O pedido da conversa é um link "Pedido NN-CRM
   · status" no cabeçalho; o resumo vai para Detalhes › Pedido e a gaveta sai.
8. **Estados desenhados.** Erro de leitura nunca vira "0" nem faz a seção
   sumir: mostra "—" com "Tentar novamente".
9. **Vocabulário de tela.** "Arte do pedido" e "Datas do pedido" na tela; a
   ficha impressa, seus templates e hashes não mudam ("Lastro" continua no
   papel).
10. **Destino do login por papel adiado.** A pergunta D3 (o vendedor entrar
    pela Caixa de Entrada em "Minhas") fica sem implementação: PNL-04 e a
    T131 aguardam nova decisão do PO.

Nada disso muda API, contrato de dados, migração ou dependência; Vue 3 e Vue
Router continuam a base (ADR 001).

## Consequências

- `design.md` ganha a §16 "Padrões de jornada"; a §9 é alinhada ao entregue na
  T133.
- As metas de controles na primeira tela (RFC 024) viram teste na T132.
- Testes E2E que procuram "Editar" sem objeto, a gaveta, as abas da Caixa de
  Entrada, o seletor "Fila", os oito chips e o bloco de fechamento sempre
  aberto mudam junto de cada fatia; `aria-disabled` é ativado nos testes por
  foco e Enter.
- O Painel deixa de mostrar "0" para leitura falha; a fila com erro fica
  visível com "—".
- Pedido confirmado e pedido da loja do site não mudam de comportamento
  (LOJ-07, LOJ-34); a autorização continua na API (PAU-01, PCL-06, PCL-10).
- Glossário configurável por empresa, sete pontos e grade, template de
  impressão parametrizado e telas de Clientes e Vendedores continuam fora
  deste ADR.

## Alternativas rejeitadas

- **Assistente em páginas separadas para o pedido.** Viola a regra 4 de
  `RULES.md` (preenchimento progressivo e não linear) e PIT-03, que aceita
  salvar itens incompletos em qualquer ordem.
- **Manter a gaveta do pedido e só reordenar os botões da conversa.** Mantém
  um status disfarçado de botão, a gaveta que repete "Sem pedido" e duas
  primárias na mesma região.
- **Manter abas e seletor de fila, só encurtando os rótulos.** Mantém três
  mecanismos de filtro ao mesmo tempo e a aba cortada no celular.
- **Só mover a checklist do pedido para o topo.** Barato, mas mantém oito
  seções abertas, quatro "Editar" sem objeto e dois modelos de edição.
- **Só corrigir a legenda do período no Painel.** Não responde "o que faço
  agora".
