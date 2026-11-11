import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { patchWahaInboundImages } from '../ops/n8n/patch-waha-inbound-images.mjs';
import { createWahaWorkflow } from '../ops/n8n/workflows/create-waha-workflow.mjs';
import {
  createEvolutionWorkflow,
  validateEvolutionEvent,
  convertEvolutionEvent,
} from '../ops/n8n/workflows/create-evolution-workflow.mjs';
import { patchEvolutionInboundAudio } from '../ops/n8n/patch-evolution-inbound-audio.mjs';
import { patchEvolutionInboundImages } from '../ops/n8n/patch-evolution-inbound-images.mjs';
import {
  decodeInboxPdf,
  measureInboxPdf,
  patchEvolutionInboundPdf,
} from '../ops/n8n/patch-evolution-inbound-pdf.mjs';

const baseline = JSON.parse(
  await readFile(
    new URL(
      '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const config = {
  ownNumber: '5511000000000',
  session: 'silmer',
  baseUrl: 'http://gateway:8080',
  apiCredentialId: 'synthetic-api',
  webhookCredentialId: 'synthetic-hook',
};
const waha = createWahaWorkflow(baseline, config);
const inbound = waha.nodes.find(
  (/** @type {any} */ n) => n.name === 'CRM - Registrar inbound (MVP)',
);
inbound.parameters.url =
  'https://crm.invalid/api/v1/integrations/n8n/messages/inbound';
inbound.credentials = { httpBasicAuth: { id: 'synthetic-crm' } };
const evolution = createEvolutionWorkflow(
  patchWahaInboundImages(waha).workflow,
  { ...config, transportBaseline: baseline },
);
const source = patchEvolutionInboundImages(
  patchEvolutionInboundAudio(evolution).workflow,
);
const prefix = 'Inbox - Imagem recebida - ';
const pdf = Buffer.from('%PDF-1.7\nsynthetic\n%%EOF');
const meta = {
  channel: 'whatsapp',
  message_type: 'document',
  media_mime_type: 'application/pdf',
};
const response = {
  mimetype: 'application/pdf',
  base64: pdf.toString('base64'),
};

test('INBOX-PDF-01 patch preserves commercial flow, credentials, binary SHA/upload/failure nodes and is idempotent', () => {
  const before = structuredClone(source);
  const { workflow, changedNodeNames } = patchEvolutionInboundPdf(source);
  assert.deepEqual(source, before);
  assert.deepEqual(workflow.connections, source.connections);
  assert.deepEqual(workflow.settings, source.settings);
  assert.equal(workflow.nodes.length, source.nodes.length);
  for (let i = 0; i < source.nodes.length; i++) {
    assert.deepEqual(
      workflow.nodes[i].credentials,
      source.nodes[i].credentials,
    );
    assert.equal(workflow.nodes[i].id, source.nodes[i].id);
    if (!changedNodeNames.includes(source.nodes[i].name))
      assert.deepEqual(workflow.nodes[i], source.nodes[i]);
  }
  assert.deepEqual(patchEvolutionInboundPdf(workflow), {
    workflow,
    changedNodeNames: [],
  });
});

test('INBOX-PDF-01 generated n8n filter, decoder and measurement persist PDF bytes and preserve images/audio', async () => {
  const { workflow } = patchEvolutionInboundPdf(source);
  const node = (/** @type {string} */ name) =>
    workflow.nodes.find((/** @type {any} */ n) => n.name === prefix + name);
  const expression =
    node('Filtrar').parameters.conditions.conditions[0].leftValue;
  const filter = new Function('$', `return ${expression.slice(3, -2)};`);
  for (const n of [
    meta,
    { ...meta, message_type: 'image', media_mime_type: 'image/png' },
    { ...meta, message_type: 'audio', media_mime_type: 'audio/ogg' },
  ])
    assert.equal(
      filter(() => ({ item: { json: n } })),
      true,
    );
  for (const n of [
    { ...meta, channel: 'instagram' },
    { ...meta, media_mime_type: 'text/html' },
    { ...meta, message_type: 'text' },
  ])
    assert.equal(
      filter(() => ({ item: { json: n } })),
      false,
    );
  const decode = new Function(
    '$json',
    '$',
    'Buffer',
    node('Baixar').parameters.jsCode,
  );
  const output = decode(response, () => ({ item: { json: meta } }), Buffer);
  assert.deepEqual(Buffer.from(output.binary.data.data, 'base64'), pdf);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const measure = new AsyncFunction(
    '$',
    '$input',
    '$itemIndex',
    'Buffer',
    node('Medir').parameters.jsCode,
  );
  const measured = await measure.call(
    { helpers: { getBinaryDataBuffer: async () => pdf } },
    () => ({ item: { json: meta } }),
    { item: { binary: output.binary } },
    0,
    Buffer,
  );
  assert.deepEqual(measured.json, {
    mime_type: 'application/pdf',
    filename: 'documento.pdf',
  });
  for (const [type, mime, bytes] of [
    ['image', 'image/png', Buffer.from('synthetic-image')],
    ['audio', 'audio/ogg', Buffer.from('synthetic-audio')],
  ]) {
    const normalized = {
      channel: 'whatsapp',
      message_type: type,
      media_kind: type,
      media_mime_type: mime,
    };
    const fallback = decode(
      { mimetype: mime, base64: bytes.toString('base64') },
      () => ({ item: { json: normalized } }),
      Buffer,
    );
    assert.equal(fallback.binary.data.mimeType, mime);
  }
});

for (const input of [
  { ...response, mimetype: 'text/html' },
  { ...response, base64: '%%%' },
  { ...response, base64: Buffer.from('<html>bad</html>').toString('base64') },
  { ...response, base64: 'JVBERi0=\n' },
  {
    ...response,
    base64: Buffer.from([0xa5, 0xd0, 0xc4, 0xc6, 0xad]).toString('base64'),
  },
  {
    ...response,
    base64: Buffer.alloc(16 * 1024 * 1024 + 1).toString('base64'),
  },
])
  test('INBOX-PDF-01 malformed/mismatched/oversized gateway bytes are rejected', () => {
    assert.throws(() => decodeInboxPdf(input, meta), /INBOUND_PDF_INVALID/u);
  });

test('INBOX-PDF-01 PDF limit is inclusive and n8n binary metadata is preserved', () => {
  const bytes = Buffer.alloc(16 * 1024 * 1024);
  bytes.write('%PDF-');
  const file = { id: 'opaque-binary-id', mimeType: 'application/pdf' };
  assert.equal(
    decodeInboxPdf({ ...response, base64: bytes.toString('base64') }, meta)
      .binary.data.fileExtension,
    'pdf',
  );
  assert.equal(measureInboxPdf(file, bytes).binary.data.id, file.id);
  assert.throws(
    () => measureInboxPdf(file, Buffer.alloc(bytes.length + 1)),
    /INBOUND_PDF_INVALID/u,
  );
  assert.throws(
    () => measureInboxPdf({ mimeType: 'text/html' }, pdf),
    /INBOUND_PDF_INVALID/u,
  );
  assert.throws(
    () => measureInboxPdf(file, Buffer.from([0xa5, 0xd0, 0xc4, 0xc6, 0xad])),
    /INBOUND_PDF_INVALID/u,
  );
});

test('INBOX-PDF-01 context drift or partial patch fails closed', () => {
  const drifted = structuredClone(source);
  drifted.connections[prefix + 'Baixar'].main[0] = [];
  assert.throws(
    () => patchEvolutionInboundPdf(drifted),
    /EXPECTED_MEDIA_CHAIN/u,
  );
  const partial = structuredClone(source);
  partial.nodes.find(
    (/** @type {any} */ n) => n.name === prefix + 'Baixar',
  ).parameters.jsCode += '\nconst decodeInboxPdf=1;';
  assert.throws(() => patchEvolutionInboundPdf(partial), /PARTIAL_PDF_PATCH/u);
});

for (const wrapped of [false, true])
  test(`INBOX-PDF-01 Evolution document caption wrapper=${wrapped} preserves canonical message`, () => {
    const document = {
      documentMessage: {
        mimetype: 'application/pdf',
        caption: 'Documento sintético',
        fileName: 'ignored.pdf',
        url: 'https://ignored.invalid',
      },
    };
    const event = {
      event: 'messages.upsert',
      instance: 'silmer',
      sender: config.ownNumber + '@s.whatsapp.net',
      date_time: '2026-10-29T12:00:30.123Z',
      data: {
        key: {
          id: 'SYNTHETIC_PDF',
          fromMe: false,
          remoteJid: '5511000000001@s.whatsapp.net',
        },
        message: wrapped
          ? { documentWithCaptionMessage: { message: document } }
          : document,
        messageType: wrapped ? 'documentWithCaptionMessage' : 'documentMessage',
        messageTimestamp: 1793275200,
      },
    };
    const validated = validateEvolutionEvent(event, config);
    const converted = convertEvolutionEvent(validated, null, config);
    assert.ok(JSON.stringify(converted).includes('application/pdf'));
    assert.ok(JSON.stringify(converted).includes('Documento sintético'));
  });
