# T00.4 — Mídia transitória do piloto interno

Rastreabilidade: issue `#6`; `MSG-01..03`; `PRV-02/03`;
`PRV-P06-01..03/11`.

## Decisão em linguagem natural

As imagens e os arquivos recebidos ou enviados durante uma compra não precisam
ser tratados como arquivo permanente do CRM. Eles ficam em uma área privada da
VPS somente enquanto ajudam na jornada. O CRM apaga os bytes quando a jornada
termina ou quando completam sete dias, o que acontecer primeiro.

Se o arquivo for inválido, ele é descartado e nunca segue para o Dropbox. Um
arquivo só é válido quando passa limite, MIME real, hash e varredura e uma
pessoa o classifica como necessário à finalidade operacional. Se atender às
duas condições, a equipe o guarda no Dropbox pelo processo
que já utiliza hoje. O CRM registra apenas um recibo do handoff — hash,
operador, horário e resultado — e então elimina a cópia temporária. Nesta fase
não existe integração automática, token, SDK, OAuth ou sincronização com o
Dropbox.

Perder a única cópia temporária por falha da VPS é um risco aceito para o
produto interno. Nesse caso, o CRM mostra `lost/unavailable`; não promete
recuperação. Esse aceite vale somente para mídia transitória. Pedido, Ficha,
orçamento aprovado, comprovante PIX válido, eventos comerciais, auditoria,
tombstones e backups continuam duráveis e seguem seus próprios prazos.

O contrato executável está em
[`media-retention-policy.json`](./media-retention-policy.json). A função de
domínio `resolveTransientMediaExpiresAt` implementa a fórmula:

```text
expires_at = min(recebida_em|enviada_em + 7 dias, jornada_encerrada_em)
```

Quando a jornada ainda não terminou, vale apenas o teto de sete dias. Uma falha
ou pendência no arquivamento operacional nunca aumenta o prazo; se o arquivo
não for arquivado a tempo, o CRM registra `archive_missed` e ainda elimina os
bytes no vencimento. Um `legal_hold` que precise da evidência deve promover o
subconjunto mínimo para uma classe durável antes desse prazo.

## Controles mínimos para T02/T06

- volume privado, sem domínio, porta pública, backup ou restore;
- worker com leitura/escrita e API somente por rota autorizada;
- caminho opaco sem PII, quota fail-closed e limpeza de arquivos parciais;
- quarentena, limite, MIME real, hash, ClamAV e bloqueio de SSRF;
- metadados, `expires_at`, estados e recibo operacional no PostgreSQL;
- job no evento terminal e no vencimento, com sweeper diário de segurança;
- ausência de bytes vira estado visível, sem alegação de recuperação;
- nenhuma purga curta alcança documentos comerciais ou auditoria.

## Limites desta entrega

Esta entrega fixa e testa a regra de domínio. Ela não provisiona o volume no
EasyPanel, não implementa o worker de mídia e não configura o Dropbox. Esses
passos pertencem a T02/T06. O gate R2 permanece apenas como opção futura na
issue `#29`; nenhuma assinatura ou bucket foi autorizado.

## Verificação

```powershell
npm run validate:media-retention
npm run test:media-retention
npm run validate:security-catalog
npm run test:security-catalog
npm run validate
```
