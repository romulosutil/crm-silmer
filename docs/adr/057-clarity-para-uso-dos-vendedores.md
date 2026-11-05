# ADR 057 — Clarity para uso dos vendedores

Data: 05/11/2026. Status: aceita por solicitação explícita do proprietário.
Proposta: [RFC 046](../rfc/046-clarity-para-uso-dos-vendedores.md).
Contrato: [CLAR-01–06](../../.specs/features/seller-analytics/spec.md), PRV-01–03.
Tarefa: CLAR-T01. Issue/PR: não abertas nesta entrega.

## Decisão

Integrar o projeto Microsoft Clarity `z8yldgd1xr` ao shell Vue existente para
entender navegação e ações dos vendedores. Usar biblioteca oficial
`clarity-js@0.8.76` (MIT), dependência de build fixada no lockfile e separada em chunk tardio;
nenhum novo serviço, store ou estado de domínio global.

Somente Vendedor autenticado sem `COMMERCIAL_ADMIN`, no host aprovado de
produção, pode transmitir. Mascarar documento inteiro e imagens, negar
cookies e publicidade desde `start`, respeitar sinais GPC/DNT. Eventos e tags
têm nomes finitos; chave do vendedor usa SHA-256 com namespace, sem nome,
e-mail ou ID bruto. URLs/referrer são validados antes do início e upload.

O shell interrompe antes da navegação e troca de sessão. O transporte
callback invalida gerações antigas e só envia do contexto autorizado atual,
inclusive diante de reinício interno do SDK. Fetch usa credenciais omitidas,
sem referrer e sem processar comandos remotos. CSP permite somente o coletor
`https://www.clarity.ms` em connect-src; script-src continua local.
Antes de transmitir, um filtro validado para o protocolo da versão fixa remove
destinos de links clicados e eventos de erro JavaScript/log interno, que não
são protegidos pela máscara DOM. Envelope desconhecido é descartado.

## Consequências

Permite localizar atritos no funil atendimento → pedido → ficha sem conteúdo
comercial legível. A dependência acrescenta aproximadamente 27 KB gzip em
chunk sob demanda, sem dependências transitivas. Modo sem cookies fragmenta
sessões e conteúdo mascarado limita replays. Analytics é evidência de uso,
sem autoridade de auditoria, entrega de mensagem ou desempenho financeiro.

Operação, limites e reversão no [runbook](../runbooks/clarity-vendedores.md).
Mudança de host, cookies, máscaras, público ou identificação requer nova
revisão explícita; a solicitação atual não aprova essas ampliações.
