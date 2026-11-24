import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { patchWahaInboundImages } from '../ops/n8n/patch-waha-inbound-images.mjs';
import { createWahaWorkflow } from '../ops/n8n/workflows/create-waha-workflow.mjs';
import { createEvolutionWorkflow } from '../ops/n8n/workflows/create-evolution-workflow.mjs';
import { patchEvolutionInboundAudio } from '../ops/n8n/patch-evolution-inbound-audio.mjs';
import { patchEvolutionInboundImages } from '../ops/n8n/patch-evolution-inbound-images.mjs';
import { patchEvolutionInboundDocuments } from '../ops/n8n/patch-evolution-inbound-documents.mjs';
import { patchInboundVideoAndCdrZip } from '../ops/n8n/patch-evolution-inbound-video-cdr-zip.mjs';

// Synthetic workflow chain, as in the INBOX-DOC-02 test; no production data.
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
const source = patchEvolutionInboundDocuments(
  patchEvolutionInboundImages(patchEvolutionInboundAudio(evolution).workflow),
).workflow;
const patched = patchInboundVideoAndCdrZip(source);

const PREFIX = 'Inbox - Imagem recebida - ';
const LIMIT = 16 * 1024 * 1024;
const CDR_ZIP = 'application/x-vnd.corel.draw.document+zip';
const node = (/** @type {any} */ workflow, /** @type {string} */ name) =>
  workflow.nodes.find((/** @type {any} */ n) => n.name === PREFIX + name);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** @param {any} workflow */
function runtime(workflow) {
  const expression = node(workflow, 'Filtrar').parameters.conditions
    .conditions[0].leftValue;
  const filter = new Function('$', `return ${expression.slice(3, -2)};`);
  const download = new Function(
    '$json',
    '$',
    'Buffer',
    node(workflow, 'Baixar').parameters.jsCode,
  );
  const measure = new AsyncFunction(
    '$',
    '$input',
    '$itemIndex',
    'Buffer',
    node(workflow, 'Medir').parameters.jsCode,
  );
  /** @param {any} meta */
  const $for = (meta) => () => ({ item: { json: meta } });
  return {
    /** @param {any} meta */
    filter: (meta) => filter($for(meta)),
    /** @param {any} meta @param {any} response */
    download: (meta, response) => download(response, $for(meta), Buffer),
    /** @param {any} meta @param {any} binary @param {Buffer} bytes */
    measure: (meta, binary, bytes) =>
      measure.call(
        { helpers: { getBinaryDataBuffer: async () => bytes } },
        $for(meta),
        { item: { binary } },
        0,
        Buffer,
      ),
  };
}
const run = runtime(patched);

/** Synthetic ISO-BMFF header: box size + 'ftyp' at offset 4. */
const mp4 = (/** @type {number} */ size = 64) => {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32BE(24, 0);
  bytes.write('ftypisom', 4, 'ascii');
  return bytes;
};
const zip = (/** @type {number} */ size = 64) => {
  const bytes = Buffer.alloc(size);
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(bytes);
  bytes.write('synthetic-corel-candidate', 4, 'ascii');
  return bytes;
};
const videoMeta = {
  channel: 'whatsapp',
  message_type: 'video',
  media_mime_type: 'video/mp4',
  media_id: 'synthetic-video-id',
};
const cdrMeta = {
  channel: 'whatsapp',
  message_type: 'document',
  media_mime_type: 'application/zip',
  media_filename: 'arte-sintetica.cdr',
  media_id: 'synthetic-document-id',
};
const response = (/** @type {string} */ mimetype, /** @type {Buffer} */ b) => ({
  mimetype,
  base64: b.toString('base64'),
});

test('INBOX-VIDEO-01 MP4 flows end to end through Filtrar, Baixar and Medir', async () => {
  const bytes = mp4();
  assert.equal(run.filter(videoMeta), true);
  const output = run.download(videoMeta, response('video/mp4', bytes));
  assert.deepEqual(output.json, {
    mime_type: 'video/mp4',
    filename: 'video.mp4',
  });
  assert.deepEqual(Buffer.from(output.binary.data.data, 'base64'), bytes);
  assert.equal(output.binary.data.fileExtension, 'mp4');
  const stored = {
    data: { ...output.binary.data, id: 'opaque-id', data: undefined },
  };
  const measured = await run.measure(videoMeta, stored, bytes);
  assert.equal(measured.binary.data.id, 'opaque-id');
  assert.equal(measured.binary.data.mimeType, 'video/mp4');
  assert.equal(measured.binary.data.fileName, 'video.mp4');
  assert.deepEqual(measured.json, {
    mime_type: 'video/mp4',
    filename: 'video.mp4',
  });
});

for (const [label, meta, reply] of [
  [
    'gateway MIME video/quicktime',
    videoMeta,
    response('video/quicktime', mp4()),
  ],
  ['bytes without ftyp', videoMeta, response('video/mp4', zip())],
  ['payload above 16 MiB', videoMeta, response('video/mp4', mp4(LIMIT + 1))],
  ['non-canonical base64', videoMeta, { mimetype: 'video/mp4', base64: 'A' }],
])
  test(`INBOX-VIDEO-01 Baixar rejects ${label}`, () => {
    assert.throws(() => run.download(meta, reply), /INBOUND_VIDEO_INVALID/u);
  });

test('INBOX-VIDEO-01 Medir re-checks type, size and signature', async () => {
  const file = {
    data: { mimeType: 'video/mp4', fileName: 'video.mp4', id: 'x' },
  };
  await assert.rejects(
    run.measure(videoMeta, file, zip()),
    /INBOUND_VIDEO_INVALID/u,
  );
  await assert.rejects(
    run.measure(videoMeta, file, mp4(LIMIT + 1)),
    /INBOUND_VIDEO_INVALID/u,
  );
  await assert.rejects(
    run.measure(
      videoMeta,
      { data: { ...file.data, mimeType: 'application/zip' } },
      mp4(),
    ),
    /INBOUND_VIDEO_INVALID/u,
  );
  await assert.rejects(
    run.measure(videoMeta, undefined, mp4()),
    /INBOUND_VIDEO_INVALID/u,
  );
});

for (const [filename, mime] of [
  ['arte-sintetica.cdr', 'application/zip'],
  ['ARTE-SINTETICA.CDR ', 'application/x-zip-compressed'],
])
  test(`INBOX-CDR-ZIP-01 ${mime} named ${filename.trim()} becomes Corel ZIP`, async () => {
    const meta = {
      ...cdrMeta,
      media_filename: filename,
      media_mime_type: mime,
    };
    const bytes = zip();
    assert.equal(run.filter(meta), true);
    const output = run.download(meta, response(mime, bytes));
    assert.deepEqual(output.json, {
      mime_type: CDR_ZIP,
      filename: 'documento.cdr',
    });
    assert.deepEqual(Buffer.from(output.binary.data.data, 'base64'), bytes);
    assert.equal(output.binary.data.fileExtension, 'cdr');
    const measured = await run.measure(
      meta,
      { data: { ...output.binary.data, id: 'opaque-id' } },
      bytes,
    );
    assert.equal(measured.binary.data.id, 'opaque-id');
    assert.equal(measured.binary.data.mimeType, CDR_ZIP);
    assert.equal(measured.json.filename, 'documento.cdr');
  });

test('INBOX-CDR-ZIP-01 accepts the Corel ZIP type from the gateway', () => {
  const output = run.download(cdrMeta, response(CDR_ZIP, zip()));
  assert.equal(output.json.mime_type, CDR_ZIP);
});

for (const [label, reply] of [
  ['non-zip bytes', response('application/zip', mp4())],
  ['payload above 16 MiB', response('application/zip', zip(LIMIT + 1))],
  ['gateway MIME text/html', response('text/html', zip())],
])
  test(`INBOX-CDR-ZIP-01 Baixar rejects ${label}`, () => {
    assert.throws(
      () => run.download(cdrMeta, reply),
      /INBOUND_DOCUMENT_INVALID/u,
    );
  });

test('INBOX-CDR-ZIP-01 Medir re-checks type, size and ZIP header', async () => {
  const file = { data: { mimeType: CDR_ZIP, fileName: 'documento.cdr' } };
  await assert.rejects(
    run.measure(cdrMeta, file, mp4()),
    /INBOUND_DOCUMENT_INVALID/u,
  );
  await assert.rejects(
    run.measure(cdrMeta, file, zip(LIMIT + 1)),
    /INBOUND_DOCUMENT_INVALID/u,
  );
  await assert.rejects(
    run.measure(
      cdrMeta,
      { data: { ...file.data, mimeType: 'application/zip' } },
      zip(),
    ),
    /INBOUND_DOCUMENT_INVALID/u,
  );
});

test('Filtrar keeps rejecting unsupported video, ZIP and non-WhatsApp items', () => {
  for (const meta of [
    { ...videoMeta, media_mime_type: 'video/quicktime' },
    { ...videoMeta, channel: 'instagram' },
    { ...videoMeta, message_type: 'document' },
    { ...cdrMeta, media_filename: 'pacote.zip' },
    { ...cdrMeta, media_filename: 'arte.cdr.zip' },
    { ...cdrMeta, media_filename: undefined },
    { ...cdrMeta, media_mime_type: 'application/x-7z-compressed' },
    { ...cdrMeta, channel: 'instagram' },
    { ...cdrMeta, message_type: 'image' },
  ])
    assert.equal(run.filter(meta), false, JSON.stringify(meta));
  const before = runtime(source);
  assert.equal(before.filter(videoMeta), false);
  assert.equal(before.filter(cdrMeta), false);
});

test('existing image, PDF and Corel branches still reach the original code', async () => {
  const pdf = Buffer.from('%PDF-1.7\nsynthetic\n%%EOF');
  const pdfMeta = {
    channel: 'whatsapp',
    message_type: 'document',
    media_mime_type: 'application/pdf',
  };
  const corelMeta = { ...pdfMeta, media_mime_type: CDR_ZIP };
  const imageMeta = {
    channel: 'whatsapp',
    message_type: 'image',
    media_mime_type: 'image/png',
  };
  const before = runtime(source);
  for (const meta of [pdfMeta, corelMeta, imageMeta])
    assert.equal(run.filter(meta), before.filter(meta));
  assert.equal(run.filter(pdfMeta), true);
  assert.equal(run.filter(imageMeta), true);
  const pdfOut = run.download(pdfMeta, response('application/pdf', pdf));
  assert.deepEqual(
    pdfOut,
    before.download(pdfMeta, response('application/pdf', pdf)),
  );
  assert.equal(pdfOut.json.filename, 'documento.pdf');
  const corelOut = run.download(corelMeta, response(CDR_ZIP, zip()));
  assert.deepEqual(
    corelOut,
    before.download(corelMeta, response(CDR_ZIP, zip())),
  );
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ]);
  const imageOut = run.download(imageMeta, response('image/png', png));
  assert.deepEqual(
    imageOut,
    before.download(imageMeta, response('image/png', png)),
  );
  assert.equal(imageOut.binary.data.fileName, 'imagem.png');
  for (const name of ['Baixar', 'Medir'])
    assert.ok(
      node(patched, name).parameters.jsCode.endsWith(
        node(source, name).parameters.jsCode,
      ),
    );
  const measured = await run.measure(
    pdfMeta,
    { data: { ...pdfOut.binary.data, id: 'opaque-id' } },
    pdf,
  );
  assert.equal(measured.json.filename, 'documento.pdf');
});

test('patch changes only Filtrar/Baixar/Medir, is pure and refuses reapplication', () => {
  const before = structuredClone(source);
  const workflow = patchInboundVideoAndCdrZip(source);
  assert.deepEqual(source, before);
  assert.notEqual(workflow, source);
  assert.deepEqual(workflow.connections, source.connections);
  assert.deepEqual(workflow.settings, source.settings);
  assert.equal(workflow.nodes.length, source.nodes.length);
  const changed = ['Filtrar', 'Baixar', 'Medir'].map((name) => PREFIX + name);
  for (let i = 0; i < source.nodes.length; i++) {
    const after = structuredClone(workflow.nodes[i]);
    const original = structuredClone(source.nodes[i]);
    if (changed.includes(original.name)) {
      delete after.parameters.jsCode;
      delete original.parameters.jsCode;
      if (after.parameters.conditions) {
        delete after.parameters.conditions.conditions[0].leftValue;
        delete original.parameters.conditions.conditions[0].leftValue;
      }
    }
    assert.deepEqual(after, original);
  }
  for (const name of ['Filtrar', 'Baixar', 'Medir']) {
    const text = JSON.stringify(node(workflow, name).parameters);
    assert.ok(text.includes('/* INBOX-VIDEO-01 */'), name);
    assert.ok(text.includes('/* INBOX-CDR-ZIP-01 */'), name);
  }
  const { leftValue } = node(workflow, 'Filtrar').parameters.conditions
    .conditions[0];
  assert.match(leftValue, /^=\{\{[\s\S]*\}\}$/u);
  assert.throws(
    () => patchInboundVideoAndCdrZip(workflow),
    /VIDEO_CDR_ZIP_PATCH_ALREADY_APPLIED/u,
  );
});

test('patch refuses missing, ambiguous or unexpected media nodes', () => {
  /** @param {(w: any) => void} mutate */
  const variant = (mutate) => {
    const workflow = structuredClone(source);
    mutate(workflow);
    return workflow;
  };
  assert.throws(
    () =>
      patchInboundVideoAndCdrZip(
        variant((w) => {
          w.nodes = w.nodes.filter(
            (/** @type {any} */ n) => n.name !== PREFIX + 'Medir',
          );
        }),
      ),
    /MISSING_MEDIA_NODE/u,
  );
  assert.throws(
    () =>
      patchInboundVideoAndCdrZip(
        variant((w) => {
          w.nodes.push({ ...node(w, 'Baixar'), id: 'duplicate' });
        }),
      ),
    /AMBIGUOUS_MEDIA_NODE/u,
  );
  assert.throws(
    () =>
      patchInboundVideoAndCdrZip(
        variant((w) => {
          node(w, 'Filtrar').parameters.conditions.conditions[0].leftValue =
            '{{ true }}';
        }),
      ),
    /UNEXPECTED_FILTER_EXPRESSION/u,
  );
  assert.throws(
    () =>
      patchInboundVideoAndCdrZip(
        variant((w) => {
          node(w, 'Medir').parameters.jsCode += '\n/* INBOX-VIDEO-01 */';
        }),
      ),
    /VIDEO_CDR_ZIP_PATCH_ALREADY_APPLIED/u,
  );
  assert.throws(() => patchInboundVideoAndCdrZip({}), /EXPECTED_WORKFLOW/u);
});

test('patcher is self-contained for use outside Node', () => {
  // A bare realm without Buffer, process or modules, as in a browser console.
  const rebuilt = runInNewContext(`(${patchInboundVideoAndCdrZip})`, {
    structuredClone,
  });
  assert.deepEqual(rebuilt(source), patched);
});
