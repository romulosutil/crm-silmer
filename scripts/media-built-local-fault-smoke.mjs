import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { Pool } from 'pg';
const { fetch, FormData, File } = globalThis;
if (process.env.RUN_MEDIA_BUILT_LOCAL_SMOKE !== 'yes')
  throw Error(
    'Explicit dedicated local built fault smoke authorization required',
  );
const run = promisify(execFile),
  container = 'crm-silmer-media-local-n8n-1';
const env = Object.fromEntries(
  (await readFile('var/media-local/n8n.env', 'utf8'))
    .trim()
    .split('\n')
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const pool = new Pool({
  connectionString:
    'postgresql://crm_silmer_media:synthetic-media-development-only@127.0.0.1:15435/crm_silmer_media',
});
const base = 'http://127.0.0.1:3013',
  origin = 'http://127.0.0.1:4193';
const canonical =
  'ops/n8n/workflows/0S5ZS1xeDCSoWovs-local-test.sanitized.json';
const canonicalBytes = await readFile(canonical),
  canonicalDigest = createHash('sha256').update(canonicalBytes).digest('hex');
const source = JSON.parse(canonicalBytes.toString('utf8'));
const delayNode = source.nodes.find(
  (/** @type {any} */ n) =>
    n.name === 'DEV - Simular upload Meta de midia (MVP)',
);
const unknownNode = source.nodes.find(
  (/** @type {any} */ n) =>
    n.name === 'DEV - Simular envio Meta de midia (MVP)',
);
assert.ok(delayNode && unknownNode);
delayNode.parameters.jsCode =
  "if ($('Preparar reserva de envio humano (MVP)').item.json.command.message.caption?.startsWith('synthetic-T24-preflight-')) await new Promise(resolve => setTimeout(resolve, 3000));\n" +
  delayNode.parameters.jsCode;
unknownNode.parameters.jsCode =
  "if ($('Preparar reserva de envio humano (MVP)').item.json.command.message.caption?.startsWith('synthetic-T24-unknown-')) throw new Error('DEV_SIMULATED_SEND_OUTCOME_UNKNOWN');\n" +
  unknownNode.parameters.jsCode;
await writeFile('var/media-T24-fault-workflow.json', JSON.stringify(source), {
  mode: 0o600,
});
async function pause(ms = 1000) {
  await new Promise((r) => setTimeout(r, ms));
}
/** @param {()=>Promise<any>} fn @param {string} label */
async function wait(fn, label) {
  const deadline = Date.now() + 180000;
  do {
    const result = await fn();
    if (result) return result;
    await pause();
  } while (Date.now() < deadline);
  throw Error(label + ' deadline');
}
/** @param {string} [tag] */
async function exportDigest(tag) {
  await run('docker', [
    'exec',
    container,
    'n8n',
    'export:workflow',
    '--id=' + source.id,
    '--output=/tmp/media-T24-export.json',
  ]);
  const value = JSON.parse(
    (
      await run('docker', [
        'exec',
        container,
        'cat',
        '/tmp/media-T24-export.json',
      ])
    ).stdout,
  )[0];
  assert.equal(value.active, true);
  assert.equal(value.activeVersionId, value.versionId);
  if (tag)
    await writeFile(
      'var/media-T24-workflow-' + tag + '.json',
      JSON.stringify(value),
      { mode: 0o600 },
    );
  return createHash('sha256')
    .update(
      JSON.stringify({
        nodes: value.nodes,
        connections: value.connections,
        settings: value.settings,
      }),
    )
    .digest('hex');
}
/** @param {string} input */
async function publish(input) {
  const started = new Date().toISOString();
  const marker = '/home/node/.n8n/silmer-local-workflow-imported';
  await run('docker', [
    'exec',
    container,
    'node',
    '-e',
    `require('fs').writeFileSync(${JSON.stringify(marker)},'synthetic-T24-transition')`,
  ]);
  await run(
    'docker',
    ['exec', container, 'node', '/import-local-workflow.mjs', input, marker],
    { timeout: 120000 },
  );
  if (input === '/tmp/media-T24-fault.json')
    await run('docker', [
      'exec',
      container,
      'node',
      '-e',
      `require('fs').writeFileSync(${JSON.stringify(marker)},${JSON.stringify(canonicalDigest + '\n')})`,
    ]);
  await run('docker', ['restart', container]);
  await wait(async () => {
    const logs = await run('docker', ['logs', container, '--since', started]);
    return logs.stdout.includes(
      'Activated workflow "LOCAL | Silmer | Fluxo completo sem WhatsApp"',
    );
  }, 'workflow activation');
}
const before = await exportDigest('before');
let installed = false;
const results = [];
try {
  await run('docker', [
    'cp',
    resolve('var/media-T24-fault-workflow.json'),
    container + ':/tmp/media-T24-fault.json',
  ]);
  installed = true;
  await publish('/tmp/media-T24-fault.json');
  assert.notEqual(await exportDigest('active-fault'), before);
  const login = await fetch(base + '/api/v1/sessions', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'vendedor@crm-silmer.local',
      password: 'Desenvolvimento!2026',
    }),
  });
  assert.equal(login.status, 200);
  const cookies = login.headers.getSetCookie().map((v) => v.split(';')[0]);
  const csrf = cookies.find((v) => v.startsWith('crm_csrf='));
  assert.ok(csrf);
  const headers = {
    origin,
    cookie: cookies.join('; '),
    'x-csrf-token': csrf.slice(9),
  };
  for (const scenario of ['preflight', 'unknown']) {
    const eventId = randomUUID();
    const incoming = await fetch(
      base + '/api/v1/integrations/n8n/messages/inbound',
      {
        method: 'POST',
        headers: {
          authorization: env.SILMER_LOCAL_N8N_TO_CRM_AUTHORIZATION,
          'content-type': 'application/json',
          'idempotency-key': eventId,
          'x-correlation-id': randomUUID(),
          'x-silmer-workflow-key': source.id,
          'x-silmer-workflow-version': 'dev-mvp-simple-12',
          'x-silmer-execution-id': 'synthetic-T24-fault-setup',
        },
        body: JSON.stringify({
          schema_version: '1.0',
          event_id: eventId,
          occurred_at: new Date().toISOString(),
          channel: 'whatsapp',
          contact: {
            external_id:
              scenario === 'preflight' ? '5500000000003' : '5500000000004',
          },
          message: {
            external_id: eventId,
            type: 'text',
            text: 'Synthetic fault setup',
          },
          metadata: { provider_account_id: 'synthetic-media-T24-fault' },
        }),
      },
    );
    assert.equal(incoming.status, 200);
    const id = (await incoming.json()).conversation_id;
    await pool.query(
      "UPDATE crm.conversations SET assigned_user_id=(SELECT id FROM crm.users WHERE email='vendedor@crm-silmer.local'),automation_state='human',state='em_atendimento' WHERE id=$1",
      [id],
    );
    const version = Number(
      (
        await pool.query('SELECT version FROM crm.conversations WHERE id=$1', [
          id,
        ])
      ).rows[0].version,
    );
    const body = new FormData();
    body.set('kind', 'image');
    body.set('origin', 'attachment');
    body.set('expectedVersion', String(version));
    body.set(
      'file',
      new File(
        [await readFile('var/media-profile-synthetic.png')],
        'synthetic.png',
        { type: 'image/png' },
      ),
    );
    const uploaded = await fetch(`${base}/api/v1/conversations/${id}/media`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      body,
    });
    assert.equal(uploaded.status, 202);
    const mediaId = (await uploaded.json()).mediaId;
    await wait(async () => {
      const response = await fetch(
        `${base}/api/v1/conversations/${id}/media/${mediaId}`,
        { headers },
      );
      assert.equal(response.status, 200);
      const value = await response.json();
      assert.ok(!['rejected', 'lost', 'unavailable'].includes(value.state));
      return value.state === 'ready';
    }, 'built ready');
    const key = randomUUID(),
      command = {
        messageType: 'image',
        content: {
          mediaId,
          caption: 'synthetic-T24-' + scenario + '-' + randomUUID(),
        },
        expectedVersion: version,
        reason: 'Synthetic fault callback acceptance',
      };
    async function send() {
      return fetch(`${base}/api/v1/conversations/${id}/messages`, {
        method: 'POST',
        headers: {
          ...headers,
          'idempotency-key': key,
          'content-type': 'application/json',
        },
        body: JSON.stringify(command),
      });
    }
    const accepted = await send();
    assert.equal(accepted.status, 202);
    const messageId = (await accepted.json()).id;
    if (scenario === 'preflight') {
      await wait(
        async () =>
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM crm.n8n_events WHERE message_id=$1 AND event_type='message.send.requested'",
                [messageId],
              )
            ).rows[0].count,
          ) === 1,
        'real reservation',
      );
      await pause(500);
      await pool.query(
        'UPDATE crm.conversations SET automation_epoch=automation_epoch+1 WHERE id=$1',
        [id],
      );
    }
    const expected = scenario === 'preflight' ? 'failed' : 'outcome_unknown';
    const terminal = await wait(async () => {
      const value = (
        await pool.query(
          'SELECT status,retryable,retry_safe,last_error_code FROM crm.n8n_commands WHERE command_id=$1',
          [key],
        )
      ).rows[0];
      assert.notEqual(value.status, 'sent');
      return value.status === expected ? value : null;
    }, 'real callback ' + scenario);
    assert.equal(terminal.retryable, false);
    assert.equal(terminal.retry_safe, false);
    if (scenario === 'preflight')
      assert.equal(terminal.last_error_code, 'MEDIA_PREFLIGHT_UNAVAILABLE');
    assert.equal(
      (
        await pool.query('SELECT status FROM crm.messages WHERE id=$1', [
          messageId,
        ])
      ).rows[0].status,
      expected,
    );
    const events = (
      await pool.query(
        'SELECT event_type FROM crm.n8n_events WHERE message_id=$1 ORDER BY event_type',
        [messageId],
      )
    ).rows.map((v) => v.event_type);
    assert.deepEqual(
      events,
      scenario === 'preflight'
        ? ['message.send.requested', 'workflow.failed']
        : ['message.send.requested', 'message.send.unknown'],
    );
    const replay = await send();
    assert.equal(replay.status, 202);
    assert.equal((await replay.json()).id, messageId);
    await pause(3000);
    assert.equal(
      Number(
        (
          await pool.query(
            'SELECT count(*) FROM crm.n8n_commands WHERE command_id=$1',
            [key],
          )
        ).rows[0].count,
      ),
      1,
    );
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM crm.n8n_events WHERE message_id=$1 AND event_type='message.send.requested'",
            [messageId],
          )
        ).rows[0].count,
      ),
      1,
    );
    const final = (
      await pool.query(
        'SELECT status,retryable,retry_safe FROM crm.n8n_commands WHERE command_id=$1',
        [key],
      )
    ).rows[0];
    assert.deepEqual(final, {
      status: expected,
      retryable: false,
      retry_safe: false,
    });
    results.push({
      scenario,
      status: expected,
      messageId,
      mediaId,
      events,
      terminal,
    });
    console.log(
      JSON.stringify({
        scenario,
        status: expected,
        reservation: 1,
        replayCommands: 1,
        retry: false,
        events,
      }),
    );
  }
} finally {
  if (installed) {
    await publish('/workflows/0S5ZS1xeDCSoWovs-local-test.sanitized.json');
    const after = await exportDigest('after');
    assert.equal(after, before);
    assert.equal(
      createHash('sha256')
        .update(await readFile(canonical))
        .digest('hex'),
      canonicalDigest,
    );
    console.log(
      'Canonical workflow source and imported nodes/connections/settings restored exactly.',
    );
    await writeFile(
      'var/media-T24-fault-callback-proof.json',
      JSON.stringify({ canonicalDigest, before, after, results }, null, 2),
      { mode: 0o600 },
    );
  }
  await pool.end();
}
