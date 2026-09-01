# Database module

`npm run db:migrate` applies only forward-compatible `*.expand.sql` files.
Contract migrations require the explicit command
`npm run db:migrate -- --phase contract` after the previous application digest
has left the rollback window.

Migration versions and checksums are immutable. The runner serializes executions
with a PostgreSQL session advisory lock and commits each migration separately.
There is deliberately no down-migration command: normal rollback points the
services to the previous digest while the expanded schema remains compatible.

`0002_phase1_domain.expand.sql` persists the Phase 1 identity, access, audit,
idempotency, configuration and catalog contracts. Published/versioned records
are protected against update, delete and truncate; session, invitation,
recovery and password material is stored only as hashes or encrypted envelopes.

Run the destructive integration fixture only against its dedicated ephemeral
database:

```powershell
$env:TEST_DATABASE_URL='postgres://.../crm_silmer_test'
npm run test:phase1-schema:live
npm run test:configuration-catalog:live
```

O segundo comando cobre T01.5/T01.6 com PostgreSQL real: optimistic locking,
publicação concorrente, auditoria na mesma transação, rollback e snapshots
históricos imutáveis. O banco dedicado é recriado durante o teste.
