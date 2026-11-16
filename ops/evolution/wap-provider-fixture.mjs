// Dedicated in-memory canaries. No WhatsApp account, message or business effect.
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const token = process.env.WAP_PROBE_TOKEN;
if (!token) throw new Error('WAP_FIXTURE_DISABLED');
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
const pending = new Set();
const calls = {};
createServer(async (req, res) => {
  const received = Buffer.from(req.headers['x-wap-probe-token'] ?? '');
  const expected = Buffer.from(token);
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const path = req.url;
  if (path === '/audit') {
    res.end(JSON.stringify({ canaries, pending: pending.size, calls }));
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
            headers: { apikey: token },
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
