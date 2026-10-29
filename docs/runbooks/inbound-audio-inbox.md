# Áudios recebidos na Inbox

INBOX-AUDIO-01 · AUD-IN-01..04 · EVOL-01D · INB-01 · MSG-01..04.
Atualização: 29/10/2026, America/Sao_Paulo.

## Causa e correção

A mensagem afetada aparecia como `Áudio`, sem player. O workflow registrava
o inbound, mas seu ramo independente de anexos filtrava somente imagens.
Download/transcrição no caminho da IA não salva um anexo reproduzível e esse
caminho não executa depois da tomada humana.

A API e o componente já suportam áudio privado OGG/MP3. O patch offline
`ops/n8n/patch-evolution-inbound-audio.mjs` altera somente o filtro e a medição
dos nós históricos `Inbox - Imagem recebida - Filtrar/Medir`. Os nomes e IDs
ficam preservados. Áudio aceita até 16 MiB; imagem conserva 5 MiB. Tipo e MIME
do evento devem coincidir com o MIME binário. Hash, scanner, vínculo, replay,
retenção e falha sanitizada continuam no contrato existente.

O edge precisa aceitar o multipart correspondente: `docker/nginx.conf`
reserva 17 MiB somente para POST na rota exata
`/api/v1/integrations/n8n/conversations/:id/attachments`, sem buffering de
request e sem alterar autenticação da API. O limite genérico continua 1 MiB.

## Publicação observada

Exportação anterior privada: revisão `d53b60a6-a4d2-4c87-8689-6a78e94adca3`,
110 nós e `active=true`. Backup e revisão preparada estão em
`var/inbox-audio/`, ignorado pelo Git. Nunca publicar esses exports, que
podem conter configuração privada.

A edição pela interface foi exportada e comparada ao patch offline com
igualdade estrutural: somente dois nós modificados; demais nós, conexões e
settings iguais. A revisão `15d9ba9a-77e8-429b-bd43-e6dc2349ec5f` foi publicada
como **INBOX-AUDIO-01 · Persistir áudios recebidos**. A interface confirmou
`Published`. Não foram alterados workflows Meta, webhook ou credenciais.

O limite maior do edge permanece pendente de implantação remota. Áudios
pequenos podem ser testados com o workflow publicado, mas isso não comprova
o limite de 16 MiB em produção.

## Evidências e pendências

76 testes focados passaram: patch Evolution, cadeia de imagem preservada,
API de anexos, conteúdo privado/Range, retenção, volume e política do edge.
Revisão independente de Backend/QA sem bloqueantes nos arquivos da entrega.
Gate completo `npm run validate`: 1.434 testes, 1.429 aprovados, cinco skips,
zero falhas, tipos, lint e build. A execução autorizada fora do sandbox
permitiu hardlinks dos testes de áudio e os testes de loopback/MSYS.
A auditoria `npm audit --audit-level=high` passou, com três avisos existentes
(um baixo e dois moderados), sem alterar dependências.

E2E completo: 344 aprovados, sete skips e dois timeouts em Cadastro/Assuntos.
Os dois cenários passaram na repetição isolada, com um worker e sem build
concorrente. Nenhum cenário de mídia falhou. Isso não comprova WhatsApp real.

O smoke Docker já usado pelo CI foi estendido a 14 combinações de rota/tamanho
e negativas de método da coleção inbound. Docker não está instalado nesta
máquina; esse smoke com Nginx real não foi executado localmente. Os testes
estáticos não substituem a verificação de limite e sintaxe em container.

Foi preparado um OGG/Opus sintético de cinco segundos, sem conteúdo pessoal,
para anexar na conversa de teste do proprietário. A seleção de arquivos pelo
navegador não concluiu; a ferramenta encerrou o controle por não conseguir
confirmar a URL ativa no Windows. Nenhum envio de áudio foi acionado. Não
declarar entrega, reprodução ou player inbound homologados nesta etapa.

Para concluir:

1. Implantar o edge pelo pipeline vigente e conferir imagem/saúde e upload
   sintético acima de 1 MiB, mantendo rejeição nas demais rotas.
2. Na conversa de teste do proprietário já em modo humano, anexar o OGG pela
   Inbox e enviar uma vez. Acompanhar o mesmo comando; `unknown` exige
   reconciliação, sem repetir o envio.
3. Na conta receptora do WhatsApp, localizar o áudio e reproduzir. Conferir
   avanço do tempo até o final, duração e ausência de erro do decoder.
4. Responder com áudio pelo WhatsApp de teste e verificar nova mensagem
   inbound com player, leitura privada e reprodução na Inbox.
5. Recuperar pontualmente o áudio anterior afetado pelo ID canônico, se os
   bytes ainda existirem na Evolution. Usar só download e endpoint de anexos,
   sem repetir inbound, IA, handoff ou mensagens. Preservar o prazo original.

## Aplicação e rollback

```powershell
node ops/n8n/patch-evolution-inbound-audio.mjs <export-atual.json> <review-novo.json>
```

O comando é offline, recusa contexto inesperado e exige saída nova. Reaplicar
o patch à mesma revisão retorna zero alterações. Comparar o export vivo antes
de publicar; nunca substituir o principal por um snapshot Meta antigo.

Rollback de workflow restaura somente filtro/medição da revisão anterior,
preservando mensagens e anexos já vinculados. Voltar o limite do edge não
apaga arquivos, mas volta a impedir uploads acima de 1 MiB. Não restaurar
banco nem reenviar comandos como consequência de rollback.
