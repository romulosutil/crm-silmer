# Runbook de recovery off-host — T00.3

Este kit gera um plano determinístico sem rede e valida a topologia aprovada.
Ele não provisiona EasyPanel, não altera DNS, não acessa escrow, não restaura
dados e não comprova RPO/RTO. `MSG-03`, `MSG-04` e `PRV-01` são requisitos
indiretamente protegidos pela fronteira operacional, mas não são satisfeitos
por esta entrega.

## Uso offline por uma segunda pessoa

1. Obtenha uma cópia limpa do repositório e instale as dependências do lockfile.
2. Execute `npm run validate:topology`.
3. Execute `npm run test:recovery:mocks`.
4. Execute `npm run recovery:plan` e preserve a saída como checklist preliminar.
5. Confirme o projeto `espectro-mvp`, os quatro serviços `silmer-*` e o gate em
   `ops/easypanel/provisioning-gate.json`; domínios definitivos, DNS e referências
   de escrow continuam `null` e valores permanecem apenas nos sistemas aprovados.
6. Pare aqui se não houver duas pessoas custodiando o escrow ou autorização para
   o drill externo.

Os validadores falham se `silmer-api`, `silmer-worker` ou `silmer-postgres` forem
públicos, se DNS ou segredo ganhar valor no repositório, se uma imagem de
aplicação não estiver presa ao digest aprovado ou se algum adapter deixar o
modo `mock`.

## Execução externa pendente

As etapas seguintes exigem autorização, credenciais e infraestrutura fora do
repositório:

1. Manter o EasyPanel compatível na VPS autorizada.
2. Recriar o projeto compartilhado `espectro-mvp` com `silmer-edge-web`,
   `silmer-api`, `silmer-worker` e `silmer-postgres` conforme
   `ops/easypanel/topology.json`.
3. Recuperar segredos do escrow com duas pessoas, sem registrar valores em logs.
4. Registrar digests atual/anterior e aplicar migrations expand/contract.
5. Manter Meta, IA, storage, telemetria e tombstones em adapters mock durante o
   drill.
6. Restaurar o PostgreSQL isolado, aplicar tombstones e executar smoke sem saída.
7. Testar DNS em subdomínio autorizado, registrar tempos, RPO/RTO e evidências.
8. Destruir o host temporário somente após preservar evidências sem PII.

O restore mensal de PostgreSQL e o drill trimestral de perda total continuam
externos. Somente o drill real em host limpo pode comprovar o RTO do CRM.
