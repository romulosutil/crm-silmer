# Produto

> Verdade de produto para decisões de design. Requisitos e regras continuam em
> `RULES.md`, `.specs/features/crm-mvp/spec.md` e `CRM-MVP-ESPECIFICACAO.md`;
> contrato visual em `design.md`. Personas e evidências:
> [pesquisa de 15/10/2026](docs/product/pesquisa-ux-sintetica-2026-10-15.md).

## O que é

CRM web para pequenas empresas que vendem por conversa (WhatsApp e chat do
site). Um assistente no n8n atende, coleta os dados do pedido e transfere para
uma pessoa; o CRM é a fonte oficial de conversas, clientes, pedidos e fichas de
produção.

## Para quem

A **Silmer** (uniformes e peças personalizadas) é o piloto. O produto será
**whitelabel**: outras empresas devem se reconhecer nele — marca, nome do
produto, nome do assistente e vocabulário do negócio vêm de configuração, nunca
do código das telas.

| Pessoa | Frequência | Onde | O que precisa |
|---|---|---|---|
| Atendente/vendedora | o dia todo | **celular** (principal) e notebook 1366×768 | fila, conversa e resposta sem rolar; pedido a partir da conversa |
| Dono/gestor | poucas vezes ao dia | celular | saúde do dia, atrasos, equipe e assistente em 30 segundos |
| Produção/PCP | por pedido confirmado | desktop antigo ou tablet | conferir itens, tamanhos e arte sem ambiguidade; imprimir a ficha |
| Empresa avaliando (whitelabel) | uma demo | qualquer | ver a própria marca e entender sem treinamento |

## Mobile-first

Decisão do PO em 15/10/2026: os vendedores usam o celular o tempo todo. Toda
tela é desenhada primeiro para 390×844 e depois ampliada para desktop:

- navegação na barra inferior, ao alcance do polegar (Início, Caixa, Pedidos,
  Clientes, Mais);
- alvos de toque ≥ 44 px, campos de 16 px (sem zoom no iOS), nada que dependa
  de hover;
- uma coluna, listas em cartões (não tabelas com rolagem lateral) e a ação
  principal fixa no rodapé quando a tela é longa;
- safe-area respeitada (`viewport-fit=cover`).

## Modo de superfície

**Operate.** As pessoas estão no meio de uma tarefa. Escaneabilidade,
consistência e o cenário real de uso vencem expressão; a marca aparece em
detalhes precisos (logotipo, cor da ação primária, ícone ativo), não em
decoração.

## Compromissos de marca

- Logotipo oficial da empresa (Silmer: `silmer-web/brand.svg`), nunca texto
  imitando a marca.
- Cor primária da empresa nas ações primárias; tinta da marca no texto.
- Tema **claro** é o padrão e não pode piorar; o escuro é equivalente.
- Uma família tipográfica (Silmer: Poppins).

## O que não pode acontecer

- Mais de uma ação primária por região; laranja (ou a primária da empresa)
  marcando seleção.
- Texto abaixo de 13 px, rótulos em caixa alta, eyebrow acima de título.
- Cor de estado (erro, atenção, sucesso) trocada pela marca de uma empresa.
- Nome da empresa escrito direto num componente.
