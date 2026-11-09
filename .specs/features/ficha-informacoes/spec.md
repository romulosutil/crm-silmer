# Correção de conteúdo da ficha impressa

Autorização do proprietário em 09/11/2026: manter o formato atual e acrescentar
as informações ausentes. Redesign adiado para outra agenda. A ficha é da fábrica:
valores e cobrança ficam fora. Base: PIM-06–12, ADR 017, ADR 025; rótulos
Aplicação/Previsão de entrega já autorizados por OLIST-49/50 e ADR 057.

| ID     | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FIP-01 | Preservar os sete pontos, público, grade e adicionais atuais; imprimir também `modelo` e `vies_gola`, mesmo com `gola` preenchida.                                                                                                                                                                                                                                                                                         |
| FIP-02 | Imprimir observações e instruções complementares reconhecidas do atendimento: notas, modelo informado, personalizações, numeração, patrocinadores, locais da arte, modalidade/endereço/cidade/CEP/retirada e data desejada. Identificar a origem complementar; data desejada não substitui a previsão confirmada. Aceitar somente strings ou arrays de strings; escapar HTML, preservar conteúdo e paginar notas extensas. |
| FIP-04 | Na ficha da loja, imprimir observações existentes, incluindo CEP e orientação para obter os dados de entrega. Preservar Produzir e Cliente.                                                                                                                                                                                                                                                                                |
| FIP-05 | Excluir valor, subtotal por tamanho, condições, cobrança, gateway, comprovante, NSU, dados Olist e data de pagamento. Texto livre com indicação financeira explícita bloqueia a geração para revisão, sem apagar instruções.                                                                                                                                                                                               |
| FIP-06 | Criar v7/loja-v2, preservar versões/hashes anteriores e manter o switch v6/loja-v1 até aprovação provisória das duas amostras. Assinatura física de Rose/Operação permanece gate de produção.                                                                                                                                                                                                                              |

O contexto comercial `purchase_profile`/`purpose` e chaves desconhecidas não são
projetados automaticamente. Não há mudança no banco, na cobrança InfinitePay,
exportação Olist, confirmação ou permissões do pedido.

FIP-03 (nomes dos anexos) fica adiado: metadados dos arquivos são separados do
contrato Order; esta entrega não acrescenta consulta de arquivos nem promete
imprimir nomes ou conteúdo das artes. Dados fiscais/cadastro integral do contato
também não são adicionados à ficha de fábrica.

O detector de texto financeiro cobre moeda explícita e termos usuais de
pagamento; não é classificação semântica de linguagem natural. O preenchimento
de textos de produção deve continuar separado das instruções financeiras.

Evidência: [revisão das amostras](../../../docs/phase0/FICHA-PDF-REVIEW-V7.md).
