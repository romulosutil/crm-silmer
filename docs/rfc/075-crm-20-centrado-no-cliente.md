# RFC 075 — CRM Silmer 2.0 centrado no cliente

Proposta de 24/11/2026, em revisão. Base analisada: `origin/master`
`0c89a1c7`. Origem de produto: proposta CRM Silmer 2.0, versão 1.0.
Rastreabilidade em [C20-01 a C20-13](../../.specs/features/crm-20/spec.md) e
[C20-T00 a C20-T16](../../.specs/features/crm-20/tasks.md).

## Contexto

O Silmer já tem um Contato estável, identidades de canal, Conversas por ciclo,
Assuntos e Pedidos separados. O cadastro oficial e a caixa de entrada já
funcionam com carteiras e permissões distintas. O vínculo entre linhas ainda
depende da correlação da identidade, e o valor comercial do relacionamento
ainda está distribuído entre telas.
[ADR 032](../adr/032-separar-pedido-conversa-e-assunto.md) ·
[ADR 033](../adr/033-telefone-no-cadastro-e-roteamento.md) ·
[ADR 090](../adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md)

## Proposta

Entregar primeiro uma visão de leitura com Pedidos já associados, indicador
de vendas e histórico permitido. Evoluir o ingresso para reutilizar o mesmo
Contato em duas linhas após correlação verificável. Cada atendimento conserva
linha, ciclo, titular, Assuntos e permissões. O PostgreSQL preserva as
invariantes. A API do CRM continua dona das decisões de domínio. O n8n continua
responsável pela orquestração de canal.
[Design técnico](../../.specs/features/crm-20/design.md)

Uma segunda alternativa é manter a associação entre linhas exclusivamente
manual. Ela reduz o risco da ativação inicial e é o caminho de degradação se
a evidência automática for insuficiente. A alternativa de adotar um novo
cadastro central duplicaria a origem de Contatos, carteira, autorização e
Pedidos durante a transição, com custo maior de migração e rollback.

## Decisões a registrar

| ID  | Decisão e proposta                                                                        | Quem fecha                                                   | Bloqueia                          |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------- |
| D01 | Definir provas aceitas por transporte, validade, conflito e reutilização de número.       | Produto, Tech Lead e Privacidade                             | T07 a T14                         |
| D02 | Usar ACL por recurso antes dos agregados e definir a mensagem neutra de simultaneidade.   | Produto e Privacidade, respeitando ADRs 088/095              | T03 para ACL, T13 para aviso      |
| D03 | Aprovar o universo e o rótulo do indicador de vendas e o corte atual da loja.             | Produto e Comercial                                          | T03 a T06                         |
| D04 | Aprovar as duas linhas, lotes, limites, sinal de pausa e critérios de promoção do piloto. | Operação, Tech Lead e Privacidade                            | T11 para ensaio, T12 para escrita |
| D05 | Aprovar os critérios da sugestão de encerramento e priorizar as investigações futuras.    | Produto, Operação e Privacidade quando houver dados pessoais | T15 e priorização de T16          |

Enquanto as decisões estiverem abertas, valem as autorizações e os
comportamentos canônicos. Documentação, baseline e ensaios com dados
sintéticos podem avançar conforme as dependências do plano. Após o aceite de
decisões duráveis, criar ADR vinculado a este RFC e atualizar as fontes
canônicas que ele afetar.

Revisar primeiro o escopo e os rótulos (D02/D03), com impacto observado na
Inbox e nos Pedidos. Depois, revisar evidências e conflitos de identidade
(D01), pré-mortem, critérios de parada e recuperação (D04). Registrar
para cada ponto o cenário escolhido, alternativas descartadas, evidência
e responsável. D05 segue o aprendizado da entrega de leitura. A revisão
percorre os gates antes do merge de implementação e os critérios de
homologação antes de cada ativação.

## Evidência para revisão

- [Especificação e critérios de aceite](../../.specs/features/crm-20/spec.md)
- [Arquitetura e contratos propostos](../../.specs/features/crm-20/design.md)
- [Pré-mortem e condições de parada](../../.specs/features/crm-20/pre-mortem.md)
- [Branches, dependências e ordem de merge](../../.specs/features/crm-20/tasks.md)
- [Prompts e modelos por tarefa](../../.specs/features/crm-20/PROMPTS.md)
- [Matriz de regressão e homologação](../../.specs/features/crm-20/validation.md)
