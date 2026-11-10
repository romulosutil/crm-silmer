# ADR 082 Cadastro obrigatório somente no envio Olist

Data: 10/11/2026. Status: aceita pelo proprietário na correção explícita da
revisão dos prompts. Supersede a
[ADR 081](081-cadastro-do-comprador-opcional-no-olist.md) para novos envios.
Relaciona-se à [RFC 050](../rfc/050-geracao-assistida-de-pedidos-no-olist.md),
[ADR 079](079-olist-a-partir-do-pedido-confirmado.md) e
[OLC-04/07](../../.specs/features/olist-confirmed/spec.md).
Tarefa documental OLIST-PROMPTS-01; correção funcional em OLC-T01–T04.
Sem nova issue/PR de implementação nesta atualização documental.

## Correção do requisito

O proprietário esclareceu: o cadastro é obrigatório para o Olist, mas não para
fechar a ficha de pedido. A mudança do commit `865388f0`, que passou a aceitar
cadastro vazio/parcial no novo envio usando nome e telefone, não atende a essa
regra e precisa de correção. A ADR 081 permanece preservada como histórico.

## Decisão

1. O Pedido pode ser salvo, confirmado e ter sua ficha/PDF gerada sem cadastro
   completo do comprador. Preservar os demais critérios comerciais e de
   impressão atuais; não incorporar pendências Olist a esses comandos.
2. **Gerar no Olist** exige cadastro completo e válido do comprador para a
   integração, além do Pedido confirmado e dos gates OLC existentes. Validar
   os campos do contrato fiscal já definido, sem inventar novas exigências.
3. Cadastro ausente, parcial ou inválido bloqueia somente o novo envio, com
   pendência por campo. Nome/telefone e uma referência ERP existente não são
   atalhos para dispensar o cadastro completo nesse fluxo.
4. Corrigir validação, revalidação/reserva/dispatch e interface, inclusive
   tokens/prévias antigos e jobs anteriores à correção. Não basta esconder o
   botão: a API e o worker não podem criar efeitos com cadastro incompleto.
5. Reutilizar comprador e cadastros existentes quando a identidade for
   comprovada, sem sobrescrevê-los ou mesclar dados parciais. Vínculo histórico
   administrativo e efeitos já iniciados mantêm suas regras de evidência e
   recuperação, sem liberar duplicata ou reescrever registros antigos.

## Entrega e aceite

Esta atualização corrige contrato, tarefas e prompts; não modifica o runtime.
A correção funcional fica explicitamente pendente e prioritária nos blocos
1–4 de [prompts-pedido-confirmado.md](../integrations/olist/prompts-pedido-confirmado.md).

Verificar que cadastro vazio/parcial permite salvar, confirmar e gerar PDF,
mas bloqueia a exportação pela UI/API/worker antes de inclusões. Cadastro
completo válido permite prosseguir pelos gates normais. Duplo clique,
concorrência, revogação e resultado incerto preservam as garantias existentes.
