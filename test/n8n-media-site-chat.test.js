import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const workflowSnapshot = new URL(
  '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json',
  import.meta.url,
);

/** @returns {Promise<any>} */
async function canonical() {
  return JSON.parse(await readFile(workflowSnapshot, 'utf8'));
}

/** @param {string} name */
async function code(name) {
  const workflow = await canonical();
  const node = workflow.nodes.find(
    (/** @type {any} */ candidate) => candidate.name === name,
  );
  assert.ok(node, name);
  return /** @type {string} */ (node.parameters.jsCode);
}

/**
 * Runs a "run once for each item" Code node. Upstream nodes are given as
 * `{ json, binary }`; a node left out was not executed, so `$(name)` throws
 * the way n8n does.
 *
 * @param {string} jsCode
 * @param {{json?: any, binary?: any}} item
 * @param {Record<string, {json?: any, binary?: any}>} [upstream]
 */
function run(jsCode, item, upstream = {}) {
  const result = vm.runInNewContext(`(() => {\n${jsCode}\n})()`, {
    $json: item.json ?? {},
    $input: { item: { json: item.json ?? {}, binary: item.binary } },
    $: (/** @type {string} */ name) => {
      if (!(name in upstream)) throw new Error(`unexecuted node ${name}`);
      return { item: upstream[name] };
    },
    $execution: { id: '42' },
  });
  return JSON.parse(JSON.stringify(result));
}

/** @param {any} message @param {any} [extra] */
function whatsApp(message, extra = {}) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: 'phone-1' },
              contacts: [{ profile: { name: 'Ana' }, wa_id: '5541999990000' }],
              messages: [
                {
                  from: '5541999990000',
                  id: 'wamid.1',
                  timestamp: '1791400000',
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
    ...extra,
  };
}

test('stores every WhatsApp message type the CRM knows, and reads image and audio (ADR 026)', async () => {
  const normalize = await code('Normalizar evento WhatsApp (MVP)');
  /** @param {any} message @param {any} [binary] */
  const normalized = (message, binary) =>
    run(normalize, { json: whatsApp(message), binary }).json;

  const text = normalized({ type: 'text', text: { body: 'Oi' } });
  assert.equal(text.channel, 'whatsapp');
  assert.equal(text.ai_readable, true);
  assert.equal(text.media_source, '');

  const audio = normalized({
    type: 'audio',
    audio: { id: 'media-1', mime_type: 'audio/ogg; codecs=opus' },
  });
  assert.deepEqual(
    [
      audio.message_type,
      audio.media_kind,
      audio.media_source,
      audio.ai_readable,
    ],
    ['audio', 'audio', 'whatsapp', true],
  );
  assert.equal(audio.media_id, 'media-1');

  const image = normalized({
    type: 'image',
    image: { id: 'media-2', mime_type: 'image/jpeg', caption: 'minha logo' },
  });
  assert.deepEqual(
    [image.media_kind, image.media_source, image.text],
    ['image', 'whatsapp', 'minha logo'],
  );

  // A sticker is stored as an image but never sent to the model as one.
  const sticker = normalized({
    type: 'sticker',
    sticker: { id: 'media-3', mime_type: 'image/webp' },
  });
  assert.deepEqual(
    [
      sticker.message_type,
      sticker.media_kind,
      sticker.text,
      sticker.ai_readable,
    ],
    ['image', '', '[figurinha]', true],
  );
  assert.equal(sticker.media_id, 'media-3');

  const place = normalized({
    type: 'location',
    location: { latitude: -25.4, longitude: -49.2, name: 'Loja' },
  });
  assert.equal(place.message_type, 'text');
  assert.match(place.text, /^Localização enviada: Loja - -25\.4, -49\.2$/u);

  const card = normalized({
    type: 'contacts',
    contacts: [
      {
        name: { formatted_name: 'Bia' },
        phones: [{ phone: '+55 41 3333-0000' }],
      },
    ],
  });
  assert.equal(card.text, 'Contato compartilhado: Bia +55 41 3333-0000');
  assert.equal(card.ai_readable, true);

  // An unknown type reaches the CRM as text and a seller, never the model.
  const poll = normalized({ type: 'unsupported' });
  assert.deepEqual([poll.message_type, poll.ai_readable], ['text', false]);

  for (const type of ['reaction', 'system', 'request_welcome']) {
    assert.equal(normalized({ type }).event_kind, 'ignore', type);
  }
});

test('the site chat enters as a WhatsApp identity that can never be a real number (ADR 026)', async () => {
  const build = await code('Site - Montar evento do chat (MVP)');
  const normalize = await code('Normalizar evento WhatsApp (MVP)');
  /** @param {any} json @param {any} [binary] */
  const event = (json, binary) => run(build, { json, binary });

  const first = event({
    sessionId: 'session-a',
    chatInput: '  Quero 30 camisetas ',
  });
  const again = event({ sessionId: 'session-a', chatInput: 'Brancas' });
  const other = event({ sessionId: 'session-b', chatInput: 'Oi' });
  const value = first.json.entry[0].changes[0].value;
  const waId = value.contacts[0].wa_id;

  // The CRM accepts it as E.164, 999 is never assigned, and it is per session.
  assert.match(waId, /^999[0-9]{12}$/u);
  assert.match(waId, /^[1-9][0-9]{7,14}$/u);
  assert.equal(again.json.entry[0].changes[0].value.contacts[0].wa_id, waId);
  assert.notEqual(other.json.entry[0].changes[0].value.contacts[0].wa_id, waId);
  assert.equal(value.contacts[0].profile.name, 'Visitante do site');
  assert.equal(value.metadata.phone_number_id, 'site-chat');
  assert.deepEqual(value.messages[0].text, { body: 'Quero 30 camisetas' });
  assert.equal(first.json.__channel, 'site_chat');

  const normalized = run(normalize, { json: first.json }).json;
  assert.deepEqual(
    [normalized.channel, normalized.from, normalized.ai_readable],
    ['site_chat', waId, true],
  );

  // An uploaded file is the message; the binary goes along for the model.
  const file = {
    mimeType: 'audio/webm',
    fileName: 'gravacao.webm',
    fileSize: '120 kB',
  };
  const withAudio = event(
    { sessionId: 'session-a', chatInput: '' },
    { data0: file },
  );
  const audioMessage = withAudio.json.entry[0].changes[0].value.messages[0];
  assert.equal(audioMessage.type, 'audio');
  assert.equal(audioMessage.audio.mime_type, 'audio/webm');
  assert.deepEqual(withAudio.binary, { data: file });
  const audio = run(normalize, withAudio).json;
  assert.deepEqual(
    [audio.media_kind, audio.media_source, audio.ai_readable],
    ['audio', 'upload', true],
  );

  assert.throws(
    () => event({ sessionId: 'session-a', chatInput: ' ' }),
    /SITE_CHAT_MESSAGE_REQUIRED/u,
  );
  assert.throws(
    () => event({ chatInput: 'Oi' }),
    /SITE_CHAT_SESSION_REQUIRED/u,
  );
});

test('media is prepared under the CRM limits with the extension the model needs', async () => {
  const prepare = await code('Preparar mídia para a IA (MVP)');
  const source = (/** @type {any} */ extra) => ({
    'Normalizar evento WhatsApp (MVP)': {
      json: {
        media_kind: 'audio',
        media_source: 'whatsapp',
        media_mime_type: 'audio/ogg; codecs=opus',
        ...extra,
      },
    },
  });
  const voice = run(
    prepare,
    {
      binary: { data: { mimeType: 'application/octet-stream', fileName: 'x' } },
    },
    {
      ...source({}),
      'WhatsApp - Consultar mídia (MVP)': { json: { file_size: 20000 } },
    },
  );
  assert.deepEqual(voice.json, { media_kind: 'audio' });
  assert.deepEqual(
    [voice.binary.data.mimeType, voice.binary.data.fileName],
    ['audio/ogg', 'audio.ogg'],
  );

  assert.throws(
    () =>
      run(
        prepare,
        { binary: { data: { mimeType: 'image/jpeg' } } },
        {
          ...source({ media_kind: 'image', media_mime_type: 'image/jpeg' }),
          'WhatsApp - Consultar mídia (MVP)': {
            json: { file_size: 6 * 1024 * 1024 },
          },
        },
      ),
    /MEDIA_TOO_LARGE/u,
  );
  // AAC and AMR voice notes cannot be transcribed: the model gets them as unread.
  assert.throws(
    () =>
      run(
        prepare,
        { binary: { data: { mimeType: 'audio/aac' } } },
        source({ media_mime_type: 'audio/aac' }),
      ),
    /MEDIA_TYPE_UNSUPPORTED/u,
  );
  // A site upload is read from the normalizer, which carries the binary.
  const upload = run(
    prepare,
    { json: {} },
    {
      'Normalizar evento WhatsApp (MVP)': {
        json: {
          media_kind: 'image',
          media_source: 'upload',
          media_mime_type: 'image/png',
        },
        binary: { data0: { mimeType: 'image/png', fileSize: '1.2 MB' } },
      },
    },
  );
  assert.equal(upload.binary.data.fileName, 'image.png');
});

test('the model gets the transcript as the message and the image as binary (ADR 026)', async () => {
  const context = await code('Montar contexto da IA (MVP)');
  const inbound = {
    conversation_id: 'conversation-1',
    automation_epoch: 1,
    source_revision: 3,
    automation_message_count: 2,
    automation_message_cap: 15,
    sellers: [],
    briefing: {},
    recent_messages: [],
  };
  /** @param {any} source @param {any} item @param {any} [extra] */
  const build = (source, item, extra = {}) =>
    run(context, item, {
      'CRM - Registrar inbound (MVP)': { json: inbound },
      'Normalizar evento WhatsApp (MVP)': {
        json: {
          from: '5541999990000',
          phone_number_id: 'phone-1',
          customer_name: 'Ana',
          channel: 'whatsapp',
          ...source,
        },
      },
      ...extra,
    });

  const audio = build(
    { message_type: 'audio', media_kind: 'audio', text: '' },
    { json: { text: 'Quero 20 bonés pretos' } },
    {
      'OpenAI - Transcrever áudio (MVP)': {
        json: { text: ' Quero 20 bonés pretos ' },
      },
    },
  );
  assert.equal(audio.json.current_text, 'Quero 20 bonés pretos');
  assert.match(
    audio.json.prompt,
    /^Mensagem atual do cliente \(áudio transcrito\): Quero 20 bonés pretos$/mu,
  );
  assert.equal(audio.json.conversation_id, 'conversation-1');
  assert.equal(audio.binary, undefined);

  const picture = { data: { mimeType: 'image/jpeg', fileName: 'image.jpg' } };
  const image = build(
    { message_type: 'image', media_kind: 'image', text: 'essa é a logo' },
    { json: { media_kind: 'image' }, binary: picture },
  );
  assert.deepEqual(image.binary, picture);
  assert.match(
    image.json.prompt,
    /imagem anexada, com a legenda\): essa é a logo/u,
  );

  const unread = build(
    { message_type: 'audio', media_kind: 'audio', text: '' },
    { json: { media_kind: 'audio', media_unreadable: true } },
  );
  assert.match(unread.json.prompt, /um áudio que não consegui abrir/u);

  // The site chat has no profile name to suggest.
  const site = build(
    {
      message_type: 'text',
      text: 'Oi',
      customer_name: 'Visitante do site',
      channel: 'site_chat',
    },
    { json: inbound },
  );
  assert.equal(site.json.channel, 'site_chat');
  assert.equal(site.json.profile_name, '');
  assert.match(site.json.prompt, /Canal: chat do site da Silmer/u);
  assert.doesNotMatch(site.json.prompt, /Visitante do site/u);

  const workflow = await canonical();
  const agent = workflow.nodes.find(
    (/** @type {any} */ node) => node.name === 'Atendente virtual Silmer (MVP)',
  );
  assert.equal(agent.parameters.options.passthroughBinaryImages, true);
  assert.match(agent.parameters.options.systemMessage, /IMAGENS E ÁUDIOS/u);
  assert.match(
    agent.parameters.options.systemMessage,
    /Nunca descreva pessoas/u,
  );
});

test('on the site chat every handoff notice asks for a WhatsApp instead of "aqui mesmo" (ADR 026)', async () => {
  const decision = await code('Normalizar decisão da IA (MVP)');
  /** @param {any} output @param {string} channel @param {string} [text] */
  const decide = (output, channel, text = '') =>
    run(
      decision,
      {
        json: {
          output: {
            reply_text: 'Resposta',
            briefing_patch: {},
            answer_status: 'none',
            person_request: 'none',
            ...output,
          },
        },
      },
      {
        'Montar contexto da IA (MVP)': {
          json: {
            conversation_id: 'conversation-1',
            briefing: {},
            recent_messages: [],
            current_text: text,
            profile_name: '',
            sellers: ['Marina'],
            message_cap: 15,
            turn: 3,
            crm_counter: true,
            channel,
          },
        },
      },
    ).json;

  const cases = [
    { asks_price: true },
    { person_request: 'generic' },
    {
      person_request: 'named',
      requested_seller: 'Marina',
      requested_person_name: 'Marina',
    },
    { external_context: true },
    { handoff_required: true, handoff_reason: 'complaint' },
    { handoff_required: true, handoff_reason: 'urgency' },
    { foreign_language: true },
  ];
  for (const output of cases) {
    const text = output.requested_seller ? 'quero falar com a marina' : '';
    const whatsapp = decide(output, 'whatsapp', text);
    const site = decide(output, 'site_chat', text);
    assert.equal(whatsapp.handoff_required, true, JSON.stringify(output));
    assert.match(whatsapp.reply_text, /aqui mesmo/u);
    assert.doesNotMatch(site.reply_text, /aqui mesmo|right here|,\s*\./u);
    assert.match(site.reply_text, /me diga o seu WhatsApp com DDD\.$/u);
  }
  // A reply that is not a notice is the model's, on both channels.
  assert.equal(decide({}, 'site_chat').reply_text, 'Resposta');
});

test('the site chat shows what the CRM recorded, or that a seller follows on WhatsApp', async () => {
  const answer = await code('Site - Responder no chat (MVP)');
  const reply = run(
    answer,
    { json: {} },
    {
      'CRM - Registrar message.sent da IA (MVP)': { json: { accepted: true } },
      'Preparar reserva de envio da IA (MVP)': {
        json: { reply_text: 'Qual a cor?' },
      },
    },
  );
  assert.equal(reply.json.output, 'Qual a cor?');

  const notice = run(
    answer,
    { json: {} },
    {
      'CRM - Registrar message.sent do aviso (MVP)': {
        json: { accepted: true },
      },
      'Preparar aviso de transferência (MVP)': { json: { text: 'Aviso' } },
    },
  );
  assert.equal(notice.json.output, 'Aviso');

  const stale = run(
    answer,
    { json: {} },
    { 'Montar contexto da IA (MVP)': { json: {} } },
  );
  assert.equal(stale.json.output, 'Recebi a sua mensagem!');

  const withSeller = run(answer, { json: {} });
  assert.match(withSeller.json.output, /pelo WhatsApp/u);
});

test('a seller message to a site chat visitor never leaves n8n (ADR 026)', async () => {
  const normalize = await code('Normalizar comando do painel (MVP)');
  /** @param {string} to */
  const kind = (to) =>
    run(normalize, {
      json: {
        headers: { 'idempotency-key': 'command-1' },
        body: {
          schema_version: '1.0',
          command_id: 'command-1',
          action: 'send_message',
          to,
          message: { type: 'text', text: 'Olá' },
        },
      },
    }).json.kind;
  assert.equal(kind('+999012345678901'), 'site_chat');
  assert.equal(kind('999012345678901'), 'site_chat');
  assert.equal(kind('+5541999990000'), 'send');

  const workflow = await canonical();
  const route = workflow.connections['Rotear comando do painel (MVP)'].main;
  assert.deepEqual(
    route[2].map((/** @type {any} */ edge) => edge.node),
    ['Recusar envio ao chat do site (MVP)'],
  );
  const refusal = workflow.nodes.find(
    (/** @type {any} */ node) =>
      node.name === 'Recusar envio ao chat do site (MVP)',
  );
  assert.equal(refusal.parameters.options.responseCode, 422);
});

test('the public site chat is wired into the same path and answers last (ADR 026)', async () => {
  const workflow = await canonical();
  const byName = new Map(
    workflow.nodes.map((/** @type {any} */ node) => [node.name, node]),
  );
  /** @param {string} source @param {number} [output] */
  const targets = (source, output = 0) =>
    (workflow.connections[source]?.main?.[output] ?? []).map(
      (/** @type {any} */ edge) => edge.node,
    );

  const chat = byName.get('Site - Receber mensagem do chat (MVP)');
  assert.equal(chat.type, '@n8n/n8n-nodes-langchain.chatTrigger');
  assert.equal(chat.parameters.public, true);
  assert.equal(chat.parameters.mode, 'webhook');
  assert.equal(
    chat.parameters.options.allowedOrigins,
    'https://silmer.com.br,https://www.silmer.com.br',
  );
  assert.equal(
    chat.parameters.options.allowedFilesMimeTypes,
    'image/*,audio/*',
  );
  assert.equal(chat.parameters.options.responseMode, 'lastNode');
  assert.deepEqual(targets(chat.name), ['Site - Montar evento do chat (MVP)']);
  assert.deepEqual(targets('Site - Montar evento do chat (MVP)'), [
    'Normalizar evento WhatsApp (MVP)',
  ]);

  // Readable messages go through the media step before the model.
  assert.deepEqual(targets('Rotear conversa registrada (MVP)', 0), [
    'Ler mídia da mensagem? (MVP)',
  ]);
  assert.deepEqual(targets('Ler mídia da mensagem? (MVP)', 2), [
    'Montar contexto da IA (MVP)',
  ]);
  for (const name of [
    'WhatsApp - Consultar mídia (MVP)',
    'WhatsApp - Baixar mídia (MVP)',
    'Preparar mídia para a IA (MVP)',
    'OpenAI - Transcrever áudio (MVP)',
  ]) {
    assert.equal(byName.get(name).onError, 'continueErrorOutput', name);
    assert.deepEqual(targets(name, 1), ['Marcar mídia não lida (MVP)'], name);
  }
  assert.equal(
    byName.get('WhatsApp - Consultar mídia (MVP)').parameters
      .nodeCredentialType,
    'whatsAppApi',
  );
  assert.equal(
    byName.get('OpenAI - Transcrever áudio (MVP)').parameters
      .nodeCredentialType,
    'openAiApi',
  );

  // Under executionOrder v1 the site answer runs before any sibling branch, so
  // a later branch never becomes the chat's last node.
  const gate = 'Responder no chat do site? (MVP)';
  const parents = Object.entries(workflow.connections)
    .filter(([, groups]) =>
      /** @type {any[]} */ (
        Object.values(/** @type {any} */ (groups)).flat(2)
      ).some((edge) => edge?.node === gate),
    )
    .map(([name]) => name);
  assert.equal(parents.length, 5);
  for (const parent of parents) {
    for (const sibling of /** @type {any[]} */ (
      workflow.connections[parent].main.flat()
    )) {
      if (sibling.node === gate) continue;
      assert.ok(
        byName.get(gate).position[1] < byName.get(sibling.node).position[1],
        `${parent} -> ${sibling.node}`,
      );
    }
  }
  assert.deepEqual(targets(gate), ['Site - Responder no chat (MVP)']);
});
