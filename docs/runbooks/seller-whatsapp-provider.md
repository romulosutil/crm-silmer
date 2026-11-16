# WhatsApp pessoal — viabilidade do provedor e privacidade

Entrega WAP-E01 / WAP-T01-01, 16/11/2026 (America/Sao_Paulo).
Requisitos WAP-02/03/04/10/12; [spec](../../.specs/features/seller-whatsapp/spec.md),
[SDD, seções 5–6](../../.specs/features/seller-whatsapp/design.md),
[ADR 090](../adr/090-whatsapp-pessoal-carteira-e-cadastro-compartilhado.md) e
[ADR 091](../adr/091-contratos-da-etapa1-whatsapp-pessoal.md).
Base `f7a06389`, posterior à integração da PR 382 e do SDD; preserva `d7537b3c`.

## Resultado e bloqueios de habilitação

**Gate bloqueado.** O spike é uma investigação reproduzível, não um adapter
operacional nem homologação do provedor. WAP-E01 e WAP-T01-01 permanecem abertos.
Não iniciar WAP-E02 supondo que os gates abaixo tenham passado.

1. A geração não é autenticada na origem pela fonte/wrapper fixados. O upstream
   enfileira eventos antes de consultar a configuração de webhook atual; trocar
   URL/header na mesma instância pode atribuir credencial nova a evento antigo.
   O wrapper ainda aplica um único token global, inclusive a outra instância.
2. O n8n grava dados iniciais antes do primeiro nó de guarda. O ensaio encontrou
   o token técnico sintético em claro no dump, apesar de save-success/error=none,
   save-manual=false e save-progress=false. Remover dados depois não prova
   ausência em persistência, WAL ou backups anteriores.
3. Retenção atual seleciona somente `SILMER_EVOLUTION_INSTANCE`. Acrescentar
   instâncias não demonstra expurgo de todas as linhas. Não ampliar retenção.
4. A existência de `pairingCode` na resposta não homologa o mesmo celular.
   Nenhuma conta foi pareada; identidade conectada, mobile, capacidade e recovery
   permanecem gates próprios. Não apresentar duas telas como substituição aceita.

Nenhuma flag de ambiente real, rota CRM, migração ou workflow operacional muda.
Contact oficial, carteira, ACL comercial independente, snapshots, linha geral,
reservas e retenção permanecem nos serviços existentes. Vínculo cadastral não
concede conversa ou Pedido alheio. Não há infraestrutura permanente nova.

## Fonte fixada e contratos observados

Evolution API 2.3.7, commit `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`,
Baileys 7.0.0-rc.9; imagem upstream OCI
`sha256:1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339`.
O [perfil existente](../../ops/evolution/README.md) troca apenas Node por
24.22.1 e aplica `privacy.cjs`/`retention.cjs`. O ensaio usa essa mesma receita:
para Docker legado, materializa os dois COPY heredoc byte a byte, sem mudar os
demais comandos, bases ou o comportamento do wrapper.

| Contrato privado                                      | Efeito/limite verificado                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /instance/create`                               | 201; `integration=WHATSAPP-BAILEYS`, `qrcode=false`. Resposta inclui hash/credenciais upstream: não persistir o corpo bruto no CRM/n8n.                                          |
| `GET /instance/connectionState/:name`                 | Estado aninhado `instance.state`; `close`, `connecting`, `open` não comprovam sozinhos número/titular.                                                                           |
| `GET /instance/connect/:name`                         | Tem efeito, embora seja GET upstream. Em `close`, inicia socket; em `connecting`, devolve desafio atual, sem aplicar novo número. Nunca mapear para navegação/GET humano no CRM. |
| `GET /instance/connect/:name?number=...`              | Instância sintética separada retorna `pairingCode`, além do QR. Não comprova uso do código no aparelho.                                                                          |
| `DELETE /instance/logout/:name`                       | Logout 200 das tentativas não pareadas; em `close`, a fonte pode recusar. Desconectar não libera titularidade nem autoriza nova tentativa incerta.                               |
| `POST /webhook/set/:name` e `GET /webhook/find/:name` | Desabilitação e leitura explícitas antes de conectar: enabled=false, eventos vazios, byEvents/base64=false. Nenhum evento é dirigido ao n8n operacional.                         |
| Requisição sem chave API                              | 401 no gateway dedicado. Chaves técnicas ficam somente no servidor/credencial cifrada; nunca no browser ou resultado bruto.                                                      |

`connect`/`restart` podem responder HTTP 200 com `{error:true,...}`: validar o
corpo e registrar somente outcome/metadados autorizados. Timeout ou resposta
ambígua exige reconciliação; o spike despacha um único connect por instância e
não repete em caso de erro/timeout. Create e logout também não têm retry.

Eventos na fonte: `messages.upsert`, `messages.update`, `connection.update` e
`qrcode.updated`. `sender`/`wuid`/`ownerJid` são pistas de identidade a validar;
o número informado pelo humano não é prova. `fromMe=true` é fato outbound,
não autorização de reenvio. O adapter atual descarta esses upserts e permanece
inalterado. QR/código só seguem pelo retorno síncrono do ensaio, nunca webhook
de eventos; o wrapper continua recusando QR/histórico e limpando `apikey`.

Fontes primárias da revisão:

- [Rotas upstream](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/routes/instance.router.ts).
- [Controller de instância](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/controllers/instance.controller.ts).
- [Geração, identidade e fila de eventos](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts#L1719).
- [Emissão usa configuração atual](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/event/webhook/webhook.controller.ts#L69).
- [Envelope sem geração capturada](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/services/channel.service.ts#L406).

## Ensaio dedicado e reprodução

Executado no host de desenvolvimento Mel, autorizado por SSH. Não utiliza
Evolution/n8n/PostgreSQL já em execução no host. Prefixo aleatório `wap-e01-*`,
label de ownership por rodada, rede própria, sem porta publicada, bancos
sintéticos separados e volumes próprios. O n8n de teste é ativado somente no
ambiente descartável para exercitar seu webhook real; nada é importado no
n8n operacional. Nenhum número real, pareamento, mensagem ou efeito financeiro.

```sh
node --test test/n8n-evolution-workflow.test.js
node --test ops/evolution/profile.test.mjs
node ops/evolution/wap-provider-spike.mjs --isolated-synthetic > report.json
```

O último comando requer Docker de desenvolvimento no mesmo host dos arquivos.
Saída 1 significa assertion/ensaio reprovado; saída 2 significa ensaio executado
com gate de habilitação ainda bloqueado. Nenhuma dessas saídas autoriza produção.
Sem argumento explícito ele recusa executar. Não chamar o script em ambiente
de produção nem apontá-lo a containers, URLs, volumes ou bancos existentes.

A fixture [em memória](../../ops/evolution/wap-provider-fixture.mjs) gera canários
e encaminha um único connect de cada instância dedicada. O
[workflow de prova](../../ops/n8n/wap-pairing-privacy-probe.mjs) é inativo e default
off, exige credencial, configuração explícita e allowlist somente sintética
antes de HTTP. Sua geração fixa testa a guarda da fixture; **não é prova de
geração autenticada do provider**. Todos os nós HTTP bloqueiam redirects e retry.
Não é workflow de controle WAP-E02 nem novo ingresso de produção.

O runner inspeciona somente em memória: respostas, canários recursivos,
representações raw/JSON/base64, token técnico em claro, pg_dump, stdout **e**
stderr de n8n/provider e tar do volume n8n. Captura snapshots durante execução
e após parar n8n, além de varredura dos arquivos físicos do PostgreSQL/WAL.
O dump é backup lógico real. A varredura física não é drill de restore nem
prova de decodificação de todo formato comprimido. Nenhum dump, tar, log bruto,
cookie ou desafio é salvo como evidência. O relatório contém apenas estados,
contagens, nomes de tabelas, booleans e códigos fixos; assertions não imprimem
seus valores recebidos. Assertions de privacidade são agregadas para completar
a matriz, mas qualquer ocorrência mantém a execução reprovada.

O runner remove apenas nomes registrados na rodada, com verificação de label;
não executa prune ou limpeza global. Falha de limpeza é reportada. Recursos
anteriores, dados de aplicações e checkout remoto ficam intactos.

## Alternativas revisáveis e próximos critérios

Estas alternativas são propostas para revisão, não decisões implementadas:

1. **Origem:** capturar binding imutável linha/conta/geração no socket ou antes
   da fila e autenticá-lo até cada tentativa HTTP. O binding não pode ser
   reconstruído a partir da geração atual no despacho. Alternativa: instância
   privada imutável por geração, com conta CRM estável, invalidação/isolamento
   integral da anterior e retenção abrangente. Exige revisão de lifecycle,
   continuidade da sessão, capacidade e recuperação antes de adoção.
2. **Persistência n8n:** impedir que o dado secreto componha o payload inicial
   persistido, antes do primeiro nó do workflow, com autenticação preservada.
   Uma alteração suportada/revisada no ingresso ou runtime n8n precisa de nova
   prova com banco e backups reais. Um Code de limpeza posterior, expurgo,
   criptografia do backup ou flags save* isoladas não atendem ausência.
   n8n permanece obrigatório; browser direto ao gateway é recusado.
3. **Mobile:** somente homologação explicitamente autorizada com aparelho real
   prova uso no mesmo celular. Até lá, mostrar limitação e manter cadastro e
   operações comerciais locais disponíveis; não habilitar conexão pessoal.

Novo ensaio de ingresso deve reter evento antes do reconnect, revogar o token
antigo e liberá-lo depois: rejeitar ou registrar a geração antiga, sem ativar a
atual. Cobrir token ausente/arbitrário, conta/linha erradas, retry já em voo e
ator revogado. Não alterar a identidade de efeitos iniciados. O teste focal
registra a limitação atual do wrapper, sem apresentá-la como aceite de ingresso.

Rollback desta entrega: remover os utilitários de prova; nenhum schema/dado
comercial requer down. Manter controle/inbound/envio pessoal desligados.
Não apagar ledger/ACL/histórico, restaurar desafio ou repetir efeito incerto.

## Evidência da rodada final

O [relatório sanitizado](../../ops/evolution/wap-provider-spike.evidence.json)
registra a rodada completa. SHA-256 do arquivo formatado:
`d673fb2074110b65c6a5b52605d13fb8dcb9673571fcecad4eb382a67c48d1db`.
Imagem local resultante do wrapper:
`sha256:15a21472d57a54710874a8da6521546b8bd50896792ef2b707ea101eaa4c91f7`.
Essa imagem foi removida ao final; não foi publicada em registry.
n8n 2.38.7 foi fixado pelo digest registrado no JSON.

| Cenário                                        | Resultado observado                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duas instâncias sintéticas                     | Create 201, estado inicial close, connect 200, estado connecting, logout 200 em ambas. Uma retorna QR, outra QR+código; nenhuma chega a open ou tem identidade pareada.                                 |
| Autenticação/guardas                           | Sem chave no gateway 401; sem header no webhook n8n 403. Ator fora da allowlist e geração sintética obsoleta não chegam à fixture. Isso não comprova a geração do provider.                             |
| Entrega síncrona                               | QR e código reais do gateway passam por n8n, retornam sem cache. Dois canários adicionais exercitam o mesmo caminho sem depender de disponibilidade do WhatsApp.                                        |
| Sucesso, erro após obter desafio, em progresso | Nenhum QR/código/canário encontrado no dump, logs ou volume n8n. Token do header encontrado em execution_data e backup lógico em todos esses checkpoints. Gate reprovado.                               |
| Manual real                                    | Disparado pela API manual n8n e confirmado pelo evento n8n.workflow.success com isManual=true. Nenhum canário manual encontrado. O dump cumulativo ainda contém token dos ingressos webhook anteriores. |
| pinData/error workflow                         | pinData vazio nos dois workflows exportados; sem error workflow. Settings none/false conferidos na configuração efetivamente salva. Não se simulou pinagem deliberada de segredo.                       |
| Snapshots/backups                              | Volume n8n sem canário/token, durante execução e após parada. Dump lógico e arquivos físicos do PostgreSQL/WAL após parada limpa contêm token em claro. Não é prova de restore.                         |
| Logs                                           | stdout+stderr de n8n/provider sem desafio/token nos scans. No JSON, o campo histórico stdout agrega os dois streams do docker logs.                                                                     |
| Limpeza                                        | Todos os containers, volumes, rede e tag próprios removidos. Listagens por label retornaram vazias. Nenhum recurso anterior foi removido.                                                               |

Os scans são cumulativos e negativos para os desafios; presença do token em
um checkpoint posterior não atribui uma nova gravação à execução manual.
A causa foi também confirmada diretamente no código instalado da imagem n8n:
Webhook.node.js:262–267 inclui req.headers, webhook-helpers.js:276–289 o põe na
pilha inicial, active-executions.js:43–66 e execution-persistence.js:43–73
persistem antes dos nós. execution-data/db-store.js:25–28 grava execution_data.
execution-lifecycle-hooks.js:424–439 e execution-persistence.js:333–340 aplicam
soft delete posterior, mantendo o registro inicial. Status inicial running
nesse registro não significa execução ainda ativa; por isso o teste manual
exige o evento real de sucesso, sem habilitar persistência para facilitar o teste.

O script terminou com **exit 1 / WAP_PRIVACY_PERSISTENCE_DETECTED**, após
completar a matriz e limpar os recursos. Não se removeu token dos scans nem se
habilitou expurgo para obter resultado verde. Rodadas exploratórias também
observaram resposta connect 200/connecting ainda sem desafio no retorno após o
delay fixo upstream; não houve nova chamada connect para forçar disponibilidade.
Essa intermitência impede prometer que HTTP 200 já entrega desafio válido.

Verificação do patch:

- `node --test test/n8n-evolution-workflow.test.js`: 26 aprovados, zero skips.
- `node --test ops/evolution/profile.test.mjs`: 9 aprovados, zero skips.
- `npm run validate`: 2.836 testes, 2.783 aprovados, 53 skips condicionais
  existentes, zero falhas; formatação, tipos, lint, fronteiras e build passaram.
  Não há migração nem lógica transacional nova nesta entrega.
- `npm audit --audit-level=high`: zero vulnerabilidades.
- `npm run test:e2e -- --workers=2 --retries=2`: 1.057 aprovados, sete skips
  legados, zero falhas e nenhum retry consumido (13,7 minutos).

Gates integrais no Mel usaram snapshot isolado sem a alteração alheia de
index.html, Node 24.20.0/npm 11.19.0 e a imagem Playwright fixada no
[runbook de áudio Linux](playwright-audio-local.md), com PulseAudio sintético.
O checkout Windows e a correção Criar pedido não foram modificados pelos gates.
Revisão independente de Integrações/QA verificou origem/geração, scanner,
streams de log, cleanup e interpretação das flags n8n; seus achados foram
incorporados. A investigação não homologa produção ou privacidade operacional.
