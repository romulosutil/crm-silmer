# Backlog pós go-live

Este documento reúne evoluções planejadas para depois do go-live. Os itens
registram intenção e escopo inicial; antes de iniciar desenvolvimento, devem
ser refinados em requisito e tarefa na especificação correspondente. Decisões
de arquitetura serão registradas em RFC/ADR quando aplicável.

## Itens

### POS-001 — Upload e download de arquivos na Ficha do Pedido

- **Status:** entregue no PR #150 e em produção desde 06/10/2026 (migrações
  0027 e 0028 aplicadas); a ativação depende da credencial do CRM no RustFS,
  conforme o [runbook](../runbooks/ativacao-arquivos-da-arte.md). Decisão na
  [RFC 011](../rfc/011-arquivos-da-arte-no-rustfs.md) e na
  [ADR 023](../adr/023-arquivos-da-arte-no-rustfs.md).
- **Prioridade:** primeira demanda pós go-live.
- **Objetivo:** permitir que uma pessoa autorizada envie arquivos pela Ficha do
  Pedido e baixe arquivos já associados ao pedido.
- **Escopo definido:** upload e download manual, na página do pedido, de até
  cinco arquivos da arte de até 10 MB cada e de uma arte final fora dessa
  conta. Os arquivos ficam no RustFS compartilhado `schedule/rustfs`,
  acessado só pela API na rede interna do EasyPanel; os domínios públicos da
  instância são lacuna aberta. PNG, JPEG e WebP ganham miniatura WebP
  gerada no navegador; os demais formatos mostram o ícone da extensão.
- **Fora do escopo:** aviso automático a Rose, edição ou conversão de
  arquivos, visualização completa no CRM além da miniatura e outras automações
  além de enviar, remover e baixar.
- **Rastreabilidade:** requisitos `ARQ-01`–`ARQ-09` (e `REV-04`) em
  [spec de Pedidos](../../.specs/features/pedidos-mvp/spec.md); tarefas `T79` e
  `T88`–`T92` em [tasks de Pedidos](../../.specs/features/pedidos-mvp/tasks.md);
  [ADR 019](../adr/019-ficha-espelhada-e-sinais-operacionais.md),
  [RFC 007](../rfc/007-revisao-da-ficha-e-leitura-operacional.md),
  [RFC 011](../rfc/011-arquivos-da-arte-no-rustfs.md) e
  [ADR 023](../adr/023-arquivos-da-arte-no-rustfs.md).

#### Critérios para iniciar a implementação (atendidos pela ADR 023)

- Decidir e documentar onde os arquivos serão armazenados e como o CRM os
  localizará depois do envio.
- Definir limites e tipos de arquivo aceitos e as validações necessárias.
- Definir acesso: somente pessoas autorizadas no pedido podem enviar ou baixar;
  a Ficha não deve expor link público nem credenciais do provedor.
- Definir comportamento para falhas e reenvios, sem arquivos ou registros
  duplicados.
- Definir persistência durável, auditoria e política de recuperação antes de
  ativar o upload.
- Confirmar estados acessíveis de envio, conclusão, erro e nova tentativa na
  interface da Ficha.

#### Aceite do MVP

- Pessoa autorizada envia um arquivo à Ficha do pedido correto e recebe
  confirmação de conclusão.
- Pessoa autorizada baixa o arquivo associado ao pedido.
- Pessoa sem autorização não consegue enviar nem baixar o arquivo, mesmo
  chamando a API diretamente.
- Falha de envio ou download fica clara e permite uma nova tentativa segura.
- O arquivo continua disponível após reinício da aplicação, conforme a
  solução durável definida.

#### Decisões tomadas (ADR 023)

1. **Onde guardar:** RustFS (S3-compatible, Apache-2.0), em bucket privado
   `crm-silmer-arquivos`, acessado somente pela API. Não há outro destino: o
   arquivo válido recebido no WhatsApp é anexado pelo operador ao pedido e
   também fica no RustFS.
2. **Formatos e limites:** PNG, JPEG, WebP, CDR, PDF, SVG, AI, EPS, PSD, TIFF,
   ZIP e RAR, verificados por assinatura de conteúdo; até 10 MB por arquivo,
   cinco arquivos da arte e uma arte final por pedido.
3. **Retenção, backup e recuperação:** os arquivos seguem a classe de dados do
   pedido. O volume do RustFS divide a VPS com o PostgreSQL; por isso o bucket
   entra no backup off-host e no drill de recuperação junto com o banco.
4. **Papéis:** enviar e remover exigem pedido pendente e permissão de edição;
   baixar exige permissão de leitura do pedido. Upload e download passam pela
   API, sem URL pré-assinada nem link público, com SHA-256, auditoria e
   idempotência.

#### Limites já aprovados

- Upload e download são o corte inicial; aviso automático a Rose continua fora
  deste escopo.
- Mídia transitória de conversa, com retenção curta, não pode ser reutilizada
  como armazenamento da Ficha, conforme a regra 18 de `RULES.md`.
- O upload só vai a produção com o RustFS provisionado e o bucket no backup
  off-host e no drill, conforme a ADR 023. A issue `#29` continua tratando o
  object storage gerenciado; sua conclusão não troca o RustFS sem nova
  decisão.
