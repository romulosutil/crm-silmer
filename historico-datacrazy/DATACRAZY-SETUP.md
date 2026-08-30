# Datacrazy — Automação "Vendedor Silmer" (SDR WhatsApp → Vendedor humano)

> **ARQUIVADO em 29/08/2026.** O projeto decidiu sair completamente do Datacrazy — este CRM
> foi abandonado, não haverá convivência nem migração parcial. Este documento fica só como
> registro histórico da configuração técnica que existiu. Não use como referência para o
> desenvolvimento do CRM próprio — ver `CRM-MVP-ESPECIFICACAO.md` na raiz do repo.

---

Checkpoint de implementação — 12/08/2026
CRM: https://crm.datacrazy.io — conta Silmer (e-mail removido da versão pública)

## Fluxo desenhado

```
Cliente no WhatsApp (número operacional removido da versão pública)
   │
   ├─ Agente IA "Vendedor Silmer" (SDR) — qualifica em 6 perguntas essenciais
   │     ├─ tool: Listar Leads / Criar Lead
   │     ├─ tool: Definir Campo Adicional do Lead  ×13  (briefing estruturado)
   │     ├─ tool: Criar Negócio  → pipeline "Vendas Estamparia" / etapa "Qualificado pela IA"
   │     └─ tool: Adicionar Tag ao Lead → "IA - Qualificado" (+ Varejo/Atacado/Precisa de Arte)
   │
   ├─ Comportamento nativo "Transferir atendente" (Aleatorizar)
   │     └─ distribui entre atendentes A e B; IA sai da conversa
   │
   └─ Automação "Lead Qualificado - Briefing para Vendedor"  (gatilho: tag IA - Qualificado)
         ├─ Adiciona comentário no lead com o Resumo do Briefing
         └─ Cria atividade "Atender lead qualificado pela IA" (Tarefa, prioridade Alta)
```

## O que já está configurado

### Campos adicionais de lead (13 novos)
Tipo de Peça · Tecido · Cor da Peça · Grade de Tamanhos · Quantidade de Peças (número) ·
Técnica de Estampa · Situação da Arte · Locais de Estampa · Prazo Desejado ·
Finalidade do Pedido · Perfil de Compra · Entrega ou Retirada · Resumo do Briefing

### Tags (4 novas)
`IA - Qualificado` (verde — GATILHO da automação) · `Atacado` · `Varejo` · `Precisa de Arte`

### Pipeline "Vendas Estamparia"
Novo Contato (IA) → Qualificado pela IA → Orçamento Enviado → Negociação → Aprovado - Produção
URL operacional removida da versão pública.

### Agente "Vendedor Silmer"
URL operacional removida da versão pública.

- **Instruções**: reescritas (5.507 chars). Persona capixaba, missão SDR, roteiro de 6 essenciais +
  6 complementares, guia técnico de estampa, passo a passo de registro no CRM, regras de transferência,
  restrições (NUNCA fala preço/prazo/mínimo), estilo WhatsApp curto.
- **Ferramentas vinculadas (11)**: Listar Leads · Criar Lead · Atualizar Informações do Lead ·
  Atualizar Notas do Lead · Definir Campo Adicional do Lead · Listar Campos Adicionais de Lead ·
  Adicionar Tag ao Lead · Listar Tags · Criar Negócio · Listar Pipelines · Listar Etapas da Pipeline
- **Comportamentos**: Finalizar conversa ON · Transferir atendente ON (destinos: atendentes A e B,
  modo Aleatorizar) · Follow-up automático 15 min / máx 2 · Emojis ON · Dividir mensagens longas ON
- **Configurações**: delay 5s · 50 mensagens de contexto · limite 12 interações da IA por atendimento
  (na 13ª ela se despede e transfere) · apenas atendimento atual ON · saudação automática ON
- **Conhecimento**: base "Silmer Camisetas - Base Institucional e Tecnica" vinculada, 1 arquivo

### Base de conhecimento
Arquivo `silmer-base-conhecimento.txt` com: dados da empresa, endereço/telefones oficiais,
catálogo de peças, guia completo das 5 técnicas de estampa (quando indicar cada uma), tabela de tecidos,
lista do que a IA NÃO pode responder + resposta padrão, FAQ com respostas autorizadas,
e checklist "PENDENTE — a Silmer precisa preencher".

### Automação
`Lead Qualificado - Briefing para Vendedor` — **ATIVA**
URL operacional removida da versão pública.
Gatilho: Tag adicionada ao lead = `IA - Qualificado`
Ações: Adicionar comentário no lead (com variável Resumo do Briefing) + Criar atividade (Tarefa, Alta)
Limite do plano: 8 automações — 3 em uso (Boas-vindas e Vendas estão desativadas).

## BLOQUEADORES (não resolvidos)

1. **Conexão WhatsApp — não existe nenhuma (0 conexões).** Decisão do cliente. Passo a passo abaixo.
   **Enquanto não houver conexão, nada roda ponta a ponta e não dá nem pra testar** — o Chat ao vivo
   não permite simular conversa sem canal.

2. **3º vendedor não existe.** Só os atendentes A e B estão cadastrados. Nomes e
   e-mails foram removidos da versão pública. Roteamento hoje é 50/50.
   Nome e telefone do terceiro ainda não definidos.

3. **Aviso ao vendedor: decidido que dentro do CRM basta.** Conversa transferida para a caixa dele
   no Multiatendimento + comentário no lead com o briefing + tarefa de prioridade Alta no nome dele.
   Nenhum bloco nativo de automação envia mensagem para telefone arbitrário; se um dia quiserem
   ping no WhatsApp pessoal, dá pra fazer com o bloco **API** chamando o próprio CRM
   ("Buscar ou Criar Conversa por Telefone" + "Enviar Mensagem") — depois que a conexão existir.

---

# PASSO A PASSO — Conectar a Crazy API (quando o cliente aprovar)

**Custo: R$ 59,90/mês por conexão.** O plano atual tem 0/0 conexões Crazy API contratadas.

### ATENÇÃO — definir qual número vai hospedar o agente
Há uma ambiguidade a resolver antes de escanear o QR:
- O **canal público da empresa** aparece como WhatsApp da Silmer (Instagram, guias,
  buscadores). É para ele que o cliente manda mensagem hoje.
- Um **canal dedicado** foi indicado para o agente de IA. Os números operacionais
  foram removidos da versão pública.

O QR precisa ser escaneado no aparelho do número que **recebe as mensagens dos clientes**.
Se o site/Instagram/Google apontam para o canal público, é esse que deve ser conectado — senão o
agente fica ligado num número que ninguém aciona. Se for usar o canal dedicado, atualize antes os
links de WhatsApp do site, Instagram e Google Meu Negócio.

### Passos
1. Entre em **Configurações → Conexões → Criar**.
2. Aba **Whatsapp** → escolha **Crazy API** (marcada como Recomendado).
3. Preencha **Nome da conexão**: `WhatsApp Silmer - Agente IA`.
4. Role até o bloco **Conexões Crazy API**. No campo `Conexões`, clique no `+` até chegar em **1**.
   O RESUMO DO PEDIDO vai mostrar `1 × R$ 59,90` e **Total mensal R$ 59,90**.
5. Clique em **Adquirir** e conclua o pagamento.
6. Volte ao formulário e clique em **Finalizar**. A conexão aparece na lista de Conexões.
7. Abra a conexão criada → vai aparecer o **QR Code**.
8. No celular do número escolhido: **WhatsApp → Configurações → Aparelhos conectados →
   Conectar um aparelho** → escaneie o QR. O QR expira em segundos; se expirar, gere outro.
9. Status da conexão deve virar **conectado / online**.
10. Volte no agente **Vendedor Silmer** e confirme que ele está atrelado a essa conexão
    (aba Configurações do agente ou a própria conexão — o vínculo canal↔agente é feito aqui).
11. Verifique as abas **Limites** e **Intervalos** da conexão: elas controlam volume de disparo e
    delay entre mensagens. Deixe intervalos humanizados para reduzir risco de bloqueio.

### Cuidados com a Crazy API (WhatsApp não-oficial)
- Número novo ou com pouco histórico + volume alto de mensagens = risco real de banimento.
- Faça aquecimento: comece com poucas conversas por dia e aumente gradualmente.
- Nunca use para disparo em massa. Só atendimento reativo, que é o caso aqui.
- Se banimento for inaceitável para o negócio, a alternativa é a **WhatsApp Cloud API oficial**
  (Meta Business + número verificado + custo por conversa pago à Meta), bem mais estável.

### Alternativas sem o custo da Crazy API
- **Evolution API** — grátis do lado Datacrazy, mas exige um servidor Evolution rodando
  (VPS/Docker). No cadastro pedem: URL da instância, Nome da instância e Chave de API.
- **Uazapi** / **Z-API** — serviços terceiros pagos, mesma lógica de credenciais.

---

# CHAT NA LANDING PAGE — o que existe e o que falta

**Resposta curta: NÃO está configurado, e o Datacrazy não tem um widget de chat pronto pra colar
no site.** Não existe "copie este script" nesta instalação. Os canais nativos são Whatsapp,
Instagram e Messenger.

O caminho é a **Conexão Universal (Beta)** — `Configurações → Conexões → Criar → Universal`.
Ela conecta qualquer API HTTP/REST para enviar e receber mensagens. Ou seja: o widget e a ponte
são **código seu**; o Datacrazy entra como cérebro (agente + CRM).

### Arquitetura necessária

```
Widget de chat na landing page (React/JS)
        │  POST /chat  { sessionId, nome, mensagem }
        ▼
Backend seu (Next.js API route / Vercel Function)
        │
        ├─ recebe do widget → POST no WEBHOOK DE RECEBIMENTO da Conexão Universal
        │                      (leva a mensagem para dentro do Datacrazy)
        │
        └─ expõe um endpoint /send que o Datacrazy chama quando o agente responde
                              (Envio → URL Base + POST /send)
        │
        ▼
Widget faz polling ou SSE/WebSocket no seu backend para exibir a resposta
```

### O que a Conexão Universal pede

**Aba Envio** (Datacrazy → seu backend, quando o agente responde):
- URL Base — ex.: `https://seusite.com.br/api/datacrazy`
- Método + Caminho — ex.: `POST` `/send`
- Template do Body (JSON), com as variáveis disponíveis:
  `${contact.contactId}`, `${contact.name}`, `${message.body}`, `${credentials.xxx}`
- Content-Type, Timeout (padrão 30000 ms)
- Autenticação, Credenciais (tokens ficam guardados e são referenciados por `${credentials.nome}`)
- Headers e Query Params customizados
- Mapeamento de Resposta: Caminho do ID da Mensagem e Caminho do Sucesso
- Endpoints Adicionais para mídia/documentos

**Aba Recebimento** (seu backend → Datacrazy, quando o visitante escreve):
- Habilitar recebimento de mensagens
- Mapeamento por JSON-path: Caminho do ID do Contato (`from`), Corpo da Mensagem (`text`),
  ID da Mensagem (`message_id`), Nome do Contato (`from_name`), Timestamp, ID Externo,
  URL do Anexo, Tipo do Anexo, From Me
- Validação do Webhook: Header de Assinatura + Algoritmo + Segredo de Validação (use isso —
  sem assinatura qualquer um posta mensagens falsas no seu CRM)
- Filtros: Campo Obrigatório e Ignorar Mensagens Próprias

### Ponto de atenção do fluxo no site
O agente hoje identifica o lead pelo **telefone da conversa**. No site não existe telefone.
Duas saídas:
1. **Pedir WhatsApp no início do chat** (recomendado) — o widget coleta nome + WhatsApp antes de
   liberar a conversa, e manda como `contactId`. Aí o lead nasce igual ao do WhatsApp, cai na mesma
   pipeline, e o vendedor continua o atendimento no WhatsApp do cliente. Continuidade perfeita.
2. **Usar o sessionId como contactId** — funciona, mas cria lead sem telefone e o vendedor não
   consegue dar sequência fora do site. Só serve se o objetivo for tirar dúvida, não gerar lead.

### Ajuste necessário no prompt do agente
Se o mesmo agente atender site e WhatsApp, o prompt precisa de um bloco de canal:
no site ele deve **pedir nome e WhatsApp antes de qualificar**, e a frase de transferência muda
("nosso vendedor vai te chamar no WhatsApp que você passou").
Alternativa mais limpa: **duplicar o agente** ("Vendedor Silmer - Site") com esse ajuste,
mantendo as mesmas ferramentas, base de conhecimento e comportamentos.

### Esforço estimado
Backend ponte + widget + testes: é um trabalho de desenvolvimento, não de configuração de CRM.
Ordem sugerida: **primeiro** faça o WhatsApp funcionar ponta a ponta (valida prompt, tools,
briefing e transferência), **depois** reaproveite tudo no site. O contrário dobra o retrabalho.

## Pendências de conteúdo (a Silmer precisa fornecer)

- [ ] Tabela de preços por técnica e faixa de quantidade
- [ ] Quantidade mínima por técnica
- [ ] Prazo de produção padrão e de urgência
- [ ] Política e custo de criação de arte
- [ ] Formas de pagamento e parcelamento
- [ ] Política de entrega (cidades, frete, prazo)
- [ ] Horário de funcionamento
- [ ] Catálogo de cores e grade de tamanhos por peça
- [ ] Política de troca e devolução

## A validar no primeiro teste real

- Se o modo "Aleatorizar atendente" realmente alterna entre os 2 vendedores.
- Se o agente executa as tools na ordem certa (lead → campos → negócio → tag) antes de transferir.
- Se o campo "Resumo do Briefing" chega preenchido no comentário e na atividade.
- Se o limite de 12 interações é suficiente para o roteiro de 6 perguntas.

## Próximos passos, em ordem

1. Cliente aprova os R$ 59,90/mês → contratar a Crazy API e escanear o QR (seção acima).
   **Antes**, decidir se o canal público ou o dedicado hospeda o agente.
2. Teste ponta a ponta: mandar mensagem como cliente, conferir se o agente qualifica,
   preenche os 13 campos, cria o negócio, marca a tag e transfere.
3. Conferir se o comentário e a tarefa chegaram com o Resumo do Briefing preenchido.
4. Preencher a base de conhecimento com preço, prazo, mínimo e pagamento (checklist acima).
5. Cadastrar o 3º vendedor e incluí-lo nos atendentes destino.
6. Só então partir para o chat da landing page (Conexão Universal + backend ponte).
