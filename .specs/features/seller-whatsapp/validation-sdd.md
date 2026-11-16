# WAP-T00d — evidências do SDD da etapa 1

Data: 16/11/2026, America/Sao_Paulo. Entrega exclusivamente documental,
WAP-01–12/16–33. Base: [PR 382](https://github.com/romulosutil/crm-silmer/pull/382),
head `b04c0170`; confirmação adicional da master `d7537b3c` para o botão Criar
pedido. A PR 382 estava aberta durante a elaboração. Esta entrega depende da
sua integração antes de executar os prompts de implementação.

## Artefatos

- [Design](design.md): dados, estados, contratos, ACL, privacidade, concorrência,
  origem por Assunto, migração em fases, rollback e critérios operacionais.
- [Tarefas](tasks.md): 32 entregas atômicas, dependências e cobertura dos 30
  requisitos aplicáveis à etapa 1, incluindo WAP-16; WAP-13/14/15 na etapa 2.
- [Prompts](PROMPTS.md): 32 caixas completas, uma por tarefa, com objetivo,
  fronteira editável, aceite, verificação, handoff e modelo recomendado.
- [ADR 091](../../../docs/adr/091-contratos-da-etapa1-whatsapp-pessoal.md):
  decisões técnicas vinculadas à RFC 067 e à ADR 090, sem reescrever ADR anterior.

## Revisões especializadas

Backend/Dados e QA/Segurança/Privacidade fizeram revisão somente leitura,
distintos do integrador. Não implementaram código, alteraram infraestrutura ou
executaram suítes de runtime. Achados incorporados:

1. Criação atual por conversa e índice de um pendente não fecham alvo Assunto.
   Separar migração de origem, compatibilidade de leitores, comando atômico,
   UI e gate. Conservar `conversation_id`, sem atalho de Pedido manual solto.
2. Callback antigo não pode ganhar geração atual por consulta de mapeamento.
   Exigir origem de ingresso imutável por geração e prova no spike.
3. Replay de desafio não pode renovar pareamento incerto. Persistir metadados;
   reconciliação e renovação explícita/versionada, sem armazenar QR/código.
4. Reutilizar UNIQUE de Assunto existente em 0037. Backfill somente de pendente
   ativo com vínculo único comprovado; cancelado imutável e histórico ficam
   nullable com compatibilidade de leitura.
5. Cada tarefa que introduz efeito já entrega configuração fail-closed/default
   off e allowlist pertinente. T05-01 consolida as travas e capacidade, pois PRs
   anteriores podem ser implantados automaticamente.

## Verificação documental

Gate documental aprovado: Prettier nos 12 documentos da entrega, 643
referências locais existentes (incluindo âncoras), 32 tarefas e 32 prompts em
correspondência 1:1, cobertura explícita dos 30 requisitos aplicáveis,
dependências sem referência ausente ou ciclo e `git diff --check` sem falhas.
Os 15 ancestrais de WAP-T02a-05 não incluem primeira saída/sincronização completa.
Distribuição conferida: 21 Sol/Opus, 10 Terra/Sonnet e 1 Luna/Haiku.

O validador documental temporário leu Markdown e verificou existência de links,
âncoras, IDs/modelos/dependências e cobertura, sem instalar dependências ou
escrever testes de runtime. Prettier foi invocado pelo executável já instalado
no checkout principal, sem junction/symlink ou compartilhamento de node_modules.
Nenhum resultado de runtime, provider, banco, mobile real ou produção é
declarado nesta entrega. A homologação do código no mesmo celular, a ausência
de persistência do segredo no ambiente real e capacidade continuam pendentes.

## Publicação e preservação

Checkout principal preservado, incluindo `apps/edge-web/index.html`, `.agents/`,
`.ajeito-checkpoint.json` e `.claude/`. Worktree temporário contém só esta
entrega documental e deve ser removido no handoff. Outro worktree pré-existente
da sessão de redesign não pertence a esta tarefa e não é removido.

Um commit e um push para `codex/sdd-whatsapp-etapa1`, PR dependente da PR 382;
sem merge, publicação de workflow, pareamento, ativação ou efeito financeiro.
SHA e link da PR ficam no handoff, sem fabricar evidência ou autorreferência
de commit dentro do próprio commit.
