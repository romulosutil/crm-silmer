// Dedicated in-memory canaries. No WhatsApp account, message or business effect.
import { createServer } from 'node:http';
import { randomUUID, randomInt, timingSafeEqual } from 'node:crypto';

const token = process.env.WAP_PROBE_TOKEN;
if (!token) throw new Error('WAP_FIXTURE_DISABLED');
const providerKey = process.env.WAP_PROVIDER_API_KEY ?? token;
const verifyBasic = process.env.WAP_VERIFY_BASIC;
const bindings = JSON.parse(process.env.WAP_GENERATION_BINDINGS ?? '[]');
const activeBindings = new Map();
for (const binding of bindings) {
  if (binding.active)
    activeBindings.set(binding.source.lineId, binding.source.bindingId);
}
const verifications = { accepted: 0, rejected: 0, transient: 0 };
const transientTransitions = new Map();
const equal = (a, b) => {
  const left = Buffer.from(typeof a === 'string' ? a : '');
  const right = Buffer.from(typeof b === 'string' ? b : '');
  return (
    left.length > 0 &&
    left.length === right.length &&
    timingSafeEqual(left, right)
  );
};
async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 4096)
      throw new Error('WAP_FIXTURE_BODY_REJECTED');
  }
  return JSON.parse(body);
}
const canaries = Object.fromEntries(
  ['qr', 'code', 'failure', 'progress', 'manual'].map((mode) => [
    mode,
    {
      code: `WAP-CANARY-${randomUUID()}`,
      pairingCode: randomUUID(),
      base64: `data:image/png;base64,${Buffer.from(randomUUID()).toString('base64')}`,
    },
  ]),
);
canaries.incoming = { pairingCode: String(randomInt(10000000, 100000000)) };
const pending = new Set();
const calls = {};
createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/ingress/verify') {
    try {
      if (
        req.method !== 'POST' ||
        !verifyBasic ||
        !equal(req.headers.authorization, verifyBasic)
      )
        throw new Error('WAP_FIXTURE_DENIED');
      const body = await readBody(req);
      const binding = bindings.find((candidate) =>
        equal(req.headers['x-silmer-wap-generation-token'], candidate.token),
      );
      const matches =
        binding &&
        body &&
        Object.keys(body).length === 2 &&
        body.instance === binding.instance &&
        body.source &&
        Object.keys(body.source).length === 4 &&
        Object.entries(binding.source).every(
          ([key, value]) => body.source[key] === value,
        );
      if (
        !matches ||
        activeBindings.get(binding.source.lineId) !== binding.source.bindingId
      )
        throw new Error('WAP_FIXTURE_DENIED');
      const transition = transientTransitions.get(binding.source.bindingId);
      if (transition) {
        transientTransitions.delete(binding.source.bindingId);
        activeBindings.set(binding.source.lineId, transition.source.bindingId);
        verifications.transient++;
        res.writeHead(503).end('{"error":"WAP_SYNTHETIC_TRANSIENT"}');
        return;
      }
      verifications.accepted++;
      res.end(
        JSON.stringify({ source: binding.source, instance: binding.instance }),
      );
    } catch {
      verifications.rejected++;
      res.writeHead(403).end('{"error":"WAP_INGRESS_DENIED"}');
    }
    return;
  }
  const received = Buffer.from(req.headers['x-wap-probe-token'] ?? '');
  const expected = Buffer.from(token);
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    res.writeHead(403).end();
    return;
  }
  const path = req.url;
  if (path === '/audit') {
    res.end(
      JSON.stringify({ canaries, pending: pending.size, calls, verifications }),
    );
  } else if (path === '/control/advance' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const binding = bindings.find(
        (candidate) => candidate.source.bindingId === body.bindingId,
      );
      if (!binding) throw new Error('WAP_FIXTURE_DENIED');
      const previous = bindings.find(
        (candidate) =>
          candidate.source.bindingId ===
          activeBindings.get(binding.source.lineId),
      );
      if (previous && previous.source.generation > binding.source.generation)
        throw new Error('WAP_FIXTURE_DENIED');
      activeBindings.set(binding.source.lineId, binding.source.bindingId);
      res.end('{"ok":true}');
    } catch {
      res.writeHead(403).end('{"error":"WAP_INGRESS_DENIED"}');
    }
  } else if (
    path === '/control/fail-next-and-advance' &&
    req.method === 'POST'
  ) {
    try {
      const body = await readBody(req);
      const previous = bindings.find(
        (candidate) => candidate.source.bindingId === body.bindingId,
      );
      const replacement = bindings.find(
        (candidate) => candidate.source.bindingId === body.replacementBindingId,
      );
      if (
        !previous ||
        !replacement ||
        previous.instance !== replacement.instance ||
        previous.source.lineId !== replacement.source.lineId ||
        previous.source.accountId !== replacement.source.accountId ||
        previous.source.generation >= replacement.source.generation ||
        activeBindings.get(previous.source.lineId) !== previous.source.bindingId
      )
        throw new Error('WAP_FIXTURE_DENIED');
      transientTransitions.set(previous.source.bindingId, replacement);
      res.end('{"ok":true}');
    } catch {
      res.writeHead(403).end('{"error":"WAP_INGRESS_DENIED"}');
    }
  } else if (path === '/release') {
    for (const waiting of pending) waiting.end('{"ok":true}');
    pending.clear();
    res.end('{"ok":true}');
  } else if (path?.startsWith('/challenge/')) {
    const mode = path.slice('/challenge/'.length);
    if (['provider-qr', 'provider-code'].includes(mode)) {
      // Exactly one mutating connect dispatch per instance, including on timeout.
      if (calls[mode]) return res.writeHead(409).end('{}');
      calls[mode] = 1;
      try {
        const name =
          mode === 'provider-qr' ? 'wap-synthetic-qr' : 'wap-synthetic-code';
        const suffix = mode === 'provider-code' ? '?number=5511000000001' : '';
        const result = await globalThis.fetch(
          `${process.env.WAP_PROVIDER_URL}/instance/connect/${name}${suffix}`,
          {
            headers: { apikey: providerKey },
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          },
        );
        const data = await result.json();
        // In memory only, for negative scans of actual QR/code as well as canaries.
        canaries[mode] = data;
        res.writeHead(result.status).end(JSON.stringify(data));
      } catch {
        res.writeHead(502).end('{"error":"WAP_EFFECT_UNCERTAIN"}');
      }
      return;
    }
    if (!canaries[mode]) return res.writeHead(400).end('{}');
    calls[mode] = (calls[mode] ?? 0) + 1;
    res.end(JSON.stringify(canaries[mode]));
  } else if (path === '/finish/progress') {
    pending.add(res);
    res.on('close', () => pending.delete(res));
  } else if (path === '/finish/failure') {
    res.writeHead(500).end('{"error":"WAP_SYNTHETIC_FAILURE"}');
  } else if (path?.startsWith('/finish/')) {
    res.end('{"ok":true}');
  } else res.writeHead(404).end('{}');
}).listen(8080, '0.0.0.0');
