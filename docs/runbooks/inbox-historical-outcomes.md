# Investigação dos resultados históricos de envio

Data: 03/11/2026. OPS-INBOX-ACK-03 / MSG-02–03, ORC-08 e INT-2.
Continuidade da [reconciliação da fila](inbox-delivery-feedback.md).

## Resultado desta investigação

Nenhum dos 13 comandos antigos atingiu prova suficiente para mudar de estado.
Todos permaneceram `outcome_unknown`, sem retry autorizado. A assinatura do
conjunto de IDs técnicos, estados e códigos de erro permaneceu igual à
conferência anterior. Não houve reenvio, alteração de workflow, inicialização
do WAHA nem resolução administrativa dos grupos de incidentes.

As consultas remotas usaram transações somente leitura e saídas limitadas a
metadados. Conteúdo, destinatários, credenciais e envelopes não integram este
registro. Alterações de outros trabalhos no checkout foram preservadas.

## Fontes verificadas

| Universo                             | Evidência disponível                                                                                                                                                                                                                                                                                                     | Limite para reconciliação                                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12 comandos da fase WAHA             | Reservas do CRM com versão lógica `waha-webjs-1`; um também possui `message.send.unknown`. Sem ID externo ou tentativa de provedor registrada para esses comandos.                                                                                                                                                       | A reserva comprova chegada ao workflow, não execução ou rejeição pelo gateway.                                                                                                                                |
| Comando de 28/10 às 12h55, São Paulo | Reserva e resultado incerto da mesma execução; o destinatário cifrado, validado em memória sem exposição, tinha o prefixo incompatível com o adapter antigo. O runbook registra a correção dessa validação antes do HTTP.                                                                                                | O n8n não conserva a execução nem a versão histórica exata que a executou. A versão lógica é compartilhada por revisões diferentes. Compatibilidade com o defeito não substitui prova individual de rejeição. |
| Comando de 30/10 às 09h32, São Paulo | Timeout CRM sem reserva ou callback. Evolution conserva registros na janela consultada: dois envios anteriores ao comando e duas entradas próximas ao instante.                                                                                                                                                          | Esses registros não identificam o comando incerto. Horário semelhante ou ausência de outro envio não prova resultado.                                                                                         |
| Histórico n8n                        | A tabela de versões conserva somente a revisão de 01/11 para o principal. Execuções antigas consultadas não estão em `execution_entity`; dados e metadados da execução de 28/10 também não estão preservados. O histórico de publicação possui ativações/desativações, com referências de versão nulas na janela antiga. | Não há vínculo recuperado entre execução antiga e código publicado exato. Ausência de registro não comprova ausência de execução.                                                                             |
| Backups locais                       | Exports de workflow e credenciais cifradas preservados em `var/waha/` e `var/evolution/`; snapshots com persistência de execuções desabilitada e sem dados fixados.                                                                                                                                                      | Preservam configuração e código, não resultados individuais dos 13 comandos. A captura de envio bem-sucedido pertence a uma resposta posterior distinta.                                                      |
| WAHA desligado                       | Volumes preservados; a consulta de logs pelo conector retorna HTTP 400 e o painel não apresentou registros correlacionáveis. Nenhum backup de volume está listado no painel.                                                                                                                                             | O material privado de recuperação dentro do volume ainda requer inspeção offline. Não foi montado em outro serviço nem usado para iniciar sessão.                                                             |

## Evidência que ainda pode encerrar um caso

É necessário obter um resultado do provedor ou registro histórico diretamente
vinculado ao comando, mensagem ou execução, com identidade de transporte e
resultado inequívocos. Para a pista de validação anterior ao HTTP, é necessário
recuperar também o vínculo com a revisão exata executada ou um erro individual
persistido que demonstre que o efeito externo não começou.

O próximo material possível é o perfil privado de recuperação do WAHA,
preservado em seu volume. Sua inspeção precisa ocorrer offline, por acesso de
leitura ao arquivo ou a uma cópia protegida, sem iniciar Chromium, autenticar
a conta, publicar um serviço de arquivos ou montar o perfil em um gateway ativo.
Não restaurar banco ou serviço sobre produção para procurar essa evidência.

Enquanto isso, conservar os 13 resultados incertos e os grupos em análise.
`failed` não pode ser inferido de timeout, desconexão posterior, ausência de
callback, política de retenção ou proximidade temporal com outro envio.

## Verificação e continuidade

A leitura final contou 13 comandos no recorte histórico, 13 ainda incertos
e zero com retry autorizado, com a mesma assinatura de estado anterior.
Não foram necessários testes de envio, alterações de código ou migrations.
Este registro documenta o limite da evidência acessível; não encerra os
resultados que continuam desconhecidos.
