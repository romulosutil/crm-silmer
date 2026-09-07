# Ator técnico do n8n

## Escopo

O n8n chama a API do CRM como o ator técnico fixo `AUTOMATION_EXECUTOR`. Essa
identidade não é uma pessoa, não recebe função operacional, não abre sessão de
navegador e não participa das rotas de convite, login, MFA ou concessão de
capacidades.

As únicas ações autorizadas nesta primeira fatia são:

- persistir mensagem canônica normalizada pelo n8n;
- registrar atualização de entrega;
- correlacionar execução e versão do workflow;
- converter uma conversa em Negócio;
- atualizar campos oficiais de um Negócio;
- registrar transição de etapa validada pelo CRM.

Aprovação comercial, administração de identidades, retenção privilegiada e
acesso direto ao PostgreSQL permanecem proibidos. O banco do CRM nunca é
exposto pelo contrato de autenticação técnica.

## Configuração e rotação

O n8n usa autenticação HTTP Basic servidor-a-servidor. O identificador vem de
`CRM_AUTOMATION_CLIENT_ID`; o segredo atual vem de
`CRM_AUTOMATION_CLIENT_SECRET` e precisa ter pelo menos 32 caracteres. Durante
uma rotação controlada, `CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET` pode manter o
segredo anterior válido pelo menor intervalo operacional possível. O runtime
mantém somente hashes SHA-256 para comparação em tempo constante.

Para rotacionar a credencial:

1. gerar um segredo aleatório novo no gerenciador de secrets;
2. copiar temporariamente o segredo atual para
   `CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET` e publicar o novo em
   `CRM_AUTOMATION_CLIENT_SECRET` no CRM;
3. reiniciar a API de forma controlada, atualizar o secret do n8n e executar um
   comando permitido com a nova credencial;
4. remover `CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET` e reiniciar a API;
5. confirmar que a credencial anterior recebe `401` e que a recusa foi
   auditada sem conter o segredo.

O piloto usa uma única instância da API. Uma futura rotação com sobreposição
entre múltiplas instâncias exige contrato próprio; não se mantém token anterior
ativo implicitamente.

## Auditoria e resposta a falhas

Credencial ausente ou inválida retorna `401`. Credencial válida tentando ação
fora da allowlist retorna `403`. As duas recusas geram evento de auditoria com
ação, ator técnico ou origem não autenticada, correlação, alvo fixo e versão da
credencial. Segredo, header bruto, payload, mensagem, contato e outros dados
pessoais não entram no evento.

Falha ao persistir a auditoria também mantém a operação negada. Não existe
fallback para sessão humana, acesso direto ao banco ou permissão implícita.

## Pendência independente

Esta fatia não fecha a issue `#13`. A prova de `ACL-P07-07..11` depende do ciclo
real de Pedido/Ficha, incluindo API e UI acessível, previsto na CRM-3.
