# Política de segurança

## Versões suportadas

O CRM Silmer ainda está em desenvolvimento. Somente o conteúdo da branch
`master` recebe correções de segurança.

## Como reportar uma vulnerabilidade

Use **Security > Report a vulnerability** neste repositório. Esse canal cria um
advisory privado visível apenas para o mantenedor e evita expor detalhes antes
da correção.

Não abra issue, discussion ou pull request público com:

- credenciais, tokens, chaves ou dados pessoais;
- payloads reais de WhatsApp, IA, storage ou banco;
- instruções completas para explorar uma falha ainda não corrigida.

Inclua somente o mínimo necessário: impacto, componente, passos de reprodução
com dados sintéticos e, quando possível, uma mitigação sugerida. O mantenedor
acusará recebimento em até 3 dias úteis e coordenará correção e divulgação pelo
advisory privado.

Segredos expostos devem ser revogados e rotacionados imediatamente; removê-los
do Git não é suficiente.
