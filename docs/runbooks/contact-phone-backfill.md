# Índice de busca por telefone de contatos históricos

O CRM usa `crm.contact_phone_lookup` para encontrar candidatos por número
completo. Um contato pode ter vários números WhatsApp confirmados. O índice
não vincula nem mescla contatos, e o número digitado no chat do site não vira
identidade WhatsApp confirmada.

## Quando executar

Depois de aplicar a migration `0038_contact_phone_details.expand.sql` e antes
de liberar busca por telefone no CRM. Execute no ambiente da API com
`DATABASE_URL`, `CONTACT_IDENTITY_ENVELOPE_KEY` e
`CONTACT_IDENTITY_LOOKUP_KEY` vigentes. Esta estação Windows não acessa o banco
de produção. O comando lê envelopes no processo e nunca escreve números em
claro no banco ou na saída.

## Execução

No contêiner da API, faça primeiro uma prévia:

```sh
node scripts/backfill-contact-phone-lookup.mjs --dry-run
```

Se a prévia terminar com `complete: true`, aplique:

```sh
node scripts/backfill-contact-phone-lookup.mjs --apply
```

Rode novamente a prévia. A aceitação exige `complete: true` e `missing: 0`.
Os contadores de saída são `scanned`, `eligible`, `inserted`, `existing`,
`missing` e `invalid`, sem números de telefone. `invalid` inclui identidades
sintéticas do chat do site e outros números fora do formato brasileiro.
Revise a origem de qualquer volume inesperado, sem despejar envelopes ou PII
em logs.

Cada página de até 200 identidades é transacional e idempotente. Para limitar
a janela de operação, use `--max-batches=10` e, se `complete: false`, continue
com `--after=<cursor>` mostrado na última página concluída. Em caso de erro,
o comando sai com código 1 e imprime somente o cursor seguro da última página
confirmada; corrija a causa no ambiente e reexecute a partir desse cursor.
Também é seguro reiniciar do começo, pois os aliases existentes não são
duplicados. Não libere o fluxo que depende da busca até a prévia final mostrar
`missing: 0`.

O comando usa apenas identidades `whatsapp` com telefone `confirmed`. O
normalizador descarta o identificador sintético atual do chat do site. Se o
formato ou o canal desse identificador mudar, revise o filtro antes de repetir
o backfill.
