# ADR 081 — Cadastro do comprador opcional no envio ao Olist

Data: 10/11/2026. Status: adotada como correção emergencial.
Decisor de produto: proprietário, no chat: "Cadastro completo e Olist é opcional
SEMPRE". Decisor técnico: Tech Lead.
Rastreabilidade: OLIST-07–08, OLIST-T15–T17. Complementa a
[ADR 072](072-envio-em-aberto-sem-duplicar-cadastros-do-erp.md) e ajusta, em
`RULES.md`, a expressão "ficha/cadastro completos" do registro de 04/11/2026.
Não é um novo mecanismo, então não houve RFC.

## Decisão

O cadastro completo do cliente no CRM nunca é condição para o Pedido nem para o
envio ao Olist. Só um cadastro completo usa o caminho fiscal. Cadastro vazio ou
parcial segue o caminho `erp-existing-v1`: o comprador é localizado no Olist
pelo nome e telefone normalizados, e o que estiver preenchido no CRM é ignorado,
sem mesclar fontes.

Campos do cadastro não aparecem como pendência ao lado de um bloqueio real. A
prévia só fica elegível com comprador identificado: quando nenhuma outra
pendência existe, os campos continuam na resposta e mantêm a prévia inelegível.

## Consequências

Nenhum dado fiscal do CRM parcial chega ao ERP, e o payload continua restrito ao
ID remoto, ao nome e ao telefone. Comprador sem correspondência única no Olist
continua como pendência do envio, sem criar cliente mínimo. Essa pendência é só
do Olist: o Pedido segue válido no CRM.

O vínculo administrativo de venda histórica mantém a regra anterior, que exige
cadastro vazio ou completo (ADRs 073 e 075).
