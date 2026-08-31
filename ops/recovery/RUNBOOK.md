# Runbook de recovery off-host — T00.3 / T07.3

Este kit gera um plano determinístico sem rede e valida a topologia aprovada.
Ele não provisiona EasyPanel, não altera DNS, não acessa escrow, não restaura
dados e não comprova RPO/RTO. `MSG-03`, `MSG-04` e `PRV-01` são requisitos
indiretamente protegidos pela fronteira operacional, mas não são satisfeitos
por esta entrega.

O gate versionado em `drill-gate.json` está `blocked`. Esta PR cria validação e
prontidão auditável; ela **não fecha a issue #3**, não substitui o restore mensal
nem o drill trimestral e não comprova RPO de 1 hora ou RTO de 4 horas.
`T00.3` rastreia a origem do kit e do provisionamento; `T07.3` rastreia a
execução e a evidência dos drills reais.

## Pre-flight obrigatório

Antes de qualquer execução externa:

1. Executar `npm run validate:topology` e `npm run test:recovery:mocks` em cópia
   limpa; o gate deve continuar refletindo o estado operacional real.
2. Confirmar backup restaurável no EasyPanel e backup externo independente por
   referências opacas, sem registrar host, IP, PII ou segredo.
3. Confirmar implementação e evidência do ledger de tombstones de `T06.3`, com
   credencial de restore read-only fora do runtime.
4. Confirmar escrow acessível por duas pessoas designadas, sem expor valores.
5. Obter autorização, janela, VPS limpa isolada e subdomínio temporário para o
   drill trimestral; adapters externos permanecem em modo mock.
6. Designar Tech Lead como decisor do gate, DevOps como executor, Backend e
   Privacidade para tombstones, Segurança para escrow e QA para o smoke final.

## Stop conditions

Interrompa antes de provisionar ou restaurar se qualquer condição ocorrer:

- backup restaurável do EasyPanel ausente ou backup externo bloqueado;
- ledger `T06.3` ausente, não verificável ou sem restore read-only;
- menos de dois custodians disponíveis para o escrow;
- tentativa de registrar host, IP, domínio, PII, credencial ou segredo como
  evidência;
- VPS não limpa, reutilização do host de produção ou saída de rede não prevista;
- qualquer adapter externo fora de `mock`;
- digests/migrations incompatíveis ou evidência mensal/trimestral ausente;
- objeto apagado por tombstone reaparecer, smoke falhar ou resultado ficar
  inconclusivo.

Falha ou incerteza mantém `drill-gate.json` em `blocked`; nunca converta uma
execução parcial em `passed`.

## Lacunas, donos e prazo-gate

| Lacuna atual                                              | Dono por papel        | Prazo-gate                     |
| --------------------------------------------------------- | --------------------- | ------------------------------ |
| Nenhum backup restaurável evidenciado no EasyPanel        | DevOps                | Antes do restore mensal        |
| Backup externo bloqueado                                  | DevOps                | Antes do restore mensal        |
| Ledger de tombstones `T06.3` não implementado/evidenciado | Backend + Privacidade | Antes de qualquer restore      |
| Escrow com dois custodians não evidenciado                | DevOps + Segurança    | Antes do drill trimestral      |
| VPS limpa não provisionada/executada                      | DevOps                | Drill trimestral               |
| DNS temporário não testado                                | DevOps                | Drill trimestral               |
| Restore de versão de objeto não executado                 | DevOps + Privacidade  | Drill trimestral               |
| Smoke completo não executado                              | QA                    | Antes da decisão final do gate |

O Tech Lead só pode marcar o gate como `passed` quando todos os checks estiverem
`passed`, não houver blockers e existirem referências opacas separadas para a
evidência mensal e trimestral. A evidência mensal comprova apenas a recuperação
do banco; somente o drill trimestral completo em VPS limpa pode sustentar o RTO
do CRM.

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
