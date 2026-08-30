# CRM-PROCESSO-VENDAS.md — Processo de Qualificação e Venda (Silmer)

> **ARQUIVADO em 29/08/2026.** O projeto decidiu sair completamente do Datacrazy — este
> documento descrevia o processo rodando dentro dele e não é mais a fonte de verdade. O novo
> processo de vendas é definido a partir da ficha de pedido real (`ficha_exemplo.xlsx`) e passa
> a viver em um documento próprio (ver `CRM-MVP-ESPECIFICACAO.md` na raiz do repo — pendência em
> andamento). Fica aqui só como registro histórico do roteiro de 13 campos e das tags que
> existiram no Datacrazy.

---

Este documento descreve o processo de vendas que roda hoje dentro do CRM Datacrazy: como um
lead é qualificado, quem faz o quê em cada etapa, e o que nunca pode ser afirmado antes da hora.

**Ele serve dois públicos ao mesmo tempo:**

- **Vendedor humano** (atendentes A, B e C) — é o roteiro de referência: o que perguntar,
  em que ordem, e o que fazer quando o lead cai na sua caixa.
- **Agente de IA "Vendedor Silmer"** — é a versão versionada e revisável do processo que hoje
  vive só dentro das instruções do agente no Datacrazy. Divergiu daqui? O Datacrazy é que está
  desatualizado, não este arquivo.

Complementa, não substitui, dois documentos que já existem:

- [`DATACRAZY-SETUP.md`](DATACRAZY-SETUP.md) — a implementação técnica (pipeline, tags, campos,
  automação, conexão WhatsApp). Este arquivo aqui é o "porquê" e o "como agir"; aquele é o "como
  está montado no CRM".
- [`packages/ui/src/lib/business.ts`](packages/ui/src/lib/business.ts) — fonte da verdade de
  telefone, endereço e vendedores. Nunca reescreva um nome ou número aqui; referencie.

---

## 1. Visão geral do fluxo

```
Cliente manda mensagem no WhatsApp (número operacional omitido)
        │
        ▼
Agente IA "Vendedor Silmer" roda o roteiro de qualificação (seção 3)
        │  cria o lead, preenche os 13 campos, aplica as tags (seção 4)
        ▼
Negócio criado na pipeline "Vendas Estamparia" → etapa "Qualificado pela IA"
        │
        ▼
Transferência automática pra um vendedor humano, aleatorizada (seção 6)
        │  vendedor recebe: conversa + comentário com Resumo do Briefing + tarefa Alta
        ▼
Vendedor humano assume — a partir daqui a pipeline anda manualmente (seção 5)
```

## 2. Card rápido de briefing

Quando o lead **não** passa pela IA — DM no Instagram, ligação no fixo, cliente que aparece na
loja — não dá pra rodar o roteiro completo na hora. Use este card mínimo pra não perder a venda
enquanto o negócio não é criado no CRM:

```
Produto: [Tipo de Produto]
Quantidade: [X] peças
Arte/Estampa: [Detalhes da estampa]
Tecido: [Opção escolhida ou 'A definir com o vendedor']
```

Esse card é um resumo de 4 dos 13 campos oficiais. Assim que der, complete os outros 9 no CRM
(seção 3) — um negócio com só o card mínimo não deveria avançar além de "Qualificado" na
pipeline, porque falta informação pra orçar.

| Campo do card    | Campo correspondente no Datacrazy |
|---|---|
| Produto           | Tipo de Peça |
| Quantidade        | Quantidade de Peças |
| Arte/Estampa      | Situação da Arte (+ Técnica de Estampa, se o cliente já falou) |
| Tecido             | Tecido |

## 3. Roteiro completo de qualificação — os 13 campos

Ordem sugerida de conversa: primeiro o que define o produto (1–4), depois a estampa (5–7),
depois logística e intenção (8–11), fechando com o texto livre (12–13).

| # | Campo (Datacrazy) | Pergunta sugerida | O que registrar | Observação |
|---|---|---|---|---|
| 1 | Tipo de Peça | "Pra que tipo de peça é? Camiseta, uniforme, abadá, moletom...?" | O nome que o cliente usar. | Catálogo fechado de peças ainda não veio do cliente — não restrinja a uma lista, anote o termo dele. |
| 2 | Tecido | "Já tem preferência de tecido, ou tanto faz? Malha PV, dry fit, algodão..." | Tecido escolhido, ou "a definir com o vendedor". | Tabela de tecidos já existe na base de conhecimento da IA no Datacrazy — não duplicar aqui, só referenciar se precisar consultar. |
| 3 | Cor da Peça | "E a cor da peça em si (não da estampa)?" | Cor ou "a definir". | — |
| 4 | Grade de Tamanhos | "Tem grade de tamanho definida — P, M, G... — ou é tamanho único?" | Grade informada pelo cliente. | Catálogo de grades por peça ainda TODO(cliente) (ver seção 7). |
| 5 | Quantidade de Peças (número) | "Quantas peças, no total?" | Número puro. | Se vier faixa ("uns 30 a 50"), registre o piso da faixa no campo numérico e a faixa completa por extenso no Resumo do Briefing. |
| 6 | Técnica de Estampa | "Como você imagina a estampa: silk, sublimação, bordado, DTF, vinil?" | Técnica escolhida, ou dúvida do cliente. | Guia completo das 5 técnicas (quando indicar cada uma) já está na base de conhecimento da IA. Silmer se posiciona como "referência em sublimação" — pode citar como sugestão, nunca como obrigação. |
| 7 | Situação da Arte | "Você já tem a arte pronta (arquivo) ou precisa que a Silmer crie?" | Pronta / precisa criar / vai enviar depois. | Dispara a tag **Precisa de Arte** quando a resposta for "precisa criar". Custo e prazo de criação de arte são TODO(cliente) — nunca informar valor aqui. |
| 8 | Locais de Estampa | "Onde vai a estampa — frente, costas, manga, os dois lados?" | Local(is) informado(s). | — |
| 9 | Prazo Desejado | "Pra quando você precisa que fique pronto?" | Data ou prazo que o **cliente** deu. | Isto é o desejo do cliente, não uma promessa da Silmer. Prazo de produção padrão/urgência ainda é TODO(cliente) — nunca confirmar que aquele prazo é viável. |
| 10 | Finalidade do Pedido | "É pra quê — uniforme de empresa, evento, time, revenda, presente?" | Categoria livre. | Ajuda a preencher o Perfil de Compra (campo 11) e a priorizar no funil. |
| 11 | Perfil de Compra | "Isso é pra revenda/atacado ou consumo próprio?" | Atacado ou Varejo. | Pergunte direto — não infira só pela quantidade. Sem quantidade mínima definida pelo cliente (TODO), quantidade alta não implica atacado por si só. Dispara a tag correspondente. |
| 12 | Entrega ou Retirada | "Prefere retirar na loja ou receber?" | Retirada ou entrega + cidade. | Política de entrega (cidades atendidas, frete) é TODO(cliente) — capture a preferência, não prometa prazo nem custo de frete. |
| 13 | Resumo do Briefing | (gerado ao final, não perguntado) | Texto corrido juntando os 12 campos acima. | É o que o vendedor humano lê primeiro ao assumir o lead (seção 6). Sem isso preenchido, o vendedor tem que reler a conversa inteira — trate como obrigatório antes de aplicar a tag **IA - Qualificado**. |

## 4. Tags e tipificação

| Tag | Quando aplicar | Efeito |
|---|---|---|
| `IA - Qualificado` | Roteiro dos 13 campos concluído (ou o máximo possível dentro do limite de 12 interações da IA). | **Gatilho** da automação "Lead Qualificado - Briefing para Vendedor": comenta o Resumo do Briefing no lead e cria a tarefa de prioridade Alta. |
| `Atacado` | Perfil de Compra = atacado/revenda. | Sinaliza pro vendedor tratar com preço e prazo de atacado assim que essa política existir. |
| `Varejo` | Perfil de Compra = consumo próprio. | — |
| `Precisa de Arte` | Situação da Arte = "precisa que a Silmer crie". | Sinaliza que o orçamento também vai incluir criação de arte — hoje sem custo definido (TODO(cliente)). |

## 5. Pipeline "Vendas Estamparia" — as 5 etapas

URL operacional no Datacrazy removida da versão pública.

| Etapa | Entra quando | Quem move | Não avança sem |
|---|---|---|---|
| **Novo Contato (IA)** | Lead manda a primeira mensagem. | Automático (IA assume). | — |
| **Qualificado pela IA** | Roteiro concluído, tag `IA - Qualificado` aplicada. | Automático. | Resumo do Briefing preenchido (campo 13). |
| **Orçamento Enviado** | Vendedor humano respondeu com valores. | Vendedor, manual. | Preço só pode ser dado depois que a política de preços existir (seção 7) — até lá, esta etapa não deveria acontecer de verdade, só simulações internas. |
| **Negociação** | Cliente pediu ajuste — quantidade, prazo, forma de pagamento — depois do orçamento. | Vendedor, manual. | — |
| **Aprovado - Produção** | Cliente confirmou o pedido. | Vendedor, manual. | A partir daqui o acompanhamento é operacional (produção), fora do escopo deste processo de vendas. |

## 6. Transferência da IA pro vendedor humano

- O comportamento nativo "Transferir atendente" está em modo **Aleatorizar** entre os
  atendentes cadastrados no Datacrazy. **Hoje isso é só A e B** — o atendente C já existe
  como vendedor confirmado em `business.ts` (13/08/2026), mas ainda **não foi cadastrado como
  atendente no Datacrazy**, então não entra no rodízio automático até isso ser corrigido. Trate
  como pendência operacional, não como decisão de processo.
- O que o vendedor recebe automaticamente ao assumir um lead qualificado:
  1. A conversa passa para a caixa dele no Multiatendimento.
  2. Um comentário no lead com o Resumo do Briefing.
  3. Uma tarefa "Atender lead qualificado pela IA", prioridade Alta, no nome dele.
- **Regra de ouro pro vendedor:** ler o Resumo do Briefing antes de responder. Repetir uma
  pergunta que a IA já fez é o erro mais comum e o que mais irrita quem já qualificou o próprio
  pedido uma vez.

## 7. O que a IA e o vendedor nunca afirmam

Enquanto os itens abaixo não vierem da Silmer (checklist espelhado do `README.md` e do
`DATACRAZY-SETUP.md`), nenhuma etapa deste processo — nem a IA, nem o vendedor — confirma
valor, prazo ou mínimo. A resposta padrão é sinalizar que alguém do time confirma em seguida.

- [ ] Tabela de preços por técnica e faixa de quantidade
- [ ] Quantidade mínima por técnica
- [ ] Prazo de produção padrão e de urgência
- [ ] Política e custo de criação de arte
- [ ] Formas de pagamento e parcelamento
- [ ] Política de entrega (cidades, frete, prazo)
- [ ] Catálogo de cores e grade de tamanhos por peça

Isso não impede qualificar o lead — os campos 1 a 13 (seção 3) coletam o que o **cliente**
quer, não o que a Silmer promete. A promessa só entra na etapa "Orçamento Enviado" (seção 5),
e só depois que a política correspondente existir.

## 8. Pendências que travam o processo hoje

- [ ] Cadastrar o atendente C no Datacrazy e incluí-lo no rodízio de transferência
      (hoje o rodízio é só A/B — ver seção 6).
- [ ] Conectar o WhatsApp da loja à Crazy API — sem conexão, a IA não roda ponta a ponta
      (detalhe em `DATACRAZY-SETUP.md`, seção "BLOQUEADORES").
- [ ] Preencher o checklist da seção 7 acima com o time da Silmer.

Ao resolver cada pendência, risque aqui e confira se o comportamento descrito nas seções 5–7
já reflete a realidade — este arquivo deve ficar tão atualizado quanto o próprio CRM.
