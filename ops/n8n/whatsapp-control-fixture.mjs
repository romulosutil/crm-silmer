// WAP-E02 rehearsal authority. Dedicated synthetic in-memory fixture only.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';

const loadRuntime = createRequire(import.meta.url);
const { createControlAdapter } = loadRuntime(
  '../evolution/wap-control-runtime.cjs',
);
const { createGenerationRuntime } = loadRuntime(
  '../evolution/wap-generation-runtime.cjs',
);

const config = JSON.parse(process.env.WAP_CONTROL_FIXTURE ?? 'null');
if (!config || config.synthetic !== true)
  throw new Error('WAP_FIXTURE_DISABLED');
const records = config.records.map((record) => ({
  ...record,
  reserved: new Set(),
  issued: 0,
  value:
    record.mode === 'qr'
      ? `data:image/png;base64,${randomBytes(128).toString('base64')}`
      : randomBytes(8).toString('hex').toUpperCase(),
}));
const pending = new Set();
const generationRuntime = createGenerationRuntime({
  enabled: true,
  instances: records.map((record) => record.instance),
});
const adapter = createControlAdapter({
  generationRuntime,
  env: {
    SILMER_WAP_CONTROL_ENABLED: 'true',
    SILMER_WAP_GENERATION_ENABLED: 'true',
    SILMER_WAP_GENERATION_INSTANCES: records
      .map((record) => record.instance)
      .join(','),
    SILMER_WAP_CONTROL_WEBHOOK_URL: config.webhookUrl,
    AUTHENTICATION_API_KEY: config.gatewayKey,
  },
});
const equal = (a, b) => {
  const left = Buffer.from(typeof a === 'string' ? a : '');
  const right = Buffer.from(typeof b === 'string' ? b : '');
  return (
    left.length > 0 &&
    left.length === right.length &&
    timingSafeEqual(left, right)
  );
};
async function body(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error();
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function recordFor(envelope, kind) {
  const record = records.find((candidate) =>
    ['operationId', 'lineId', 'generation', 'reference'].every(
      (key) => candidate[key] === envelope?.[key],
    ),
  );
  if (
    !record ||
    (kind === 'challenge'
      ? envelope.challengeId !== record.challengeId ||
        envelope.mode !== record.mode
      : envelope.action !== 'connect')
  )
    throw new Error();
  const fields = [
    'operationId',
    'lineId',
    'generation',
    'reference',
    ...(kind === 'challenge' ? ['challengeId', 'mode'] : ['action']),
  ];
  if (Object.keys(envelope).sort().join(',') !== fields.sort().join(','))
    throw new Error();
  return record;
}
createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.url === '/audit' || req.url === '/release') {
      if (!equal(req.headers['x-wap-fixture-token'], config.auditToken))
        throw new Error();
      if (req.url === '/release') {
        for (const response of pending) response.end('{"ok":true}');
        pending.clear();
        return res.end('{"ok":true}');
      }
      return res.end(
        JSON.stringify({
          pending: pending.size,
          records: records.map((record) => ({
            operationId: record.operationId,
            challengeId: record.challengeId,
            issued: record.issued,
            sourceCaptured: record.sourceCaptured === true,
            value: record.value,
          })),
        }),
      );
    }
    if (
      req.url?.startsWith('/instance/') ||
      req.url?.startsWith('/webhook/') ||
      req.url?.startsWith('/settings/')
    ) {
      if (!equal(req.headers.apikey, config.gatewayKey)) throw new Error();
      const path = req.url.split('?')[0];
      if (path === '/instance/fetchInstances')
        return res.end(
          JSON.stringify(
            records
              .filter((record) => record.prepared)
              .map((record) => ({
                name: record.instance,
                connectionStatus: record.state || 'close',
              })),
          ),
        );
      if (path === '/instance/create' && req.method === 'POST') {
        const input = await body(req);
        const record = records.find(
          (candidate) => candidate.instance === input.instanceName,
        );
        if (
          !record ||
          record.prepared ||
          input.qrcode !== false ||
          input.integration !== 'WHATSAPP-BAILEYS'
        )
          throw new Error();
        record.prepared = true;
        return res.writeHead(201).end(
          JSON.stringify({
            instance: { instanceName: record.instance },
            hash: config.gatewayKey,
          }),
        );
      }
      const instance = decodeURIComponent(path.split('/').at(-1));
      const record = records.find(
        (candidate) => candidate.instance === instance && candidate.prepared,
      );
      if (!record) throw new Error();
      if (path.startsWith('/webhook/set/') && req.method === 'POST') {
        const { webhook } = await body(req);
        record.webhook = {
          enabled: webhook.enabled,
          url: webhook.url,
          webhookByEvents: webhook.byEvents,
          webhookBase64: webhook.base64,
          events: webhook.events,
        };
        return res.writeHead(201).end('{"ok":true}');
      }
      if (path.startsWith('/webhook/find/'))
        return res.end(JSON.stringify(record.webhook));
      // Evolution 2.3.7: set returns 201; find returns the flat Setting row.
      if (path.startsWith('/settings/set/') && req.method === 'POST') {
        record.settings = await body(req);
        return res
          .writeHead(201)
          .end(JSON.stringify({ settings: { settings: record.settings } }));
      }
      if (path.startsWith('/settings/find/'))
        return res.end(JSON.stringify(record.settings ?? null));
      if (path.startsWith('/instance/connectionState/'))
        return res.end(
          JSON.stringify({ instance: { state: record.state || 'close' } }),
        );
      if (path.startsWith('/instance/connect/')) {
        if (!record.reserved.has('challenge') || record.issued)
          throw new Error();
        const captured = generationRuntime.captureSocket(record.instance, {});
        if (
          Object.keys(record.source).some(
            (key) => record.source[key] !== captured.source[key],
          )
        )
          throw new Error();
        record.sourceCaptured = true;
        record.issued++;
        record.state = 'connecting';
        return res.end(
          JSON.stringify(
            record.mode === 'qr'
              ? { base64: record.value }
              : { pairingCode: record.value },
          ),
        );
      }
      throw new Error();
    }
    if (req.method !== 'POST') throw new Error();
    const input = await body(req);
    if (req.url?.startsWith('/api/v1/integrations/n8n/whatsapp-control/')) {
      if (
        !equal(req.headers.authorization, config.crmBasic) ||
        req.headers['x-silmer-workflow-key'] !== 'seller-whatsapp-control' ||
        req.headers['x-silmer-workflow-version'] !== '1.0' ||
        !req.headers['x-silmer-execution-id']
      )
        throw new Error();
      if (req.url.endsWith('/results')) {
        const record = records.find(
          (candidate) =>
            candidate.operationId === input.operationId &&
            candidate.resultId === input.resultId,
        );
        if (
          !record ||
          input.lineId !== record.lineId ||
          input.generation !== record.generation ||
          input.effect !== 'connect' ||
          input.outcome !== 'succeeded' ||
          input.providerState !== 'close' ||
          input.webhookVerified !== true ||
          input.bindingVerified !== false ||
          req.headers['idempotency-key'] !== record.resultId ||
          req.headers['x-correlation-id'] !== record.operationId ||
          Object.keys(input).some(
            (key) =>
              ![
                'operationId',
                'lineId',
                'generation',
                'resultId',
                'effect',
                'outcome',
                'providerState',
                'webhookVerified',
                'bindingVerified',
              ].includes(key),
          )
        )
          throw new Error();
        record.completed = true;
        return res.end('{"accepted":true}');
      }
      if (
        !['control', 'challenge'].includes(input.kind) ||
        Object.keys(input).sort().join(',') !== 'envelope,kind'
      )
        throw new Error();
      const record = recordFor(input.envelope, input.kind);
      if (
        req.headers['x-correlation-id'] !== record.operationId ||
        req.headers['idempotency-key'] !==
          (input.kind === 'control' ? record.operationId : record.challengeId)
      )
        throw new Error();
      if (record.reserved.has(input.kind)) throw new Error();
      if (req.url.endsWith('/verify')) return res.end(JSON.stringify(input));
      if (!req.url.endsWith('/operations')) throw new Error();
      record.reserved.add(input.kind);
      record.expiresAt = new Date(Date.now() + 60000).toISOString();
      return res.end(
        JSON.stringify({
          allowed: true,
          ...input.envelope,
          instance: record.instance,
          expectedNumber: '5511000000001',
          webhookUrl: config.webhookUrl,
          source: record.source,
          generationToken: record.generationToken,
          ...(input.kind === 'control'
            ? { resultId: record.resultId }
            : {
                challenge: {
                  challengeId: record.challengeId,
                  operationId: record.operationId,
                  mode: record.mode,
                  expiresAt: record.expiresAt,
                },
              }),
        }),
      );
    }
    if (req.url === '/silmer/whatsapp-control/execute') {
      if (!equal(req.headers.apikey, config.gatewayKey)) throw new Error();
      const record = records.find(
        (candidate) =>
          candidate.instance === input.instance &&
          candidate.source.bindingId === input.source?.bindingId &&
          equal(candidate.generationToken, input.generationToken),
      );
      if (
        !record ||
        !record.reserved.has(input.kind) ||
        input.webhookUrl !== config.webhookUrl
      )
        throw new Error();
      return res.end(JSON.stringify(await adapter.execute(input)));
    }
    if (req.url === '/after-challenge') {
      if (!equal(req.headers.apikey, config.gatewayKey)) throw new Error();
      const record = records.find(
        (candidate) => candidate.challengeId === input.challengeId,
      );
      if (!record || !record.issued) throw new Error();
      if (record.behavior === 'failure')
        return res
          .writeHead(503)
          .end('{"code":"WAP_SYNTHETIC_AFTER_CHALLENGE"}');
      if (record.behavior === 'progress') {
        pending.add(res);
        res.on('close', () => pending.delete(res));
        return;
      }
      return res.end('{"ok":true}');
    }
    throw new Error();
  } catch {
    res.writeHead(403).end('{"code":"WAP_SYNTHETIC_DENIED"}');
  }
}).listen(8080, '0.0.0.0');
