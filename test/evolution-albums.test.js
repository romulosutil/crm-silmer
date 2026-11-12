import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import { patchEvolutionAlbums } from '../ops/n8n/patch-evolution-albums.mjs';
import {
  convertEvolutionEvent,
  validateEvolutionEvent,
} from '../ops/n8n/workflows/create-evolution-workflow.mjs';

const config = { ownNumber: '5511000000000', session: 'silmer' };
const published = JSON.parse(
  await readFile(
    new URL(
      '../ops/n8n/workflows/k7tI6T4RhQPyJkn9-published.sanitized.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const target = 'Evolution - Validar origem (MVP)';
/** @param {any} message @param {string} [id] */
function inbound(message, id = 'SYNTHETIC_ALBUM') {
  return {
    event: 'messages.upsert',
    instance: 'silmer',
    sender: config.ownNumber + '@s.whatsapp.net',
    date_time: '2026-11-12T12:00:00.000Z',
    data: {
      key: { id, fromMe: false, remoteJid: '5511000000001@s.whatsapp.net' },
      messageTimestamp: 1794484800,
      message,
    },
  };
}
/** Execute the exact deployed Code node without I/O, using synthetic identity. @param {any} workflow @param {any[]} items */
function run(workflow, items) {
  const code = workflow.nodes
    .find((/** @type {any} */ n) => n.name === target)
    .parameters.jsCode.replaceAll('__SILMER_OWN_NUMBER__', config.ownNumber);
  return vm.runInNewContext(`(function(){${code}})()`, {
    $input: { all: () => items.map((json) => ({ json })) },
  });
}

test('INBOX-ALBUM-01: reproduces false unsupported in the published validator; patch filters envelope only', () => {
  const events = [
    inbound({ conversation: 'Sim.' }, 'SYNTHETIC_TEXT'),
    inbound({
      albumMessage: { expectedImageCount: 4, expectedVideoCount: 0 },
      messageContextInfo: {},
    }),
  ];
  for (let index = 0; index < 4; index++)
    events.push(
      inbound(
        {
          imageMessage: {
            mimetype: 'image/jpeg',
            caption: index === 3 ? 'Referência de cores.' : '',
            contextInfo: { stanzaId: 'SYNTHETIC_ALBUM' },
          },
        },
        `SYNTHETIC_PHOTO_${index}`,
      ),
    );
  const before = run(published, events);
  assert.equal(before.length, 6);
  assert.equal(before[1].json.event.type, 'unsupported');
  const { workflow, changedNodeNames } = patchEvolutionAlbums(published);
  assert.deepEqual(changedNodeNames, [target]);
  const after = run(workflow, events);
  assert.equal(after.length, 5);
  assert.deepEqual(
    Array.from(after, (item) => item.pairedItem.item),
    [0, 2, 3, 4, 5],
  );
  assert.deepEqual(
    Array.from(after, (item) => item.json.id),
    [
      'SYNTHETIC_TEXT',
      ...Array.from({ length: 4 }, (_, index) => `SYNTHETIC_PHOTO_${index}`),
    ],
  );
  for (const item of after.slice(1)) {
    const message = convertEvolutionEvent(item.json, null, config).messages[0];
    assert.equal(message.type, 'image');
    assert.equal(message.image.mime_type, 'image/jpeg');
    assert.equal(message.context.id, 'SYNTHETIC_ALBUM');
  }
  assert.equal(after[4].json.event.caption, 'Referência de cores.');
});

test('album announcement is ignored inside wrappers and before unresolved LID lookup', () => {
  const message = { albumMessage: { expectedImageCount: 2 } };
  for (const content of [
    message,
    { ephemeralMessage: { message } },
    { viewOnceMessageV2: { message } },
  ]) {
    const event = inbound(content);
    event.data.key.remoteJid = '12345@lid';
    assert.equal(validateEvolutionEvent(event, config), null);
  }
});

test('real content, unsupported messages, auth checks and receipts keep their existing behavior', () => {
  for (const [message, type] of [
    [{ imageMessage: { mimetype: 'image/jpeg' }, albumMessage: {} }, 'image'],
    [
      { videoMessage: { mimetype: 'video/mp4' }, messageContextInfo: {} },
      'video',
    ],
    [{ conversation: 'Conteúdo', albumMessage: {} }, 'text'],
    [{ pollCreationMessage: {}, albumMessage: {} }, 'unsupported'],
    [{ albumMessage: 'invalid' }, 'unsupported'],
  ])
    assert.equal(
      validateEvolutionEvent(inbound(message), config).event.type,
      type,
    );
  assert.throws(
    () =>
      validateEvolutionEvent(
        {
          ...inbound({ albumMessage: {} }),
          sender: '5511000000002@s.whatsapp.net',
        },
        config,
      ),
    /EVOLUTION_ACCOUNT_MISMATCH/,
  );
  const ack = {
    ...inbound({}),
    event: 'messages.update',
    data: {
      keyId: 'SYNTHETIC_SENT',
      fromMe: true,
      remoteJid: '5511000000001@s.whatsapp.net',
      status: 'READ',
    },
  };
  assert.equal(validateEvolutionEvent(ack, config).event.status, 'READ');
});

test('offline patch preserves every other field, is idempotent and rejects changed validator', () => {
  const before = JSON.stringify(published);
  const { workflow } = patchEvolutionAlbums(published);
  assert.equal(JSON.stringify(published), before);
  const restored = structuredClone(workflow);
  restored.nodes.find(
    (/** @type {any} */ n) => n.name === target,
  ).parameters.jsCode = published.nodes.find(
    (/** @type {any} */ n) => n.name === target,
  ).parameters.jsCode;
  assert.deepEqual(restored, published);
  assert.deepEqual(patchEvolutionAlbums(workflow).changedNodeNames, []);
  const changed = structuredClone(published);
  changed.nodes.find(
    (/** @type {any} */ n) => n.name === target,
  ).parameters.jsCode += '\n// unexpected drift';
  assert.throws(() => patchEvolutionAlbums(changed), /CONTEXT_MISMATCH/);
  changed.nodes.push(
    structuredClone(
      changed.nodes.find((/** @type {any} */ n) => n.name === target),
    ),
  );
  assert.throws(() => patchEvolutionAlbums(changed), /VALIDATOR_INVALID/);
});

test('offline CLI never overwrites an export or prints its configuration', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'silmer-album-test-'));
  const input = join(folder, 'current.json');
  const output = join(folder, 'review.json');
  const cli = fileURLToPath(
    new URL('../ops/n8n/patch-evolution-albums.mjs', import.meta.url),
  );
  const runCli = (/** @type {string[]} */ args) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  await writeFile(input, JSON.stringify([published]));
  const prepared = runCli([input, output]);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.doesNotMatch(
    prepared.stdout + prepared.stderr,
    /__SILMER_OWN_NUMBER__|http:|jsCode|credentials/,
  );
  const reviewed = await readFile(output, 'utf8');
  assert.equal(JSON.parse(reviewed).length, 1);
  assert.notEqual(runCli([input, output]).status, 0);
  assert.equal(await readFile(output, 'utf8'), reviewed);
  assert.notEqual(runCli([input, input]).status, 0);
  assert.deepEqual(JSON.parse(await readFile(input, 'utf8')), [published]);
  await writeFile(input, JSON.stringify([published, published]));
  assert.notEqual(runCli([input, join(folder, 'multiple.json')]).status, 0);
});
