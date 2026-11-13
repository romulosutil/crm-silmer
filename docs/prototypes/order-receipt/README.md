# Protótipo do recibo do pedido — RCP-P01

Abra `index.html` em um navegador. A primeira tela mostra o recibo; **Voltar ao
pedido** apresenta o ponto de entrada no detalhe. **Recibo do pedido** e
**Visualizar recibo** retornam à prévia e preservam a origem do foco.

O seletor **Cenário**, fora da interface do produto, oferece Confirmado,
Pendente, Dados parciais e Falha ao gerar PDF. Os três primeiros baixam PDFs
sintéticos incorporados no próprio arquivo. Falha ao gerar PDF simula erro;
**Tentar novamente** demonstra a recuperação com o exemplo confirmado.

Fontes e marca estão incorporadas; não há chamadas ao CRM, dependências de
rede, persistência de dados comerciais ou envio de mensagens. Dados e PDFs
são amostras fixas. Todos os documentos levam a marca de protótipo.

Contrato, requisitos, tarefas futuras e decisões em revisão estão na
[RFC 068](../../rfc/068-recibo-comercial-do-pedido.md). A ficha real da fábrica,
seus bloqueios e o registro de primeira impressão permanecem inalterados.

## Evidências da revisão local de 12/11/2026

- Chromium: 320, 390, 736 e 1024 px, em claro e escuro, sem rolagem horizontal.
- axe-core: sem violações WCAG A/AA nos oito pares de largura/tema e nos três
  cenários de documento. Isso não substitui homologação humana com leitor de tela.
- Enter abre a prévia; voltar devolve foco à ação original, inclusive ao botão
  da seção de documentos. Estados de carregamento, erro e repetição verificados.
- Downloads verificados como PDFs reais, com nome e bytes correspondentes ao
  cenário; trocar de cenário durante a preparação descarta o resultado anterior.
- Sem erro JavaScript ou solicitação de rede externa durante o fluxo.
- Três PDFs A5, uma página cada, renderizados com Poppler e inspecionados
  visualmente; extração com pypdf confirmou ressalva, versão e marca de amostra.
- `npm run validate`: aprovado, com 2.726 testes passando e 53 integrações
  ignoradas por dependerem de ambiente dedicado. Build e checks estáticos
  incluídos; `npm audit --audit-level=high` não encontrou vulnerabilidades.
- Prettier dos quatro arquivos da entrega e `git diff --check` aprovados.

Cobertura restrita ao protótipo. ACL real, autosave, concorrência com edições,
paginação longa e integração com o pedido aguardam RCP-T01–T04.

## RCP-P02 — Contraste da tabela na conversa

Correção vinculada a RCP-11: quantidade, descrição e valores agora definem
explicitamente a cor escura sobre o papel branco. O recibo isola seu esquema
claro das cores de tabelas do tema da conversa. Conferência com estilos globais
de tabela/célula claros sobrepostos, em 320 e 1024 px, nos dois temas.
