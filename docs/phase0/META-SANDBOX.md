# T00.4 — Sandbox da Meta

## Escopo e limite

Este procedimento fecha a evidência não produtiva da issue `#4` para a
WhatsApp Business Platform. Ele cobre o app Meta, o número de teste fornecido
pela Meta, o callback assinado, replay, quatro tipos de envio e estados
observados. Não autoriza tráfego de clientes nem transforma o receiver da Fase
0 em integração de produção.

Este receiver não é produção.

O receiver da Fase 0 mantém deduplicação somente na memória para tornar o smoke
repetível sem persistir conteúdo. `T02.2` deve substituí-lo pela PostgreSQL
inbox transacional antes de conectar um número real ou criar mensagem/job de
domínio. Reinício do processo apaga esse store; portanto, o endpoint não é uma
garantia de deduplicação durável.

## Ativos selecionados

- App Meta: `Silmer CRM`, ID `2260627114698047`, em modo desenvolvimento.
- Portfólio empresarial verificado: ID `203195957172732`.
- WABA de sandbox: `Silmer`, ID `104737395571183`.
- Graph API validada na referência oficial: `v25.0` em 31/08/2026.
- Callback: `https://<dominio-edge>/api/v1/webhooks/meta/whatsapp`.

IDs acima identificam ativos, mas não concedem acesso. App secret, verify token,
access token, telefone e evidência com `wamid` ficam fora do Git.

## Segredos e dados locais

Copie `docs/phase0/meta-sandbox.env.example` para um arquivo ignorado e preencha
somente no ambiente autorizado. `.env.example` permanece o inventário canônico
do EasyPanel e não recebe variáveis exclusivas do smoke:

- `META_APP_SECRET` e `META_VERIFY_TOKEN`: receiver do webhook;
- `META_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID` e
  `META_GRAPH_API_VERSION`: cliente de mensagens;
- `META_TEST_RECIPIENT_E164`: destinatário sintético autorizado;
- `META_TEMPLATE_NAME` e `META_TEMPLATE_LANGUAGE`: template aprovado/teste;
- `META_TEST_DOCUMENT_URL` e `META_TEST_IMAGE_URL`: arquivos públicos sem PII;
- `META_SANDBOX_EVIDENCE_PATH`: opcional; o default é
  `var/meta-sandbox-evidence.json`, diretório ignorado.

O smoke nunca imprime token, telefone, payload ou `wamid`. O arquivo local
guarda os `wamid` aceitos e seus hashes para correlação; somente hashes, tipos,
datas e status podem entrar na evidência versionada.

## Sequência operacional

1. No app `Silmer CRM`, adicionar o caso de uso **Conectar-se com clientes pelo
   WhatsApp** e vinculá-lo à WABA `Silmer`.
2. Usar o número de teste fornecido pela Meta como remetente. Cadastrar o número
   informado pelo operador apenas como destinatário de teste. Migrar ou
   registrar um número real como remetente fica fora desta issue.
3. Gerar o token temporário de teste; manter seu valor somente na sessão segura.
   Token permanente de usuário do sistema só deve ser criado para o ambiente
   aprovado e armazenado como segredo do EasyPanel.
4. Depois do merge e da publicação do digest, configurar no `silmer-api`
   `META_APP_SECRET` e `META_VERIFY_TOKEN`; manter `silmer-api` privado.
5. Configurar o callback público pelo `silmer-edge-web`, assinar o campo
   `messages` e confirmar o challenge sem registrar o verify token.
6. Executar os checks locais e então o smoke live:

   ```powershell
   npm run validate:external-spikes
   npm run test:external-spikes
   npm run smoke:meta:sandbox
   ```

7. No painel da Meta, correlacionar somente eventos realmente recebidos:
   `sent`, `delivered`, `read` e `failed`. A falta de webhook não autoriza
   inferir estado.
8. Reenviar o mesmo webhook assinado e comprovar `accepted: 0` e
   `duplicates: 1`. Assinatura inválida deve retornar `401` antes do parse.
9. Executar os faults locais antes do despacho, após aceite e timeout. Depois do
   ponto de não retorno o resultado é `outcome_unknown`, com retry automático
   desabilitado.

## Evidência de fechamento

| Critério                                     | Evidência exigida                                    | Estado                            |
| -------------------------------------------- | ---------------------------------------------------- | --------------------------------- |
| App, WABA, número de teste, token e template | IDs não secretos + captura sanitizada                | Pendente de ação Meta             |
| Challenge e assinatura real                  | resposta do callback + rejeição `401`                | Pendente de deploy                |
| Replay sem efeito duplicado                  | contadores do receiver                               | Coberto localmente; live pendente |
| Texto, template, documento e imagem          | quatro `wamid` no arquivo local + hashes versionados | Pendente de token                 |
| `sent/delivered/read/failed`                 | webhooks observados, sem inferência                  | Pendente de live                  |
| Crash/timeout e `outcome_unknown`            | testes automatizados + smoke sanitizado              | Coberto localmente                |
| Ausência de PII/token                        | gates e inspeção do diff/evidência                   | Em validação                      |

Enquanto os itens live estiverem pendentes, `externalApprovalGranted` permanece
`false` e os efeitos Meta continuam `pending-live` em
`external-effects.json`.
