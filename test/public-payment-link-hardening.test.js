import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createApi } from '../apps/api/src/app.js';
import { readLinkToken } from '../apps/api/src/order-billing-links.js';
import { paymentLinkTokenLimiter } from '../apps/api/src/order-billing-routes.js';
import {
  createSafeLogger,
  MetricRegistry,
} from '../modules/shared/src/index.js';

// LPC-02 hardening (QA exploratory findings): every token shape gets the one
// uniform answer, every public 429 carries Retry-After and none logs `error`.
const KNOWN = '7Q4K2MABCDEFGHJKMNPQRSTVWX';
const UNKNOWN = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ';
const ORIGIN = 'https://crm.example.test';
const PREFIX = '/api/v1/payment-links/';
const VOLATILE = new Set(['date', 'x-request-id', 'x-correlation-id']);
const FUZZ_SEED = Number(process.env.PUBLIC_PAYMENT_FUZZ_SEED ?? 0x5eed2026);

/** Behaves like the runtime: malformed or unknown tokens read as unavailable
 * without touching storage; only KNOWN resolves. */
function harness() {
  /** @type {Array<Record<string, unknown>>} */
  const records = [];
  const logger = createSafeLogger({
    service: 'crm-silmer-api',
    sink: (record) => records.push(record),
  });
  /** @type {string[]} */
  const seen = [];
  const billing = {
    publicOrigins: [ORIGIN],
    authorizeRead: async () => ({ actor: { id: 'synthetic-user' } }),
    authorizeWrite: async () => ({ actor: { id: 'synthetic-user' } }),
    async publicLink(/** @type {{token: unknown}} */ input) {
      seen.push(String(input.token));
      return readLinkToken(input.token) === KNOWN
        ? {
            state: 'ready',
            orderNumber: '07-CRM',
            kind: 'signal',
            amountCents: 1,
          }
        : { state: 'unavailable' };
    },
    async publicCheckout(/** @type {{token: unknown}} */ input) {
      seen.push(String(input.token));
      return readLinkToken(input.token) === KNOWN
        ? { statusCode: 202, body: { state: 'in_progress' } }
        : { statusCode: 200, body: { state: 'unavailable' } };
    },
  };
  const api = createApi(
    {},
    { logger, metrics: new MetricRegistry({ logger }), billing },
  );
  return { api, records, seen };
}

/** @param {any} response */
function shape(response) {
  return {
    status: response.statusCode,
    body: response.body,
    headers: Object.fromEntries(
      Object.entries(response.headers)
        .map(([name, value]) => [
          name,
          VOLATILE.has(name) ? '<volatile>' : String(value),
        ])
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  };
}

let ipCounter = 0;
/** A fresh client address, so per-IP budgets never mask the property. */
function nextIp() {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/** @param {any} api @param {string} encoded @param {'GET'|'POST'} method @param {Record<string,string>} [headers] */
function call(api, encoded, method = 'GET', headers = {}) {
  return api.inject({
    method,
    url:
      method === 'GET' ? `${PREFIX}${encoded}` : `${PREFIX}${encoded}/checkout`,
    headers,
    remoteAddress: nextIp(),
  });
}

/** mulberry32: small, seeded, reproducible. @param {number} seed */
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PUNCTUATION = '/.%?#&=+ \\;:@!$\'()*,~-_[]{}|^`"<>';
/** Code points, never lone surrogates (encodeURIComponent would throw). */
const UNICODE = [
  0xe9, 0xdf, 0x130, 0x131, 0x17f, 0x212a, 0xfb00, 0x200b, 0x202e, 0xfeff,
  0xffff, 0x4e2d, 0x0627, 0x1f600, 0x1f4a9, 0x10ffff,
];

/** @param {() => number} random */
function randomLength(random) {
  const bucket = random();
  const between = (/** @type {number} */ low, /** @type {number} */ high) =>
    low + Math.floor(random() * (high - low + 1));
  if (bucket < 0.05) return between(0, 3);
  if (bucket < 0.35) return between(4, 40);
  if (bucket < 0.6) return between(90, 140);
  if (bucket < 0.85) return between(141, 1200);
  return between(1201, 5000);
}

/** @param {() => number} random */
function randomChar(random) {
  const kind = random();
  const pick = (/** @type {string} */ from) =>
    from[Math.floor(random() * from.length)];
  if (kind < 0.35) return pick(CROCKFORD);
  if (kind < 0.5) return pick(CROCKFORD).toLowerCase();
  if (kind < 0.62) return pick('ILOUilou');
  if (kind < 0.8) return pick(PUNCTUATION);
  if (kind < 0.88)
    return String.fromCharCode(
      random() < 0.9 ? Math.floor(random() * 32) : 0x7f,
    );
  return String.fromCodePoint(UNICODE[Math.floor(random() * UNICODE.length)]);
}

/** A segment made only of dots is a dot-segment: every URL parser (the
 * browser's included) resolves it before the server sees the request, so it
 * is not a token the public route can receive. @param {string} segment */
const notDotSegment = (segment) =>
  /^\.{1,2}$/u.test(segment) ? `${segment}x` : segment;

/** @param {() => number} random */
function randomCase(random) {
  let token = '';
  const length = randomLength(random);
  // Whole characters only (no slice): a cut surrogate pair is not a string a
  // browser can put in a URL. Astral characters may overshoot by one unit.
  while (token.length < length) token += randomChar(random);
  const mode = random();
  let encoded;
  if (mode < 0.7) {
    // What the page itself sends: encodeURIComponent of whatever it holds.
    encoded = notDotSegment(encodeURIComponent(token));
  } else if (mode < 0.85) {
    // Raw slashes: the token spans several path segments.
    encoded = encodeURIComponent(token)
      .split('%2F')
      .map(notDotSegment)
      .join('/');
  } else {
    // A malformed %-sequence the router cannot decode.
    const bad = ['%', '%z', '%zz', '%E0%A4', '%C3', '%%', '%G0'][
      Math.floor(random() * 7)
    ];
    const plain = encodeURIComponent(token);
    const at = Math.floor(random() * (plain.length + 1));
    // Never split an existing escape: insert at a character boundary.
    const boundary = plain.slice(0, at).replace(/%[0-9A-F]?$/u, '');
    encoded = `${boundary}${bad}${plain.slice(boundary.length)}`;
  }
  return { token, encoded, method: random() < 0.6 ? 'GET' : 'POST' };
}

test('LPC-02: a token over 100 characters gets the exact unknown-token answer, never a 414 echo', async (t) => {
  const { api, records } = harness();
  t.after(() => api.close());
  const baselineRead = shape(await call(api, UNKNOWN));
  const baselineClick = shape(
    await call(api, UNKNOWN, 'POST', { origin: ORIGIN }),
  );
  const baselineForeign = shape(await call(api, UNKNOWN, 'POST'));
  assert.equal(baselineRead.status, 200);
  assert.equal(baselineRead.body, '{"state":"unavailable"}');
  assert.equal(baselineRead.headers['cache-control'], 'no-store');
  assert.equal(baselineRead.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(baselineRead.headers['referrer-policy'], 'no-referrer');
  assert.equal(baselineClick.status, 200);
  assert.equal(baselineForeign.status, 403);
  for (const length of [101, 150, 1000, 5000]) {
    const token = `${KNOWN}${'Q'.repeat(length - KNOWN.length)}`;
    assert.deepEqual(
      shape(await call(api, token)),
      baselineRead,
      `GET ${length}`,
    );
    assert.deepEqual(
      shape(await call(api, token, 'POST', { origin: ORIGIN })),
      baselineClick,
      `POST ${length}`,
    );
    assert.deepEqual(
      shape(await call(api, token, 'POST', { origin: 'https://evil.test' })),
      baselineForeign,
      `POST foreign ${length}: Origin is still checked first`,
    );
    assert.equal(JSON.stringify(records).includes(token), false);
  }
  // Only `{token}/checkout` is a click; other POSTs are 404 without echo.
  for (const url of [
    `${PREFIX}${UNKNOWN}`,
    `${PREFIX}${UNKNOWN}%2Fcheckout`,
    `${PREFIX}checkout`,
  ]) {
    const response = await api.inject({
      method: 'POST',
      url,
      headers: { origin: ORIGIN },
      remoteAddress: nextIp(),
    });
    assert.equal(response.statusCode, 404, url);
    assert.equal(response.body.includes(UNKNOWN), false);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('LPC-02: long tokens still count against the per-IP and per-token limits', async (t) => {
  const { api } = harness();
  t.after(() => api.close());
  const ip = '10.200.0.1';
  const long = (/** @type {number} */ index) =>
    `${'A'.repeat(150)}${index.toString(36)}`;
  for (let index = 0; index < 120; index += 1)
    assert.equal(
      (await api.inject({ url: `${PREFIX}${long(index)}`, remoteAddress: ip }))
        .statusCode,
      200,
    );
  const blocked = await api.inject({
    url: `${PREFIX}${UNKNOWN}`,
    remoteAddress: ip,
  });
  assert.equal(blocked.statusCode, 429, 'the 121st read from that IP waits');
  // Per token: one long token, many addresses.
  const same = 'B'.repeat(4000);
  const statuses = [];
  for (let index = 0; index < 61; index += 1)
    statuses.push(
      (
        await api.inject({
          url: `${PREFIX}${same}`,
          remoteAddress: `10.201.0.${index}`,
        })
      ).statusCode,
    );
  assert.equal(statuses.filter((s) => s === 200).length, 60);
  assert.equal(statuses.at(-1), 429);
  // Case-insensitive, like the token itself: lower case shares the budget.
  assert.equal(
    (
      await api.inject({
        url: `${PREFIX}${same.toLowerCase()}`,
        remoteAddress: '10.201.1.1',
      })
    ).statusCode,
    429,
  );
});

test(`LPC-02 property: seeded random tokens always get the uniform answer (seed ${FUZZ_SEED})`, async (t) => {
  const { api, records } = harness();
  t.after(() => api.close());
  const random = prng(FUZZ_SEED);
  const baseline = {
    GET: shape(await call(api, UNKNOWN)),
    POST: shape(await call(api, UNKNOWN, 'POST', { origin: ORIGIN })),
  };
  const cases = Number(process.env.PUBLIC_PAYMENT_FUZZ_CASES ?? 600);
  let longCases = 0;
  let undecodable = 0;
  for (let index = 0; index < cases; index += 1) {
    const sample = randomCase(random);
    if (readLinkToken(sample.token) === KNOWN) continue;
    if (sample.token.length > 100) longCases += 1;
    if (/%(?![0-9A-F]{2})/u.test(sample.encoded)) undecodable += 1;
    const where = `seed=${FUZZ_SEED} case=${index} method=${sample.method} length=${sample.token.length} (rerun with PUBLIC_PAYMENT_FUZZ_SEED=${FUZZ_SEED})`;
    const response = await call(
      api,
      sample.encoded,
      /** @type {'GET'|'POST'} */ (sample.method),
      sample.method === 'POST' ? { origin: ORIGIN } : {},
    );
    assert.ok(
      response.statusCode < 500 && response.statusCode !== 414,
      `${where}: status ${response.statusCode}`,
    );
    assert.deepEqual(
      shape(response),
      baseline[/** @type {'GET'|'POST'} */ (sample.method)],
      where,
    );
    if (sample.token.length >= 8)
      assert.equal(response.body.includes(sample.token), false, where);
  }
  assert.ok(longCases > cases / 4, 'the generator reaches past 100 chars');
  assert.ok(undecodable > 0, 'the generator reaches the router error path');
  const logged = JSON.stringify(records);
  assert.equal(logged.includes('payment-links'), false);
  assert.equal(
    records.some((record) => record.level === 'error'),
    false,
  );
});

test('LPC-02 observability: no public 429 logs error or UNCLASSIFIED_ERROR, and no token reaches any log line', async (t) => {
  const { api, records } = harness();
  t.after(() => api.close());
  const longToken = `${KNOWN}${'R'.repeat(4000)}`;
  let limited = 0;
  const count = (/** @type {any} */ response) => {
    if (response.statusCode === 429) {
      limited += 1;
      assert.match(String(response.headers['retry-after']), /^[1-9]\d*$/u);
      assert.equal(response.json().code, 'RATE_LIMITED');
      assert.equal(response.headers['cache-control'], 'no-store');
    }
  };
  // Per IP, GET and POST (distinct long tokens, one address each).
  for (let index = 0; index < 122; index += 1)
    count(
      await api.inject({
        url: `${PREFIX}${longToken}${index}`,
        remoteAddress: '10.210.0.1',
      }),
    );
  for (let index = 0; index < 22; index += 1)
    count(
      await api.inject({
        method: 'POST',
        url: `${PREFIX}${longToken}${index}/checkout`,
        headers: { origin: ORIGIN },
        remoteAddress: '10.210.0.2',
      }),
    );
  // Per token, GET and POST (one token, many addresses).
  for (let index = 0; index < 62; index += 1)
    count(
      await api.inject({
        url: `${PREFIX}${KNOWN}`,
        remoteAddress: `10.211.0.${index}`,
      }),
    );
  for (let index = 0; index < 12; index += 1)
    count(
      await api.inject({
        method: 'POST',
        url: `${PREFIX}${longToken}/checkout`,
        headers: { origin: ORIGIN },
        remoteAddress: `10.212.0.${index}`,
      }),
    );
  assert.equal(limited, 2 + 2 + 2 + 2);
  assert.equal(
    records.filter((record) => record.level === 'error').length,
    0,
    'a visitor cannot raise error logs',
  );
  const logged = JSON.stringify(records);
  assert.equal(logged.includes('UNCLASSIFIED_ERROR'), false);
  const warned = records.filter(
    (record) =>
      record.level === 'warn' &&
      record.event === 'api_request_failed' &&
      record.error_code === 'RATE_LIMITED',
  );
  assert.equal(warned.length, limited, 'one classified warn per 429');
  for (const record of warned) {
    assert.match(String(record.request_id), /^[0-9a-f-]{36}$/u);
    assert.equal(record.redacted_field_count, undefined);
  }
  for (const secret of [KNOWN, longToken, KNOWN.toLowerCase(), 'R'.repeat(40)])
    assert.equal(logged.includes(secret), false);
  assert.equal(logged.includes('payment-links'), false);
});

test('LPC-02 property: Retry-After of the per-token limit is whole seconds, within the window, and enough', () => {
  const random = prng(FUZZ_SEED ^ 0xa11ce);
  for (const [max, windowMs] of /** @type {Array<[number, number]>} */ ([
    [60, 60000],
    [10, 60000],
    [1, 1000],
    [3, 1500],
  ])) {
    for (let round = 0; round < 200; round += 1) {
      let now = 1_700_000_000_000 + Math.floor(random() * 1e9);
      const limiter = paymentLinkTokenLimiter(max, windowMs, () => now);
      const start = now;
      for (let index = 0; index < max; index += 1)
        assert.equal(limiter('T').allowed, true);
      now = start + Math.floor(random() * windowMs);
      const refused = limiter('T');
      const where = `seed=${FUZZ_SEED} max=${max} window=${windowMs} offset=${now - start}`;
      assert.equal(refused.allowed, false, where);
      assert.ok(Number.isInteger(refused.retryAfter), where);
      assert.ok(refused.retryAfter >= 1, where);
      assert.ok(refused.retryAfter <= Math.ceil(windowMs / 1000), where);
      if (refused.retryAfter > 1) {
        // Tight: one second earlier the window would still be closed.
        const earlier = now + (refused.retryAfter - 1) * 1000;
        if (earlier < start + windowMs) {
          const saved = now;
          now = earlier;
          assert.equal(limiter('T').allowed, false, where);
          now = saved;
        }
      }
      now += refused.retryAfter * 1000;
      assert.equal(
        limiter('T').allowed,
        true,
        `${where}: frees after Retry-After`,
      );
    }
  }
});

test('LPC-02 property: every public 429 (per IP and per token, GET and POST) carries a Retry-After that frees the next request', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  const { api } = harness();
  t.after(() => api.close());
  const random = prng(FUZZ_SEED ^ 0xbeef);
  /** @type {Array<{name: string, budget: number, send: (i: number, ip: string) => Promise<any>}>} */
  const limits = [
    {
      name: 'GET per IP',
      budget: 120,
      send: (i, ip) =>
        api.inject({
          url: `${PREFIX}${'G'.repeat(30)}${i}`,
          remoteAddress: ip,
        }),
    },
    {
      name: 'POST per IP',
      budget: 20,
      send: (i, ip) =>
        api.inject({
          method: 'POST',
          url: `${PREFIX}${'P'.repeat(30)}${i}/checkout`,
          headers: { origin: ORIGIN },
          remoteAddress: ip,
        }),
    },
    {
      name: 'GET per token',
      budget: 60,
      send: (i, ip) =>
        api.inject({
          url: `${PREFIX}${KNOWN}`,
          remoteAddress: `${ip}${i % 2}`,
        }),
    },
    {
      name: 'POST per token',
      budget: 10,
      send: (i, ip) =>
        api.inject({
          method: 'POST',
          url: `${PREFIX}${'Y'.repeat(120)}/checkout`,
          headers: { origin: ORIGIN },
          remoteAddress: `${ip}${i % 2}`,
        }),
    },
  ];
  let round = 0;
  for (const limit of limits)
    for (let sample = 0; sample < 5; sample += 1) {
      round += 1;
      const ip = `10.220.${round}.1`;
      for (let index = 0; index < limit.budget; index += 1)
        assert.ok(
          (await limit.send(index, ip)).statusCode < 300,
          `${limit.name} within budget`,
        );
      const offset = Math.floor(random() * 59_000);
      t.mock.timers.tick(offset);
      const refused = await limit.send(limit.budget, ip);
      const where = `${limit.name} seed=${FUZZ_SEED} offset=${offset}`;
      assert.equal(refused.statusCode, 429, where);
      const retryAfter = refused.headers['retry-after'];
      assert.match(String(retryAfter), /^[1-9]\d*$/u, where);
      assert.ok(Number(retryAfter) <= 60, where);
      assert.ok(
        Math.abs(Number(retryAfter) - Math.ceil((60_000 - offset) / 1000)) <= 1,
        `${where}: Retry-After ${retryAfter} matches the window left`,
      );
      t.mock.timers.tick(Number(retryAfter) * 1000);
      assert.ok(
        (await limit.send(limit.budget + 1, ip)).statusCode < 300,
        `${where}: passes after Retry-After`,
      );
      // Leave every window behind before the next sample.
      t.mock.timers.tick(61_000);
    }
});

/** A real socket: no inject URL normalization, the raw path reaches Node. */
async function raw(
  /** @type {any} */ api,
  /** @type {string} */ path,
  method = 'GET',
  headers = {},
) {
  const address = api.server.address();
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { host: '127.0.0.1', port: address.port, path, method, headers },
      (incoming) => {
        let text = '';
        incoming.setEncoding('utf8');
        incoming.on('data', (chunk) => (text += chunk));
        incoming.on('end', () =>
          resolve({
            status: incoming.statusCode,
            headers: incoming.headers,
            body: text,
          }),
        );
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('LPC-02: over a real socket, raw dot-segments, bad escapes and long tokens stay uniform; router errors never echo the path', async (t) => {
  const { api, records } = harness();
  t.after(() => api.close());
  await api.listen({ host: '127.0.0.1', port: 0 });
  const baseline = await raw(api, `${PREFIX}${UNKNOWN}`);
  assert.equal(baseline.status, 200);
  for (const path of [
    `${PREFIX}${'W'.repeat(5000)}`,
    `${PREFIX}..`,
    `${PREFIX}../${UNKNOWN}`,
    `${PREFIX}%zz${UNKNOWN}`,
    `${PREFIX}${UNKNOWN}%E0%A4`,
    `${PREFIX}%00`,
    PREFIX,
  ]) {
    const response = /** @type {any} */ (await raw(api, path));
    assert.equal(response.status, 200, path.slice(0, 60));
    assert.equal(response.body, baseline.body, path.slice(0, 60));
    for (const name of [
      'cache-control',
      'x-robots-tag',
      'referrer-policy',
      'content-type',
    ])
      assert.equal(
        response.headers[name],
        baseline.headers[name],
        `${name} ${path.slice(0, 60)}`,
      );
    assert.ok(response.headers['x-request-id']);
  }
  const click = /** @type {any} */ (
    await raw(api, `${PREFIX}%zz/checkout`, 'POST', { origin: ORIGIN })
  );
  assert.equal(click.status, 200);
  assert.equal(click.body, '{"state":"unavailable"}');
  const foreign = /** @type {any} */ (
    await raw(api, `${PREFIX}%zz/checkout`, 'POST')
  );
  assert.equal(foreign.status, 403);
  assert.equal(JSON.parse(foreign.body).code, 'FORBIDDEN');
  // Elsewhere the router errors keep their status but stop echoing the path.
  const secret = 'S'.repeat(200);
  const tooLong = /** @type {any} */ (
    await raw(api, `/api/v1/orders/${secret}/billing`)
  );
  assert.equal(tooLong.status, 414);
  assert.equal(tooLong.body.includes(secret), false);
  assert.equal(tooLong.headers['cache-control'], 'no-store');
  const badEscape = /** @type {any} */ (
    await raw(api, `/api/v1/orders/%zz${secret}/billing`)
  );
  assert.equal(badEscape.status, 400);
  assert.equal(badEscape.body.includes(secret), false);
  assert.equal(JSON.stringify(records).includes(secret), false);
  assert.equal(JSON.stringify(records).includes('W'.repeat(40)), false);
});

// The closed set of statuses the click can answer (docs/api/order-billing-links.md).
const CLICK_STATUSES = new Set([200, 202, 400, 403, 404, 413, 415, 429]);
const CLICK_PROBLEMS = new Map([
  [400, 'INVALID_REQUEST'],
  [403, 'FORBIDDEN'],
  [404, 'INVALID_REQUEST'],
  [413, 'REQUEST_TOO_LARGE'],
  [415, 'UNSUPPORTED_MEDIA_TYPE'],
  [429, 'RATE_LIMITED'],
]);
const WARN_CODES = new Set([
  'INVALID_REQUEST',
  'REQUEST_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
]);
const BODY_LIMIT = 1024;

/** @param {() => number} random */
function randomBody(random) {
  const pick = (/** @type {any[]} */ from) =>
    from[Math.floor(random() * from.length)];
  const deep = (/** @type {number} */ n) =>
    pick([
      `${'['.repeat(n)}${']'.repeat(n)}`,
      `${'{"a":'.repeat(n)}1${'}'.repeat(n)}`,
      '['.repeat(n),
    ]);
  const unicode = () =>
    Array.from({ length: 1 + Math.floor(random() * 40) }, () =>
      String.fromCodePoint(pick(UNICODE)),
    ).join('');
  const control = () =>
    Array.from({ length: 1 + Math.floor(random() * 40) }, () =>
      String.fromCharCode(Math.floor(random() * 32)),
    ).join('');
  const kind = random();
  /** @type {Buffer} */
  let bytes;
  if (kind < 0.1) bytes = Buffer.from(pick(['{}', '', ' {} ', 'null', '{ }']));
  else if (kind < 0.3)
    bytes = Buffer.from(
      pick([
        '{bad',
        '[',
        '{"a":',
        '}',
        '{"a" 1}',
        "{'a':1}",
        'NaN',
        '{}}',
        '\u0000{}',
      ]),
    );
  else if (kind < 0.42)
    bytes = Buffer.from(
      pick([
        '{"amountCents":1}',
        '[]',
        '"x"',
        '1',
        'true',
        '{"__proto__":{"x":1}}',
        '{"constructor":{"prototype":{"x":1}}}',
      ]),
    );
  else if (kind < 0.55)
    bytes = Buffer.from(deep(1 + Math.floor(random() * 500)));
  else if (kind < 0.67)
    bytes = Buffer.from(
      pick([
        JSON.stringify({ text: unicode() }),
        unicode(),
        `{"${unicode()}":1}`,
      ]),
    );
  else if (kind < 0.77)
    bytes = Buffer.from(pick([control(), `{${control()}}`]));
  else if (kind < 0.87)
    bytes = Buffer.from(
      Array.from({ length: Math.floor(random() * 600) }, () =>
        Math.floor(random() * 256),
      ),
    );
  else {
    // At the limit and one byte past it: valid JSON padded with spaces.
    const size = pick([
      BODY_LIMIT - 1,
      BODY_LIMIT,
      BODY_LIMIT + 1,
      4 * BODY_LIMIT,
    ]);
    bytes = Buffer.from(`{}${' '.repeat(size - 2)}`);
  }
  const contentType = pick([
    'application/json',
    'application/json',
    'application/json; charset=utf-8',
    'APPLICATION/JSON',
    'application/json; charset=latin1',
    'application/merge-patch+json',
    'text/plain',
    'application/xml',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'a/b/c',
    ';;;',
    '',
    undefined,
  ]);
  return { bytes, contentType };
}

test(`LPC-02 property: seeded random click bodies never reach 5xx, an error log or a logged token (seed ${FUZZ_SEED})`, async (t) => {
  const { api, records } = harness();
  t.after(() => api.close());
  const random = prng(FUZZ_SEED ^ 0xb0d1);
  const cases = Number(process.env.PUBLIC_PAYMENT_FUZZ_CASES ?? 600);
  /** @type {Set<number>} */
  const statuses = new Set();
  for (let index = 0; index < cases; index += 1) {
    const { bytes, contentType } = randomBody(random);
    const foreign = random() < 0.15;
    const token =
      random() < 0.5
        ? `${'Z'.repeat(25)}${index.toString(36)}`
        : `${KNOWN.toLowerCase()}${'q'.repeat(100 + Math.floor(random() * 2000))}`;
    /** @type {Record<string, string>} */
    const headers = { origin: foreign ? 'https://evil.example.test' : ORIGIN };
    if (contentType !== undefined) headers['content-type'] = contentType;
    const where = `seed=${FUZZ_SEED} case=${index} type=${JSON.stringify(contentType)} bytes=${bytes.length} foreign=${foreign} (rerun with PUBLIC_PAYMENT_FUZZ_SEED=${FUZZ_SEED})`;
    const mark = records.length;
    const response = await api.inject({
      method: 'POST',
      url: `${PREFIX}${encodeURIComponent(token)}/checkout`,
      headers,
      payload: bytes,
      remoteAddress: nextIp(),
    });
    const status = response.statusCode;
    statuses.add(status);
    assert.ok(CLICK_STATUSES.has(status), `${where}: status ${status}`);
    assert.ok(status < 500, where);
    if (foreign) assert.equal(status, 403, `${where}: Origin before the body`);
    if (status === 413) assert.ok(bytes.length > BODY_LIMIT, where);
    if (bytes.length > BODY_LIMIT && status !== 403)
      assert.ok([413, 415].includes(status), `${where}: ${status}`);
    assert.equal(response.headers['cache-control'], 'no-store', where);
    assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow', where);
    assert.equal(response.headers['referrer-policy'], 'no-referrer', where);
    if (status === 200)
      assert.equal(response.body, '{"state":"unavailable"}', where);
    else {
      const code = CLICK_PROBLEMS.get(status);
      assert.deepEqual(
        response.json(),
        { type: 'about:blank', title: code, status, code },
        `${where}: a fixed problem, nothing echoed`,
      );
    }
    const fresh = records.slice(mark);
    assert.equal(
      fresh.filter((record) => record.level === 'error').length,
      0,
      `${where}: no error log`,
    );
    const warns = fresh.filter((record) => record.level === 'warn');
    assert.ok(warns.length <= 1, `${where}: at most one warn`);
    for (const record of warns) {
      assert.equal(record.event, 'api_request_failed', where);
      assert.ok(WARN_CODES.has(String(record.error_code)), where);
    }
    if (status === 413 || status === 415)
      assert.equal(warns.length, 1, `${where}: one classified warn`);
    const logged = JSON.stringify(fresh);
    assert.equal(logged.includes(token), false, where);
    assert.equal(logged.includes(token.toUpperCase()), false, where);
  }
  for (const expected of [200, 400, 403, 413, 415])
    assert.ok(statuses.has(expected), `the generator reaches ${expected}`);
  assert.equal(JSON.stringify(records).includes('UNCLASSIFIED_ERROR'), false);
});

test('LPC-02: broken JSON on the click answers a classified 400 with the public headers and one warn; elsewhere nothing changes', async (t) => {
  const { api, records } = harness();
  t.after(() => api.close());
  const response = await api.inject({
    method: 'POST',
    url: `${PREFIX}${UNKNOWN}/checkout`,
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    payload: `{"token":"${UNKNOWN}"`,
    remoteAddress: nextIp(),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'INVALID_REQUEST');
  assert.equal(response.body.includes(UNKNOWN), false);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
  const warns = records.filter((record) => record.level === 'warn');
  assert.deepEqual(
    warns.map((record) => record.error_code),
    ['INVALID_REQUEST'],
  );
  assert.equal(JSON.stringify(records).includes(UNKNOWN), false);
  // A foreign Origin is refused before the body is even parsed.
  const foreign = await api.inject({
    method: 'POST',
    url: `${PREFIX}${UNKNOWN}/checkout`,
    headers: {
      origin: 'https://evil.test',
      'content-type': 'application/json',
    },
    payload: '{bad',
    remoteAddress: nextIp(),
  });
  assert.equal(foreign.statusCode, 403);
  // Outside the public prefix the root onError still logs `error`.
  const mark = records.length;
  await api.inject({
    method: 'POST',
    url: '/api/v1/orders/order-synthetic/billing/links',
    headers: { 'content-type': 'application/json', cookie: 'x' },
    payload: '{bad',
  });
  assert.ok(
    records.slice(mark).some((record) => record.level === 'error'),
    'non-public routes keep their logging',
  );
});
