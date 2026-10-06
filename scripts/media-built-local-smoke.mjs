import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
const { fetch, FormData, File } = globalThis;
if (process.env.RUN_MEDIA_BUILT_LOCAL_SMOKE !== 'yes')
  throw Error('Explicit dedicated local built smoke authorization required');
const env = Object.fromEntries(
  (await readFile('var/media-local/api.env', 'utf8'))
    .trim()
    .split('\n')
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const pool = new Pool({
  connectionString:
    'postgresql://crm_silmer_media:synthetic-media-development-only@127.0.0.1:15435/crm_silmer_media',
});
const base = 'http://127.0.0.1:3013',
  origin = env.APP_ORIGIN;
const state = { conversationId: '' };
const nenv = Object.fromEntries(
  (await readFile('var/media-local/n8n.env', 'utf8'))
    .trim()
    .split('\n')
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const canary = 'synthetic-T24-' + randomUUID();
const results = [];
async function pause() {
  await new Promise((r) => setTimeout(r, 1000));
}
/** @param {()=>Promise<any>} fn @param {string} label @param {number} [ms] */
async function wait(fn, label, ms = 180000) {
  const deadline = Date.now() + ms;
  do {
    const result = await fn();
    if (result) return result;
    await pause();
  } while (Date.now() < deadline);
  throw Error('Deadline: ' + label);
}
try {
  const inboundId = randomUUID();
  const inbound = await fetch(
    base + '/api/v1/integrations/n8n/messages/inbound',
    {
      method: 'POST',
      headers: {
        authorization: nenv.SILMER_LOCAL_N8N_TO_CRM_AUTHORIZATION,
        'content-type': 'application/json',
        'idempotency-key': inboundId,
        'x-correlation-id': randomUUID(),
        'x-silmer-workflow-key': '0S5ZS1xeDCSoWovs',
        'x-silmer-workflow-version': 'dev-mvp-simple-12',
        'x-silmer-execution-id': 'synthetic-T24-setup',
      },
      body: JSON.stringify({
        schema_version: '1.0',
        event_id: inboundId,
        occurred_at: new Date().toISOString(),
        channel: 'whatsapp',
        contact: { external_id: '5500000000002' },
        message: {
          external_id: inboundId,
          type: 'text',
          text: 'Synthetic pipeline setup only',
        },
        metadata: { provider_account_id: 'synthetic-media-T24' },
      }),
    },
  );
  assert.equal(inbound.status, 200);
  const setup = await inbound.json();
  assert.equal(typeof setup.conversation_id, 'string');
  state.conversationId = setup.conversation_id;
  await pool.query(
    "UPDATE crm.conversations SET assigned_user_id=(SELECT id FROM crm.users WHERE email='vendedor@crm-silmer.local'),automation_state='human',state='em_atendimento' WHERE id=$1",
    [state.conversationId],
  );
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
  const fixtures = [
    ['image', 'attachment', 'image/png', 'var/media-profile-synthetic.png'],
    ['audio', 'attachment', 'audio/mpeg', 'var/media-T24-synthetic.mp3'],
    ['video', 'attachment', 'video/mp4', 'var/media-T24-synthetic.mp4'],
    [
      'audio',
      'recording',
      'audio/webm',
      'var/chat-media-chromium-autostop-300s.webm',
    ],
  ];
  for (const [kind, source, mime, path] of fixtures) {
    const version = Number(
      (
        await pool.query('SELECT version FROM crm.conversations WHERE id=$1', [
          state.conversationId,
        ])
      ).rows[0].version,
    );
    const bytes = await readFile(path);
    const body = new FormData();
    body.set('kind', kind);
    body.set('origin', source);
    body.set('expectedVersion', String(version));
    const filename = path.split('/').at(-1);
    assert.ok(filename);
    body.set('file', new File([bytes], filename, { type: mime }));
    const uploadKey = randomUUID();
    const accepted = await fetch(
      `${base}/api/v1/conversations/${state.conversationId}/media`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': uploadKey },
        body,
      },
    );
    assert.equal(accepted.status, 202);
    const { mediaId } = await accepted.json();
    await wait(
      async () => {
        const response = await fetch(
          `${base}/api/v1/conversations/${state.conversationId}/media/${mediaId}`,
          { headers },
        );
        assert.equal(response.status, 200);
        const value = await response.json();
        assert.ok(
          !['rejected', 'unavailable', 'lost'].includes(value.state),
          JSON.stringify({ state: value.state, errorCode: value.errorCode }),
        );
        return value.state === 'ready' ? value : null;
      },
      kind + ' ready',
      300000,
    );
    const sendKey = randomUUID();
    const command = {
      messageType: kind,
      content: { mediaId, ...(kind === 'audio' ? {} : { caption: canary }) },
      expectedVersion: version,
      reason: 'Synthetic whole built pipeline acceptance',
    };
    async function send() {
      return fetch(
        `${base}/api/v1/conversations/${state.conversationId}/messages`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'content-type': 'application/json',
            'idempotency-key': sendKey,
          },
          body: JSON.stringify(command),
        },
      );
    }
    const sent = await send();
    assert.equal(sent.status, 202);
    const submitted = await sent.json();
    const completed = await wait(async () => {
      const response = await fetch(
        `${base}/api/v1/inbox/conversations/${state.conversationId}`,
        { headers },
      );
      assert.equal(response.status, 200);
      const value = await response.json();
      const message = value.messages?.find(
        (/** @type {any} */ m) => m.media?.mediaId === mediaId,
      );
      if (message?.status === 'failed' || message?.status === 'outcome_unknown')
        throw Error(
          'Delivery failed ' +
            JSON.stringify({
              status: message.status,
              deliveryMode: message.deliveryMode,
            }),
        );
      return message?.status === 'sent' ? message : null;
    }, kind + ' callback');
    assert.equal(completed.deliveryMode, 'dev');
    assert.equal(completed.media.kind, kind);
    const replayQuery =
      "SELECT (SELECT count(*) FROM crm.messages WHERE command_id=$1) AS messages,(SELECT count(*) FROM crm.n8n_commands WHERE command_id=$1) AS commands,(SELECT count(*) FROM crm.chat_media WHERE id=$2) AS media,(SELECT count(*) FROM crm.n8n_events WHERE message_id=(SELECT id FROM crm.messages WHERE command_id=$1) AND event_type='message.send.requested') AS reservations";
    const beforeReplay = (await pool.query(replayQuery, [sendKey, mediaId]))
      .rows[0];
    const replay = await send();
    assert.equal(replay.status, 202);
    const replayed = await replay.json();
    assert.equal(replayed.id, submitted.id);
    assert.deepEqual(replayed.content, submitted.content);
    assert.equal(replayed.status, 'sent');
    assert.deepEqual(
      (await pool.query(replayQuery, [sendKey, mediaId])).rows[0],
      beforeReplay,
    );
    assert.deepEqual(beforeReplay, {
      messages: '1',
      commands: '1',
      media: '1',
      reservations: '1',
    });
    const content = await fetch(base + completed.media.contentUrl, { headers });
    assert.equal(content.status, 200);
    const stored = Buffer.from(await content.arrayBuffer());
    if (source === 'attachment') assert.deepEqual(stored, bytes);
    else {
      assert.ok(stored.length > 0 && stored.length < 16 * 1024 * 1024);
      await writeFile('var/media-T24-normalized-boundary.ogg', stored, {
        mode: 0o600,
      });
    }
    const metadata = (
      await pool.query(
        'SELECT state,origin,duration_ms,size_bytes,detected_mime_type,audio_codec,container,content_sha256 FROM crm.chat_media WHERE id=$1',
        [mediaId],
      )
    ).rows[0];
    assert.equal(metadata.state, 'attached');
    assert.equal(Number(metadata.size_bytes), stored.length);
    assert.equal(
      metadata.content_sha256,
      createHash('sha256').update(stored).digest('hex'),
    );
    if (source === 'recording') {
      assert.notEqual(metadata.duration_ms, null);
      assert.ok(
        Number(metadata.duration_ms) > 0 &&
          Number(metadata.duration_ms) <= 300000,
      );
      assert.equal(metadata.origin, 'recording');
      assert.equal(metadata.detected_mime_type, 'audio/ogg');
      assert.equal(metadata.audio_codec, 'opus');
      assert.equal(metadata.container, 'ogg');
    }
    results.push({
      kind,
      origin: source,
      mediaId,
      status: completed.status,
      deliveryMode: completed.deliveryMode,
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      storedSha256: createHash('sha256').update(stored).digest('hex'),
      metadata,
    });
    console.log(
      JSON.stringify({
        kind,
        origin: source,
        status: completed.status,
        deliveryMode: completed.deliveryMode,
        durationMs: metadata.duration_ms,
        storedBytes: stored.length,
        replay: 'same identity/content; current status; one reservation',
      }),
    );
  }
  const boundary = await readFile('var/media-T24-overlimit.webm');
  const currentVersion = Number(
    (
      await pool.query('SELECT version FROM crm.conversations WHERE id=$1', [
        state.conversationId,
      ])
    ).rows[0].version,
  );
  const rejectedBody = new FormData();
  rejectedBody.set('kind', 'audio');
  rejectedBody.set('origin', 'recording');
  rejectedBody.set('expectedVersion', String(currentVersion));
  rejectedBody.set(
    'file',
    new File([boundary], 'synthetic-overlimit.webm', { type: 'audio/webm' }),
  );
  const rejectedUpload = await fetch(
    `${base}/api/v1/conversations/${state.conversationId}/media`,
    {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      body: rejectedBody,
    },
  );
  assert.equal(rejectedUpload.status, 202);
  const rejectedId = (await rejectedUpload.json()).mediaId;
  const rejection = await wait(
    async () => {
      const response = await fetch(
        `${base}/api/v1/conversations/${state.conversationId}/media/${rejectedId}`,
        { headers },
      );
      assert.equal(response.status, 200);
      const value = await response.json();
      assert.notEqual(value.state, 'ready');
      return value.state === 'rejected' ? value : null;
    },
    '301s rejection',
    300000,
  );
  assert.equal(rejection.reason, 'invalid_format');
  const invalidSend = await fetch(
    `${base}/api/v1/conversations/${state.conversationId}/messages`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        messageType: 'audio',
        content: { mediaId: rejectedId },
        expectedVersion: currentVersion,
        reason: 'Synthetic invalid duration rejection',
      }),
    },
  );
  assert.equal(invalidSend.status, 409);
  const first = results[0];
  const contentPath = `/api/v1/conversations/${state.conversationId}/media/${first.mediaId}/content`;
  assert.equal((await fetch(base + contentPath)).status, 401);
  const other = await fetch(base + '/api/v1/sessions', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'vendedora@crm-silmer.local',
      password: 'Desenvolvimento!2026',
    }),
  });
  assert.equal(other.status, 200);
  const otherCookies = other.headers.getSetCookie().map((v) => v.split(';')[0]);
  const role = (
    await pool.query(
      "SELECT f.user_id,f.function_name FROM crm.user_functions f JOIN crm.users u ON u.id=f.user_id WHERE u.email='vendedora@crm-silmer.local'",
    )
  ).rows[0];
  assert.ok(role);
  // Active sellers may read the shared Inbox. The negative actor deliberately
  // lacks an operational function; restore the synthetic account in finally.
  await pool.query('DELETE FROM crm.user_functions WHERE user_id=$1', [
    role.user_id,
  ]);
  try {
    assert.equal(
      (
        await fetch(base + contentPath, {
          headers: { origin, cookie: otherCookies.join('; ') },
        })
      ).status,
      403,
    );
  } finally {
    await pool.query(
      'INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET function_name=excluded.function_name',
      [role.user_id, role.function_name],
    );
  }
  const ranged = await fetch(base + contentPath, {
    headers: { ...headers, range: 'bytes=0-15' },
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 0-15/99');
  assert.deepEqual(
    Buffer.from(await ranged.arrayBuffer()),
    (await readFile('var/media-profile-synthetic.png')).subarray(0, 16),
  );
  assert.equal(
    (
      await fetch(base + contentPath, {
        headers: { ...headers, range: 'bytes=0-1,5-6' },
      })
    ).status,
    416,
  );
  console.log(
    '301s recording rejected/invalid_format, send409; content ACL401/403; exact Range206 and multiple Range416.',
  );
  await pool.query(
    "UPDATE crm.chat_media SET created_at=now()-interval '8 days',attached_at=now()-interval '8 days' WHERE conversation_id=$1 AND state='attached'",
    [state.conversationId],
  );
  const closed = await fetch(
    `${base}/api/v1/conversations/${state.conversationId}/close`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        expectedVersion: currentVersion,
        reason: 'Synthetic eight-day retained media acceptance',
      }),
    },
  );
  assert.equal(closed.status, 202);
  const retentionStarted = Date.now();
  await wait(
    async () => Date.now() - retentionStarted >= 65000,
    'built scheduler tick',
    70000,
  );
  for (const result of results) {
    const response = await fetch(
      `${base}/api/v1/conversations/${state.conversationId}/media/${result.mediaId}/content`,
      { headers },
    );
    assert.equal(response.status, 200);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await response.arrayBuffer()))
        .digest('hex'),
      result.storedSha256,
    );
    assert.equal(
      (
        await pool.query('SELECT state FROM crm.chat_media WHERE id=$1', [
          result.mediaId,
        ])
      ).rows[0].state,
      'attached',
    );
  }
  console.log(
    'Four attached files retain exact hashes after synthetic eight-day timestamps, real close and 65s of built cleanup/retention scheduler.',
  );
  await writeFile(
    'var/media-T24-built-pipeline-proof.json',
    JSON.stringify(
      { canary, conversationId: state.conversationId, results },
      null,
      2,
    ),
    { mode: 0o600 },
  );
} finally {
  await pool.end();
}
