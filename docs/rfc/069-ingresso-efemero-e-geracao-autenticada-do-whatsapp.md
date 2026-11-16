# RFC 069 — Ingresso efêmero e geração autenticada do WhatsApp

Data: 16/11/2026. Status: aceita para implementação e prova isolada pelo
proprietário neste chat; produção permanece desabilitada.
Decisão: [ADR 092](../adr/092-sanitizacao-pre-persistencia-e-geracao-na-origem.md).
Entrega: WAP-E01/WAP-T01-01, WAP-02/03/04/10/12.
Antecedentes: [RFC 067](067-whatsapp-por-vendedor-e-meus-clientes.md),
[ADR 091](../adr/091-contratos-da-etapa1-whatsapp-pessoal.md),
[PR 391](https://github.com/romulosutil/crm-silmer/pull/391) e
[evidência inicial](../../ops/evolution/wap-provider-spike.evidence.json).
Sem issue específica. Esta RFC não implementa os endpoints CRM de E02/E04.

## Problema e resultado necessário

A prova inicial encontrou o token do header em `execution_data`/dump/WAL do
n8n 2.38.7: o Webhook inclui headers no input inicial e a persistência começa
antes do primeiro nó. As flags none/false e o soft delete posterior não
impedem essa escrita. QR/código obtidos depois pelo nó HTTP não apareceram
nos checkpoints medidos, mas o gate de ausência de segredo continua reprovado.

Evolution 2.3.7 consulta URL/headers atuais ao emitir eventos já enfileirados;
o wrapper aplica um token global. Trocar somente o header no reconnect não
prova a geração que originou o evento. Precisamos remover credenciais antes
da primeira persistência e carregar origem imutável desde o callback do socket.

## Solução escolhida

São dois patches versionados, sobre as imagens já aprovadas e fixadas por
digest. Não acrescentam serviço, Redis, store de domínio, acesso direto ao banco
CRM ou rota operacional publicada. Patches verificam hashes/âncoras da versão
instalada e falham no build se a fonte divergir. Atualizar upstream exige rever
o patch e repetir a prova; não há substituição silenciosa por regex permissiva.

### n8n: autenticar e projetar antes de persistir

O hook do Webhook roda depois da autenticação nativa e antes da construção do
output inicial. Em paths reservados explicitamente permitidos, produz somente
o envelope canônico; headers, query e params não são copiados. Segredos nunca
são movidos para URL, body ou nomes de campos. Não é um nó Code de limpeza.

Para desafios, aceitar somente metadados de operação/desafio e modalidade.
No perfil sintético E01, somente actor/mode dos enums e generation=1 são
permitidos; IDs de operação/desafio são recusados até validação autoritativa
em E02. Nenhum campo arbitrário pode transportar credencial antes do writer.
QR/código continuam no retorno síncrono API → n8n → Evolution, fora do input
inicial, jobs, outbox e recibos idempotentes. Exigir save-success/error=none,
save-manual/progress=false, ausência de error workflow e pinData vazio.
Verificar também o início de execução manual antes da primeira escrita;
execução parcial/retry manual com dados fornecidos não contorna o guard.

Para eventos, autenticação nativa de transporte continua obrigatória. Um token
distinto por geração autentica o binding por uma consulta privada antes de
criar execução. No spike, o verificador é uma fixture sintética em memória.
O contrato de produção posterior pertence à API autorizada do CRM, com Basic
técnico vigente, capacidades próprias, limites e guard default off; n8n não
consulta SQL nem reconstrói geração pelo estado atual. Não se introduz HMAC
ou timestamp no contrato n8n v1.

O verificador recebe source com bindingId/lineId/accountId/generation, instância e o token
em header próprio. Compara o token ao binding imutável e seu estado vigente;
devolve somente source e instância canônicos se todos os campos coincidirem e o binding
estiver autorizado. Usar o estado atual para revogar é permitido; atribuir a
geração atual a um evento antigo é proibido. Falha, timeout, revogação ou
divergência recusam antes da primeira persistência, sem guardar request bruto.

### Evolution: origem capturada antes da fila

Cada socket recebe uma única configuração autorizada, com source imutável e
credencial da geração. O callback registrado captura esse contexto antes de
qualquer fila ou await. AsyncLocalStorage propaga o contexto do callback pelas
promises e retries; referências por socket não são substituídas por consultas
à instância atual. Um callback antigo conserva a origem antiga mesmo depois
de outro socket assumir a mesma instância.

O emissor pessoal usa esse contexto para formar source e header da geração.
O token global de transporte não substitui o token da geração. A configuração
mutável de webhook não fornece a origem do evento pessoal. Instância pessoal
sem binding é recusada. Flag ausente/off e allowlist vazia não habilitam envio
pessoal; a linha geral preserva seu caminho atual.

O hook em processo de instalação de binding não é uma API pública. Nesta
entrega é usado somente pelo ensaio; sua integração com os comandos/ledger
de controle real fica em E02/E04. Restaurar processo ou estado não autoriza
reatar um binding revogado: restauração entra bloqueada até reconciliação.

O mesmo patch de imagem também projeta uma cópia de `creds` antes de sua
serialização pelo adapter Prisma e omite somente o código humano temporário
`pairingCode`. Baileys emite creds.update com esse campo antes de devolver o
código; apagar Session no logout não evita sua passagem pelo WAL. O objeto em
memória e o material criptográfico necessário da sessão, incluindo advSecretKey,
são preservados. A projeção de persistência vale também com a flag de geração
desligada; não altera adapters Redis/arquivo, dados existentes ou retenção.
Não se apagam sessões nem backups históricos nesta entrega.

## Prova e limites

Repetir no SSH Mel em recursos Docker dedicados, sem portas publicadas ou
volumes existentes. Credenciais de transporte, API Evolution, verificador Basic
e gerações são distintas e sintéticas. Não salvar dumps, logs ou desafios como
artefatos; somente indicadores, fontes/hashes e resultados sanitizados.

- Sucesso, erro após desafio, manual real e execução em progresso: procurar
  credenciais e QR/código em DB/WAL, backup lógico, snapshots e logs dos dois
  streams. pinData/error workflow e settings efetivos também são conferidos.
- Fonte de evento: reter o callback real patchado antes do reconnect, ativar
  nova geração, liberar o callback antigo e provar rejeição sem relabeling.
  Retry/replay conservam source; troca de token/campo/conta e ausência de
  binding não passam. Callback/fila são reais da imagem; evento recebido do
  WhatsApp é sintético. Isso não é prova de socket pareado ou tráfego live.
- Guardas: ausência/valor inválido de flags e allowlist, configuração insegura
  de desafio, ingresso sem autenticação, falha do verificador e geração
  revogada são recusados. Caminho legado não sofre sanitização silenciosa.

Não enfraquecer assertions para obter verde. Testes dos patches não equivalem
à implementação dos endpoints, do ledger ou da carteira. Retenção abrangente
de múltiplas instâncias e uso do código no mesmo celular continuam gates
independentes; não declarar WAP-E01 integralmente aceito sem essa evidência.

## Alternativas e custo de manutenção

Rejeitados: limpar com Code depois do Webhook, confiar em redaction na leitura,
hard delete depois do efeito, cifra somente do backup, gateway direto do browser,
token na URL, workflow copiado por vendedor e lookup da geração atual no emit.

Instância imutável por geração pode evitar parte do contexto de socket, mas
adiciona gestão de sessão, retenção, identidade e recovery ainda não provados.
O patch estreito foi escolhido para manter conta técnica e instância estáveis.
Seu custo é acompanhar duas fontes upstream fixadas e impedir build incompatível.

## Rollback e publicação

Somente PR, sem merge automático, deploy, pareamento, flags reais ou mensagens.
Nenhuma imagem de ensaio é enviada a registry. Imagens operacionais existentes
permanecem intocadas. Volumes/containers de prova são removidos por ownership.
Rollback remove a seleção dos patches e mantém caminhos pessoais bloqueados;
não faz down comercial, apaga ledger/ACL ou repete efeito incerto. Uma imagem
sem o patch não é rollback compatível com ingresso pessoal habilitado.
