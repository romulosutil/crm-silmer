# Fluxo de Qualificação — Referência Substituída

> **Status:** substituído em 29/08/2026. Não usar para implementação.  
> **Fonte canônica:** `CAMPOS-FICHA-E-JORNADA-P0-1.md`.

Este arquivo registrava uma hipótese de cinco etapas que aceitava campos “a
definir” como completos. Essa hipótese foi invalidada pelo mapeamento integral
de `ficha_exemplo.xlsx` e pelo fechamento do P0.1.

A jornada aprovada possui:

1. **Backlog — Caixa de Entrada**, fora do Kanban.
2. **Produto**.
3. **Especificação**.
4. **Estampa**.
5. **Logística**.
6. **Fechamento**, incluindo o subfluxo PIX.

Regras que continuam válidas:

- etapa representa completude de dados, não quem atende;
- qualquer atendente autorizado pode retomar do primeiro campo pendente;
- o agente não repete pergunta já respondida;
- abandono preserva estado e histórico;
- preço e prazo confirmado nunca são inventados.

Regras substituídas:

- “não sei” e “a definir” agora geram `pendente` e bloqueiam a passagem quando
  o campo é obrigatório;
- o resumo do briefing não encerra sozinho a qualificação;
- a Ficha, o PIX e as boas-vindas fazem parte do caminho feliz até o pedido.

Consulte `CAMPOS-FICHA-E-JORNADA-P0-1.md` para campos, perguntas, critérios de
passagem, exceções e testes `JRN-01` a `JRN-09`.
