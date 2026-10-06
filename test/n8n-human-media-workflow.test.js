import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const snapshot = JSON.parse(
  await readFile(
    new URL(
      '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-mvp-simple.sanitized.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const nodes = new Map(
  snapshot.nodes.map((/** @type {any} */ n) => [n.name, n]),
);
const reserve = 'Preparar reserva de envio humano (MVP)';
const bytes = Buffer.from('synthetic-private-byte-canary');
/** @param {string} type */
function command(type) {
  return {
    command_id: 'send/a?b=#c%20',
    conversation_id: 'conversation',
    to: '5511000000000',
    message: {
      type,
      media_id: 'media',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size_bytes: bytes.length,
      mime_type:
        type === 'image'
          ? 'image/png'
          : type === 'audio'
            ? 'audio/ogg'
            : 'video/mp4',
      caption: type === 'audio' ? null : 'Synthetic caption',
    },
  };
}
/** @param {string} name @param {any} input @param {any} upstream @param {any} [extra] */
async function code(name, input, upstream, extra = {}) {
  const n = nodes.get(name);
  assert.ok(n, name);
  return vm.runInNewContext(
    `(async function(){${n.parameters.jsCode}\n}).call(ctx)`,
    {
      ctx: { helpers: { getBinaryDataBuffer: async () => bytes } },
      $input: { item: input },
      $json: input.json,
      $binary: input.binary,
      $itemIndex: 0,
      $: (/** @type {string} */ key) => ({ item: upstream[key] }),
      $execution: { id: '42' },
      ...extra,
    },
  );
}
/** @param {string} source @param {number} [output] */
const targets = (source, output = 0) =>
  (snapshot.connections[source]?.main?.[output] ?? []).map(
    (/** @type {any} */ edge) => edge.node,
  );
test('T14/MED-21: original true reservation gates both sends; replay reaches no effect', () => {
  assert.deepEqual(targets('Envio humano autorizado? (MVP)'), [
    'Mensagem humana tem midia? (MVP)',
  ]);
  assert.deepEqual(targets('Envio humano autorizado? (MVP)', 1), [
    'Responder comando sem envio (MVP)',
  ]);
  assert.deepEqual(targets('Mensagem humana tem midia? (MVP)'), [
    'CRM - Baixar midia reservada (MVP)',
  ]);
  assert.deepEqual(targets('Mensagem humana tem midia? (MVP)', 1), [
    'WhatsApp - Enviar texto humano (MVP)',
  ]);
});
test('T14/MED-22: technical URL encodes command as one segment, no redirect or Meta credential', () => {
  for (const name of [
    'CRM - Baixar midia reservada (MVP)',
    'CRM - Preflight midia reservada (MVP)',
  ]) {
    const n = nodes.get(name);
    assert.ok(n, name);
    assert.match(n.parameters.url, /encodeURIComponent/u);
    const expression = n.parameters.url.slice(3, -2);
    const result = vm.runInNewContext(expression, {
      $env: { SILMER_PANEL_BASE_URL: 'http://crm.test' },
      $: () => ({ item: { json: { command: command('image') } } }),
    });
    assert.equal(
      result,
      'http://crm.test/api/v1/integrations/n8n/commands/send%2Fa%3Fb%3D%23c%2520/media' +
        (name.includes('Preflight') ? '?preflight=true' : ''),
    );
    assert.equal(n.parameters.options.redirect.redirect.followRedirects, false);
    assert.equal(n.parameters.genericAuthType, 'httpBasicAuth');
  }
});
for (const type of ['image', 'audio', 'video'])
  test(`T14/MED-21/22: ${type} measures bytes before hash and restores paired binary for multipart`, async () => {
    const input = {
      json: {},
      binary: {
        data: {
          id: 'native-binary-reference',
          mimeType: command(type).message.mime_type,
        },
      },
    };
    const upstream = {
      [reserve]: { json: { command: command(type) } },
      'CRM - Baixar midia reservada (MVP)': input,
    };
    const measured = await code('Medir midia reservada (MVP)', input, upstream);
    assert.equal(measured.json.media_size_bytes, bytes.length);
    assert.equal(measured.binary.data, input.binary.data);
    const hashed = {
      json: { ...measured.json, media_sha256: command(type).message.sha256 },
    };
    const restored = await code(
      'Validar hash e restaurar midia (MVP)',
      hashed,
      upstream,
    );
    assert.equal(restored.binary.data, input.binary.data);
    assert.equal(restored.json.media_sha256, command(type).message.sha256);
    assert.equal(
      targets('Medir midia reservada (MVP)')[0],
      'Crypto - SHA256 midia (MVP)',
    );
    assert.equal(
      targets('Crypto - SHA256 midia (MVP)')[0],
      'Validar hash e restaurar midia (MVP)',
    );
  });
test('T14/MED-21: hash/size mismatch fails before upload or messages', async () => {
  const input = { json: {}, binary: { data: { id: 'native' } } };
  const c = command('image');
  await assert.rejects(
    code('Medir midia reservada (MVP)', input, {
      [reserve]: {
        json: { command: { ...c, message: { ...c.message, size_bytes: 1 } } },
      },
    }),
    /MEDIA_INTEGRITY_MISMATCH/u,
  );
  await assert.rejects(
    code(
      'Validar hash e restaurar midia (MVP)',
      {
        json: { media_size_bytes: bytes.length, media_sha256: 'b'.repeat(64) },
      },
      { [reserve]: { json: { command: c } } },
    ),
    /MEDIA_INTEGRITY_MISMATCH/u,
  );
  assert.deepEqual(targets('Validar hash e restaurar midia (MVP)', 1), [
    'Falha de integridade da midia (MVP)',
  ]);
});
test('T14/MED-24: upload precedes read-only preflight; message effect never retries and failure becomes unknown', () => {
  assert.deepEqual(targets('Meta - Upload midia humana (MVP)'), [
    'CRM - Preflight midia reservada (MVP)',
  ]);
  assert.deepEqual(targets('CRM - Preflight midia reservada (MVP)'), [
    'Preparar mensagem Meta de midia (MVP)',
  ]);
  assert.deepEqual(targets('Preparar mensagem Meta de midia (MVP)'), [
    'Meta - Enviar midia humana (MVP)',
  ]);
  assert.deepEqual(targets('Meta - Enviar midia humana (MVP)', 1), [
    'Preparar envio humano desconhecido (MVP)',
  ]);
  assert.equal(
    nodes.get('Meta - Enviar midia humana (MVP)').retryOnFail,
    false,
  );
  assert.equal(
    nodes.get('Meta - Upload midia humana (MVP)').retryOnFail,
    false,
  );
  assert.match(
    nodes.get('Meta - Upload midia humana (MVP)').parameters.url,
    /SILMER_META_MEDIA_HOMOLOGATED/u,
  );
  assert.equal(
    nodes.get('Crypto - SHA256 midia (MVP)').parameters.binaryData,
    true,
  );
});
test('T14/MED-21/24: failed preflight emits known failure; only valid metadata becomes message ID payload', async () => {
  const c = command('audio');
  const upstream = {
    [reserve]: { json: { command: c } },
    'Meta - Upload midia humana (MVP)': { json: { id: 'meta-media-id' } },
  };
  const preflight = {
    valid: true,
    media_id: 'media',
    type: 'audio',
    sha256: c.message.sha256,
    size_bytes: bytes.length,
    mime_type: 'audio/ogg',
  };
  const prepared = await code(
    'Preparar mensagem Meta de midia (MVP)',
    { json: preflight },
    upstream,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.json.meta_message)), {
    messaging_product: 'whatsapp',
    to: c.to,
    type: 'audio',
    audio: { id: 'meta-media-id' },
  });
  await assert.rejects(
    code(
      'Preparar mensagem Meta de midia (MVP)',
      { json: { ...preflight, valid: false } },
      upstream,
    ),
    /MEDIA_PREFLIGHT_REJECTED/u,
  );
  const failure = await code(
    'Falha de preflight da midia (MVP)',
    { json: {} },
    upstream,
  );
  assert.equal(failure.json.payload.failure.phase, 'before_message_send');
  assert.equal(failure.json.payload.failure.code, 'MEDIA_PREFLIGHT_REJECTED');
  assert.equal(failure.json.payload.command_id, c.command_id);
  assert.equal(failure.json.payload.conversation_id, c.conversation_id);
  assert.deepEqual(targets('CRM - Preflight midia reservada (MVP)', 1), [
    'Preflight da midia indisponivel (MVP)',
  ]);
});
