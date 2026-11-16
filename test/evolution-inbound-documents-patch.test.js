import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { patchWahaInboundImages } from '../ops/n8n/patch-waha-inbound-images.mjs';
import { createWahaWorkflow } from '../ops/n8n/workflows/create-waha-workflow.mjs';
import { createEvolutionWorkflow } from '../ops/n8n/workflows/create-evolution-workflow.mjs';
import { patchEvolutionInboundAudio } from '../ops/n8n/patch-evolution-inbound-audio.mjs';
import { patchEvolutionInboundImages } from '../ops/n8n/patch-evolution-inbound-images.mjs';
import {
  decodeInboxDocument,
  patchEvolutionInboundDocuments,
} from '../ops/n8n/patch-evolution-inbound-documents.mjs';
import { patchEvolutionInboundPdf } from '../ops/n8n/patch-evolution-inbound-pdf.mjs';

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

const pdf = Buffer.from('%PDF-1.7\nsynthetic\n%%EOF');
const riff = Buffer.from('RIFF\x10\x00\x00\x00CDRDvrsn');
const zip = Buffer.from('PK\x03\x04synthetic-corel-candidate');
const meta = {
  channel: 'whatsapp',
  message_type: 'document',
  media_mime_type: 'application/octet-stream',
};
for (const [bytes, mime] of [
  [pdf, 'application/pdf'],
  [riff, 'application/vnd.corel-draw'],
  [zip, 'application/x-vnd.corel.draw.document+zip'],
]) {
  test(`INBOX-DOC-02 generic gateway bytes canonicalize to ${mime}`, () => {
    const output = decodeInboxDocument(
      {
        mimetype: 'application/octet-stream',
        base64: bytes.toString('base64'),
      },
      meta,
    );
    assert.equal(output.json.mime_type, mime);
    assert.deepEqual(Buffer.from(output.binary.data.data, 'base64'), bytes);
  });
}
for (const [bytes, expected, mime] of [
  [
    Buffer.from('<html>unsafe</html>'),
    'application/octet-stream',
    'application/octet-stream',
  ],
  [pdf, 'application/x-cdr', 'application/octet-stream'],
  [riff, 'application/pdf', 'application/octet-stream'],
  [pdf, 'application/octet-stream', 'text/html'],
  [
    Buffer.alloc(16 * 1024 * 1024 + 1),
    'application/octet-stream',
    'application/octet-stream',
  ],
])
  test(`INBOX-DOC-02 rejects invalid/mismatched document ${expected}/${mime}/${bytes.length}`, () => {
    assert.throws(
      () =>
        decodeInboxDocument(
          { mimetype: mime, base64: bytes.toString('base64') },
          { ...meta, media_mime_type: expected },
        ),
      /INBOUND_DOCUMENT_INVALID/u,
    );
  });

test('INBOX-DOC-02 patch preserves IDs, credentials, routing and is idempotent on both pre-PDF and PDF workflows', async () => {
  for (const input of [source, patchEvolutionInboundPdf(source).workflow]) {
    const before = structuredClone(input);
    const { workflow, changedNodeNames } =
      patchEvolutionInboundDocuments(input);
    assert.deepEqual(input, before);
    assert.deepEqual(workflow.connections, input.connections);
    assert.deepEqual(workflow.settings, input.settings);
    assert.equal(workflow.nodes.length, input.nodes.length);
    for (let i = 0; i < input.nodes.length; i++) {
      assert.equal(workflow.nodes[i].id, input.nodes[i].id);
      assert.deepEqual(
        workflow.nodes[i].credentials,
        input.nodes[i].credentials,
      );
      if (!changedNodeNames.includes(input.nodes[i].name))
        assert.deepEqual(workflow.nodes[i], input.nodes[i]);
    }
    assert.deepEqual(patchEvolutionInboundDocuments(workflow), {
      workflow,
      changedNodeNames: [],
    });
    const node = (/** @type {string} */ name) =>
      workflow.nodes.find(
        (/** @type {any} */ n) =>
          n.name === 'Inbox - Imagem recebida - ' + name,
      );
    const expression =
      node('Filtrar').parameters.conditions.conditions[0].leftValue;
    const filter = new Function('$', `return ${expression.slice(3, -2)};`);
    assert.equal(
      filter(() => ({ item: { json: meta } })),
      true,
    );
    assert.equal(
      filter(() => ({
        item: { json: { ...meta, media_mime_type: 'text/html' } },
      })),
      false,
    );
    const decode = new Function(
      '$json',
      '$',
      'Buffer',
      node('Baixar').parameters.jsCode,
    );
    const output = decode(
      { mimetype: 'application/octet-stream', base64: riff.toString('base64') },
      () => ({ item: { json: meta } }),
      Buffer,
    );
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const measure = new AsyncFunction(
      '$',
      '$input',
      '$itemIndex',
      'Buffer',
      node('Medir').parameters.jsCode,
    );
    output.binary.data.id = 'opaque-id';
    const measured = await measure.call(
      { helpers: { getBinaryDataBuffer: async () => riff } },
      () => ({ item: { json: meta } }),
      { item: { binary: output.binary } },
      0,
      Buffer,
    );
    assert.equal(measured.binary.data.id, 'opaque-id');
    assert.equal(measured.json.filename, 'documento.cdr');
  }
});
