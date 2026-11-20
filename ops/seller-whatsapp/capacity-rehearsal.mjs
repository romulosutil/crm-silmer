#!/usr/bin/env node
// WAP-T05-01 (WAP-12/16): local synthetic capacity rehearsal for the seller
// WhatsApp stage 1 paths. It composes the real API (createServerApi), the real
// PostgreSQL adapters and the real n8n command worker against a DEDICATED
// synthetic database on loopback. Nothing leaves this host: the worker's n8n
// transport is an in-process stub and no provider (Evolution/Meta/n8n) is
// contacted. Output holds only aggregates: no phone, message body, cookie,
// token, QR or secret.
//
// Usage (Git Bash):
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54340/crm_silmer_test_a \
//     node ops/seller-whatsapp/capacity-rehearsal.mjs --sellers=2,10
//
// The script DROPS and re-migrates the `crm` and `crm_meta` schemas of that
// database for every scenario. It refuses any database whose name is not
// `crm_silmer_test` or `crm_silmer_test_<suffix>` and any non-loopback host.
//
// Results are local synthetic numbers from a developer host. They do not
// prove production capacity (EasyPanel/VPS, Evolution, n8n, network).

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { clearInterval, setInterval } from 'node:timers';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { createIdentityApiRuntime } from '../../apps/api/src/identity-runtime.js';
import { createServerApi } from '../../apps/api/src/server.js';
import { createWorkerRuntime } from '../../apps/worker/src/worker.js';
import {
  contactPhoneHash,
  encryptContactDetails,
} from '../../modules/contacts/src/index.js';
import {
  loadMigrations,
  migrate,
  withTransaction,
} from '../../modules/database/src/index.js';
import { hashPassword } from '../../modules/identity-access/src/index.js';
import {
  createN8nIntegrationService,
  encryptJson,
  PostgresN8nCommandStore,
  PostgresN8nIntegrationRepository,
} from '../../modules/n8n-integration/src/index.js';
import { createSafeLogger } from '../../modules/shared/src/index.js';

const { Pool } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// ---------------------------------------------------------------- arguments
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((value) => value.startsWith('--'))
    .map((value) => {
      const [key, ...rest] = value.slice(2).split('=');
      return [key, rest.join('=') || 'true'];
    }),
);
const list = (/** @type {string|undefined} */ value, fallback) =>
  (value ?? fallback).split(',').map((item) => {
    const number = Number(item);
    if (!Number.isSafeInteger(number) || number < 1)
      throw new Error(`Invalid numeric list item: ${item}`);
    return number;
  });
const PARAMS = Object.freeze({
  sellerCounts: list(args.sellers, '2,10'),
  portfolioSizes: list(args.portfolio, '500,2000'),
  customersPerSeller: Number(args.customers ?? 10),
  messagesPerCustomer: Number(args.messages ?? 4),
  inboundConcurrency: Number(args.concurrency ?? 16),
  sameConversationBurst: 20,
  sseStreamsPerSeller: 2,
  listRequestsPerSeller: 20,
  ordersPerSeller: 3,
  firstSendsPerSeller: 3,
  personalSendsPerSeller: 3,
  personalSendBurst: 5,
  rateLimitProbeRequests: 70,
  apiPoolMax: 10, // createDatabase default (modules/database/src/database.js)
  workerPoolMax: 10,
});
const OUT = args.out ?? join(here, 'capacity.evidence.json');

// ------------------------------------------------------------ safety guards
/** @param {string|undefined} raw */
function requireSyntheticDatabase(raw) {
  if (!raw) throw new Error('Set TEST_DATABASE_URL to a synthetic database');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('TEST_DATABASE_URL must be a postgres:// URL');
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host))
    throw new Error('Refusing a non-loopback database host');
  // `?host=` or similar parameters could redirect the connection.
  if ([...url.searchParams.keys()].length)
    throw new Error('Refusing connection parameters in TEST_DATABASE_URL');
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^crm_silmer_test(?:_[a-z0-9]+)?$/u.test(name))
    throw new Error('Refusing a database other than crm_silmer_test[_x]');
  return url;
}
const DB_URL = requireSyntheticDatabase(process.env.TEST_DATABASE_URL);

// ------------------------------------------------------------ synthetic data
const KEY = Buffer.alloc(32, 93);
const SECRET = KEY.toString('base64url');
const ORIGIN = 'http://127.0.0.1:4199';
const PASSWORD = 'synthetic capacity rehearsal password';
const AUTOMATION_ID = 'wap-capacity-synthetic-n8n';
const AUTOMATION_SECRET = 'synthetic n8n credential for capacity rehearsal';
const N8N_IP = '127.0.0.2';
/** Seller i gets its own loopback alias, i.e. its own client address. */
const sellerIp = (/** @type {number} */ i) => `127.0.0.${10 + i}`;
/** Fresh aliases for the per-address rate-limit probe. */
const probeIp = (/** @type {number} */ i) => `127.0.1.${10 + i}`;
/**
 * Synthetic E.164 +55 11 000 xxxxxx. DDD 00 is refused by
 * normalizeContactPhone, so the DDD is 11; a subscriber number starting with
 * 0 is not assignable in Brazil. Never a real line or customer.
 * @param {number} block @param {number} n
 */
const fakePhone = (block, n) => `5511000${block}${String(n).padStart(5, '0')}`;

/** @param {string[]} ids */
function environmentFor(ids) {
  const json = JSON.stringify(ids);
  return Object.freeze({
    APP_ENV: 'development',
    APP_ORIGIN: ORIGIN,
    AUTH_THROTTLE_HMAC_KEY: SECRET,
    IDENTITY_BOOTSTRAP_TOKEN: 'synthetic unused capacity bootstrap token',
    IDEMPOTENCY_ENVELOPE_KEY: SECRET,
    CONTACT_IDENTITY_ENVELOPE_KEY: SECRET,
    CONTACT_IDENTITY_LOOKUP_KEY: SECRET,
    DEAL_ENVELOPE_KEY: SECRET,
    HANDOFF_ENVELOPE_KEY: SECRET,
    INBOX_MESSAGE_ENVELOPE_KEY: SECRET,
    N8N_INTEGRATION_ENVELOPE_KEY: SECRET,
    OPERATION_CURSOR_HMAC_KEY: SECRET,
    FAB_CODE: '01',
    CRM_AUTOMATION_CLIENT_ID: AUTOMATION_ID,
    CRM_AUTOMATION_CLIENT_SECRET: AUTOMATION_SECRET,
    N8N_INTEGRATION_ENABLED: 'true',
    PRIVATE_MEDIA_MAX_BYTES: String(64 * 1024 * 1024),
    PRIVATE_MEDIA_MAX_FILE_BYTES: String(16 * 1024 * 1024),
    PRIVATE_MEDIA_ROOT: join(os.tmpdir(), `wap-capacity-${randomUUID()}`),
    SELLER_CLIENTS_ENABLED: 'true',
    SELLER_CLIENTS_SELLER_IDS: json,
    SELLER_WHATSAPP_INBOUND_ENABLED: 'true',
    SELLER_WHATSAPP_INBOUND_SELLER_IDS: json,
    SELLER_WHATSAPP_SEND_ENABLED: 'true',
    SELLER_WHATSAPP_SEND_SELLER_IDS: json,
    SELLER_WHATSAPP_FIRST_SEND_ENABLED: 'true',
    SELLER_WHATSAPP_FIRST_SEND_SELLER_IDS: json,
    ORDER_SUBJECT_CREATION_ENABLED: 'true',
    ORDER_SUBJECT_READERS_READY: 'true',
    ORDER_SUBJECT_SELLER_IDS: ids.join(','),
    // Worker side. The endpoint is never contacted: fetchImpl is a stub.
    N8N_COMMAND_CLIENT_ID: 'wap-capacity-worker',
    N8N_COMMAND_CLIENT_SECRET: 'synthetic worker credential',
    N8N_COMMAND_URL: 'http://127.0.0.1:9/webhook/silmer/panel-command',
    N8N_COMMAND_ALLOW_INSECURE_LOCAL: 'true',
  });
}

// ------------------------------------------------------------------ metrics
/** @param {number[]} values */
function summary(values) {
  if (!values.length) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (/** @type {number} */ p) =>
    sorted[
      Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    ];
  const round = (/** @type {number} */ v) => Math.round(v * 10) / 10;
  return {
    n: sorted.length,
    p50: round(at(50)),
    p95: round(at(95)),
    p99: round(at(99)),
    max: round(sorted.at(-1) ?? 0),
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}
/** @param {{status:number}[]} results */
function statuses(results) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const { status } of results) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}
const sleep = (/** @type {number} */ ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Same shape as createDatabase() (modules/database/src/database.js: max 10,
 * connectionTimeoutMillis 5000) plus acquisition timing and SQLSTATE tallies.
 * @param {string} applicationName @param {number} max
 */
function instrumentedDatabase(applicationName, max) {
  const pool = new Pool({
    application_name: applicationName,
    connectionString: DB_URL.href,
    connectionTimeoutMillis: 5000,
    max,
  });
  pool.on('error', () => {});
  const state = {
    /** @type {number[]} */ acquireMs: [],
    /** @type {Record<string, number>} */ errors: {},
    waitingMax: 0,
    samples: 0,
    waitingSamples: 0,
  };
  /** @param {any} error */
  const tally = (error) => {
    const message = String(error?.message ?? '');
    const code = /timeout exceeded when trying to connect/iu.test(message)
      ? 'POOL_ACQUIRE_TIMEOUT'
      : typeof error?.code === 'string' && /^[0-9A-Z]{5}$/u.test(error.code)
        ? `SQLSTATE_${error.code}`
        : null;
    if (code) state.errors[code] = (state.errors[code] ?? 0) + 1;
  };
  const connect = pool.connect.bind(pool);
  // pg-pool's query() also acquires through this.connect(callback).
  pool.connect = /** @type {any} */ (
    function instrumentedConnect(/** @type {any} */ callback) {
      const started = performance.now();
      if (typeof callback === 'function')
        return connect((/** @type {any} */ error, client, release) => {
          state.acquireMs.push(performance.now() - started);
          if (error) tally(error);
          callback(error, client, release);
        });
      return connect().then(
        (client) => {
          state.acquireMs.push(performance.now() - started);
          return client;
        },
        (error) => {
          tally(error);
          throw error;
        },
      );
    }
  );
  const sampler = setInterval(() => {
    state.samples += 1;
    if (pool.waitingCount > 0) state.waitingSamples += 1;
    state.waitingMax = Math.max(state.waitingMax, pool.waitingCount);
  }, 5);
  sampler.unref();
  let closed = false;
  const database = Object.freeze({
    // Idempotent: the API's onClose hook also closes its database.
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(sampler);
      await pool.end();
    },
    /** @param {(client:any)=>Promise<any>} work */
    connection: async (work) => {
      const client = await pool.connect();
      try {
        const result = await work(client);
        client.release();
        return result;
      } catch (error) {
        tally(error);
        client.release(/** @type {any} */ (error));
        throw error;
      }
    },
    /** @param {string} sql @param {unknown[]} [values] */
    query: (sql, values) =>
      pool.query(sql, values).catch((error) => {
        tally(error);
        throw error;
      }),
    readiness: async () => true,
    /** @param {(client:any)=>Promise<any>} work */
    transaction: (work) =>
      withTransaction(pool, work).catch((error) => {
        tally(error);
        throw error;
      }),
  });
  return {
    database,
    pool,
    reset() {
      state.acquireMs = [];
      state.errors = {};
      state.waitingMax = 0;
      state.samples = 0;
      state.waitingSamples = 0;
    },
    snapshot() {
      return {
        acquireMs: summary(state.acquireMs),
        waitingMax: state.waitingMax,
        waitingSampleShare:
          state.samples === 0
            ? 0
            : Math.round((state.waitingSamples / state.samples) * 1000) / 1000,
        errors: { ...state.errors },
      };
    },
  };
}

// ---------------------------------------------------------------- HTTP client
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
/**
 * @param {string} base
 * @param {{method?:string,path:string,headers?:Record<string,string>,body?:unknown,ip?:string}} options
 * @returns {Promise<{status:number,headers:http.IncomingHttpHeaders,json:any,ms:number,bytes:number}>}
 */
function call(base, { method = 'GET', path, headers = {}, body, ip }) {
  const url = new URL(path, base);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        agent,
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        localAddress: ip ?? '127.0.0.1',
        headers: {
          ...(payload ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        timeout: 60_000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            json,
            ms: performance.now() - started,
            bytes: Buffer.byteLength(text),
          });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('HTTP_TIMEOUT')));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

/** @template T @param {Array<() => Promise<T>>} tasks @param {number} limit */
async function runLimited(tasks, limit) {
  /** @type {T[]} */
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const index = next++;
        results[index] = await tasks[index]();
      }
    }),
  );
  return results;
}

// ---------------------------------------------------------------- seeding
/** @param {any} pool @param {string} sellerId @param {string} passwordHash @param {number} index */
async function seedSellerWithLine(pool, sellerId, passwordHash, index) {
  await pool.query(
    'INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,$3,$4)',
    [
      sellerId,
      `${sellerId}@example.test`,
      passwordHash,
      `Vendedor sintético ${index}`,
    ],
  );
  await pool.query(
    "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
    [sellerId],
  );
  const source = {
    lineId: randomUUID(),
    accountId: randomUUID(),
    bindingId: randomUUID(),
    generation: 1,
  };
  const instance = `wap_${source.lineId.replaceAll('-', '')}`;
  const number = fakePhone(1, index);
  const digest = contactPhoneHash(number, KEY);
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO crm.seller_whatsapp_lines(id,seller_id,account_id,instance_name,
       number_digest,number_envelope,confirmed_number_envelope,state,generation,version,verified_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'connected',1,1,now(),now(),now())`,
      [
        source.lineId,
        sellerId,
        source.accountId,
        instance,
        digest,
        encryptJson({ number }, 'synthetic', KEY),
        encryptJson(
          { number },
          `seller-whatsapp-confirmed:${source.lineId}`,
          KEY,
        ),
      ],
    );
    await client.query(
      `INSERT INTO crm.whatsapp_number_reservations(number_digest,kind,line_id,created_at)
       VALUES($1,'personal',$2,now())`,
      [digest, source.lineId],
    );
    await client.query(
      `INSERT INTO crm.seller_whatsapp_bindings(id,line_id,account_id,instance_name,generation,token_hash,token_envelope,created_at)
       VALUES($1,$2,$3,$4,1,$5,$6,now())`,
      [
        source.bindingId,
        source.lineId,
        source.accountId,
        instance,
        createHash('sha256').update(source.bindingId).digest('hex'),
        encryptJson({ number }, 'synthetic', KEY),
      ],
    );
  });
  return { sellerId, source, instance, index };
}

let portfolioSequence = 0;
/** Bulk manual portfolio contacts with encrypted synthetic phones. @param {any} pool @param {string} sellerId @param {number} count */
async function seedPortfolio(pool, sellerId, count) {
  for (let offset = 0; offset < count; offset += 500) {
    const size = Math.min(500, count - offset);
    const ids = [],
      names = [],
      keys = [],
      hashes = [],
      envelopes = [];
    for (let i = 0; i < size; i++) {
      const n = ++portfolioSequence;
      const phone = fakePhone(3, n);
      ids.push(`contact-cap-${randomUUID()}`);
      names.push(`Cliente sintético ${String(n).padStart(5, '0')}`);
      keys.push(randomUUID());
      hashes.push(contactPhoneHash(phone, KEY));
      envelopes.push(
        JSON.stringify(encryptContactDetails({ email: null, phone }, KEY)),
      );
    }
    await withTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO crm.contacts(id,provisional,version,created_at,updated_at,display_name,
           display_name_source,manual_create_key,manually_created_by,contact_phone_hash,
           contact_details_envelope,wallet_created)
         SELECT t.id,false,1,now(),now(),t.name,'manual',t.mck,$1,t.hash,t.env::jsonb,true
         FROM unnest($2::text[],$3::text[],$4::text[],$5::text[],$6::text[])
           AS t(id,name,mck,hash,env)`,
        [sellerId, ids, names, keys, hashes, envelopes],
      );
      await client.query(
        `INSERT INTO crm.seller_client_links(id,seller_id,contact_id,provenance,source_id,status,
           version,created_by,updated_by,created_at,updated_at)
         SELECT gen_random_uuid(),$1,t.id,'manual_create',NULL,'active',1,$1,$1,now(),now()
         FROM unnest($2::text[]) AS t(id)`,
        [sellerId, ids],
      );
    });
  }
}

// ---------------------------------------------------------------- DB probes
/** @param {any} admin */
async function databaseCounters(admin) {
  await sleep(1100); // pgstat flushes idle backends at most once per second
  const { rows } = await admin.query(
    `SELECT xact_commit::bigint AS commits, xact_rollback::bigint AS rollbacks,
            deadlocks::bigint AS deadlocks, conflicts::bigint AS conflicts
       FROM pg_stat_database WHERE datname=current_database()`,
  );
  return Object.fromEntries(
    Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]),
  );
}
/** @param {any} admin */
function lockWaitSampler(admin) {
  let max = 0,
    samples = 0,
    withWaiters = 0,
    stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const { rows } = await admin.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'`,
      );
      samples += 1;
      if (rows[0].n > 0) withWaiters += 1;
      max = Math.max(max, rows[0].n);
      await sleep(25);
    }
  })();
  return async () => {
    stopped = true;
    await loop;
    return {
      lockWaitersMax: max,
      lockWaitSampleShare:
        samples === 0 ? 0 : Math.round((withWaiters / samples) * 1000) / 1000,
    };
  };
}

// ---------------------------------------------------------------- SSE client
/** @param {string} base @param {{cookie:string,ip:string}} session */
function openStream(base, session) {
  const url = new URL('/api/v1/events', base);
  /** @type {{at:number,id:number|null,type:string,data:string}[]} */
  const events = [];
  return new Promise((resolve) => {
    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        localAddress: session.ip,
        headers: {
          accept: 'text/event-stream',
          cookie: session.cookie,
          origin: ORIGIN,
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            let code = null;
            try {
              code = JSON.parse(Buffer.concat(chunks).toString()).error?.code;
            } catch {
              code = null;
            }
            resolve({ status: response.statusCode, code, events, close() {} });
          });
          return;
        }
        let buffer = '';
        let connected = false;
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          buffer += chunk;
          let split;
          while ((split = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            if (block.startsWith(':')) {
              if (!connected && block.includes('connected')) {
                connected = true;
                resolve({
                  status: 200,
                  code: null,
                  events,
                  close: () => request.destroy(),
                });
              }
              continue;
            }
            const event = {
              at: performance.now(),
              id: null,
              type: '',
              data: '',
            };
            for (const line of block.split('\n')) {
              if (line.startsWith('id: ')) event.id = Number(line.slice(4));
              else if (line.startsWith('event: ')) event.type = line.slice(7);
              else if (line.startsWith('data: ')) event.data = line.slice(6);
            }
            events.push(/** @type {any} */ (event));
          }
        });
        response.on('error', () => {});
      },
    );
    request.on('error', () =>
      resolve({ status: 0, code: 'NETWORK', events, close() {} }),
    );
    request.end();
  });
}

// ---------------------------------------------------------------- scenario
/** @param {number} sellerCount @param {any} admin @param {string} passwordHash */
async function scenario(sellerCount, admin, passwordHash) {
  console.log(`\n== scenario: ${sellerCount} sellers, 1 line each ==`);
  const sellerIds = Array.from(
    { length: sellerCount },
    (_, i) => `wap-cap-seller-${String(i).padStart(2, '0')}`,
  );
  const environment = environmentFor(sellerIds);
  portfolioSequence = 0;

  // Fresh schema, as in the PostgreSQL live suites.
  const migrationStarted = performance.now();
  await admin.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
  await admin.query('DROP SCHEMA IF EXISTS crm CASCADE');
  const migrations = await loadMigrations();
  await migrate(admin, { migrations });
  await migrate(admin, {
    migrations: migrations.filter(({ version }) => version === '0081'),
    phase: 'contract',
  });
  const migrationMs = performance.now() - migrationStarted;

  const lines = [];
  for (const [index, id] of sellerIds.entries())
    lines.push(await seedSellerWithLine(admin, id, passwordHash, index));
  const lineByAccount = new Map(lines.map((l) => [l.source.accountId, l]));

  const api = instrumentedDatabase('crm-silmer-api', PARAMS.apiPoolMax);
  const server = createServerApi({
    database: api.database,
    environment,
    identity: createIdentityApiRuntime(api.database, environment),
    logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
  });
  const base = await server.listen({ host: '127.0.0.1', port: 0 });
  /** @type {Record<string, any>} */
  const result = {
    sellers: sellerCount,
    lines: sellerCount,
    migrationMs: Math.round(migrationMs),
  };
  try {
    // ---- login (argon2id; not part of the capacity numbers)
    const sessions = [];
    for (const [i, line] of lines.entries()) {
      const ip = sellerIp(i);
      const response = await call(base, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: { origin: ORIGIN },
        body: { email: `${line.sellerId}@example.test`, password: PASSWORD },
        ip,
      });
      if (response.status !== 200)
        throw new Error(`Synthetic login failed: HTTP ${response.status}`);
      const cookies = [response.headers['set-cookie'] ?? []].flat();
      const value = (/** @type {string} */ name) =>
        cookies
          .map((c) => c.split(';')[0])
          .find((c) => c.startsWith(`${name}=`))
          ?.slice(name.length + 1);
      const session = value('crm_session');
      const csrf = value('crm_csrf');
      if (!session || !csrf) throw new Error('Synthetic login set no cookies');
      sessions.push({
        ip,
        csrf,
        cookie: `crm_session=${session}; crm_csrf=${csrf}`,
        line,
      });
    }
    /** @param {any} s */
    const readHeaders = (s) => ({ origin: ORIGIN, cookie: s.cookie });
    /** @param {any} s */
    const writeHeaders = (s) => ({
      origin: ORIGIN,
      cookie: s.cookie,
      'x-csrf-token': s.csrf,
      'idempotency-key': randomUUID(),
    });
    const automation = `Basic ${Buffer.from(`${AUTOMATION_ID}:${AUTOMATION_SECRET}`).toString('base64')}`;
    let inboundSequence = 0;
    /** @param {any} line @param {string} waId */
    const inbound = (line, waId) => {
      const id = `cap-in-${++inboundSequence}`;
      return call(base, {
        method: 'POST',
        path: '/api/v1/integrations/n8n/messages/inbound',
        ip: N8N_IP,
        headers: {
          authorization: automation,
          'idempotency-key': `${line.source.accountId}:${id}`,
          'x-correlation-id': randomUUID(),
          'x-silmer-execution-id': 'wap-capacity-synthetic-execution',
          'x-silmer-workflow-key': 'seller-whatsapp-inbound',
          'x-silmer-workflow-version': '1.0',
        },
        body: {
          schema_version: '1.0',
          channel: 'whatsapp',
          provider: 'evolution',
          source: line.source,
          metadata: { provider_account_id: line.source.accountId },
          contact: { wa_id: waId },
          event_id: `${line.source.accountId}:${id}`,
          message: {
            external_id: id,
            type: 'text',
            text: 'Mensagem sintética',
          },
          occurred_at: new Date().toISOString(),
        },
      });
    };
    /** @param {string} name @param {() => Promise<any>} work */
    async function phase(name, work) {
      console.log(`-- ${name}`);
      api.reset();
      const before = await databaseCounters(admin);
      const stopLocks = lockWaitSampler(admin);
      const started = performance.now();
      const measured = await work();
      const wallMs = performance.now() - started;
      const locks = await stopLocks();
      const after = await databaseCounters(admin);
      result[name] = {
        ...measured,
        wallMs: Math.round(wallMs),
        apiPool: api.snapshot(),
        postgres: {
          ...locks,
          deadlocks: after.deadlocks - before.deadlocks,
          conflicts: after.conflicts - before.conflicts,
          rollbacks: after.rollbacks - before.rollbacks,
          commits: after.commits - before.commits,
        },
      };
      return measured;
    }

    // ---- 1. inbound personal ingest
    /** @type {Map<string, {conversationId:string, contactId:string, waId:string}[]>} */
    const conversations = new Map(sellerIds.map((id) => [id, []]));
    await phase('inboundIngest', async () => {
      const all = [];
      const firstContact = [];
      const followUp = [];
      const started = performance.now();
      for (let round = 0; round < PARAMS.messagesPerCustomer; round++) {
        const tasks = [];
        for (const line of lines)
          for (let c = 0; c < PARAMS.customersPerSeller; c++) {
            const waId = fakePhone(2, line.index * 1000 + c);
            tasks.push(async () => {
              const response = await inbound(line, waId);
              if (round === 0 && response.status === 200)
                conversations.get(line.sellerId)?.push({
                  conversationId: response.json.conversation_id,
                  contactId: response.json.contact_id,
                  waId,
                });
              return response;
            });
          }
        const results = await runLimited(tasks, PARAMS.inboundConcurrency);
        all.push(...results);
        (round === 0 ? firstContact : followUp).push(...results);
      }
      const seconds = (performance.now() - started) / 1000;
      // Lock contention: one conversation, concurrent distinct events.
      const target = lines[0];
      const burstWa = fakePhone(2, 0);
      const burstStarted = performance.now();
      const burst = await Promise.all(
        Array.from({ length: PARAMS.sameConversationBurst }, () =>
          inbound(target, burstWa),
        ),
      );
      return {
        messages: all.length,
        concurrency: PARAMS.inboundConcurrency,
        throughputPerSecond: Math.round((all.length / seconds) * 10) / 10,
        latencyMs: summary(all.map((r) => r.ms)),
        firstContactLatencyMs: summary(firstContact.map((r) => r.ms)),
        followUpLatencyMs: summary(followUp.map((r) => r.ms)),
        statuses: statuses(all),
        sameConversationBurst: {
          requests: burst.length,
          wallMs: Math.round(performance.now() - burstStarted),
          latencyMs: summary(burst.map((r) => r.ms)),
          statuses: statuses(burst),
        },
      };
    });

    // ---- 2. SSE fan-out and global stream cap
    await phase('sseFanOut', async () => {
      const streams = [];
      for (const session of sessions)
        for (let k = 0; k < PARAMS.sseStreamsPerSeller; k++)
          streams.push({ session, stream: await openStream(base, session) });
      const opened = streams.filter((s) => s.stream.status === 200).length;
      await sleep(2500); // let the initial reset/backlog settle
      for (const s of streams) s.stream.events.length = 0;
      const sent = [];
      await Promise.all(
        sessions.flatMap((session) =>
          (conversations.get(session.line.sellerId) ?? [])
            .slice(0, 2)
            .map(async (conversation) => {
              const startedAt = performance.now();
              const response = await inbound(session.line, conversation.waId);
              sent.push({
                sellerId: session.line.sellerId,
                conversationId: conversation.conversationId,
                startedAt,
                doneAt: performance.now(),
                status: response.status,
              });
            }),
        ),
      );
      // Wait for owners to observe their event (poll 1 s + per-reader checks).
      const deadline = performance.now() + 15_000;
      const delivered = () =>
        sent.every((event) =>
          streams
            .filter((s) => s.session.line.sellerId === event.sellerId)
            .every((s) =>
              s.stream.events.some((e) =>
                e.data.includes(event.conversationId),
              ),
            ),
        );
      while (!delivered() && performance.now() < deadline) await sleep(100);
      await sleep(1500);
      const endToEnd = [];
      const afterCommit = [];
      let missed = 0;
      for (const event of sent)
        for (const s of streams.filter(
          (x) => x.session.line.sellerId === event.sellerId,
        )) {
          const hit = s.stream.events.find((e) =>
            e.data.includes(event.conversationId),
          );
          if (!hit) {
            missed += 1;
            continue;
          }
          endToEnd.push(hit.at - event.startedAt);
          afterCommit.push(Math.max(0, hit.at - event.doneAt));
        }
      const resets = streams.reduce(
        (n, s) =>
          n + s.stream.events.filter((e) => e.type === 'stream.reset').length,
        0,
      );
      const leaked = streams.reduce(
        (n, s) =>
          n +
          s.stream.events.filter((e) =>
            sent.some(
              (event) =>
                event.sellerId !== s.session.line.sellerId &&
                e.data.includes(event.conversationId),
            ),
          ).length,
        0,
      );
      // Global cap: one seller keeps opening tabs until 429.
      const extra = [];
      let refusal = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const stream = await openStream(base, sessions[0]);
        if (stream.status !== 200) {
          refusal = {
            status: stream.status,
            code: stream.code,
            afterExtra: extra.length,
          };
          break;
        }
        extra.push(stream);
      }
      const starved = sessions[1]
        ? await openStream(base, sessions[1])
        : { status: null, code: null, close() {} };
      for (const s of [...streams.map((x) => x.stream), ...extra, starved])
        s.close();
      await sleep(1000);
      return {
        streamsOpened: opened,
        streamsPerSeller: PARAMS.sseStreamsPerSeller,
        events: sent.length,
        ownerDeliveries: endToEnd.length,
        ownerMissed: missed,
        ingestPlusFanOutMs: summary(endToEnd),
        fanOutAfterCommitMs: summary(afterCommit),
        resetsToNonOwners: resets,
        nonOwnerStreamEventPairs:
          sent.length * (streams.length - PARAMS.sseStreamsPerSeller),
        foreignConversationIdsLeaked: leaked,
        globalCap: {
          totalAcceptedBeforeRefusal: opened + extra.length,
          refusal,
          otherSellerAfterCap: { status: starved.status, code: starved.code },
        },
      };
    });

    // ---- 3. GET /me/clients with large portfolios
    for (const size of PARAMS.portfolioSizes) {
      const seedStarted = performance.now();
      for (const id of sellerIds) {
        const { rows } = await admin.query(
          `SELECT count(*)::int AS n FROM crm.seller_client_links WHERE seller_id=$1 AND status='active'`,
          [id],
        );
        if (rows[0].n < size) await seedPortfolio(admin, id, size - rows[0].n);
      }
      const seedMs = performance.now() - seedStarted;
      await phase(`clientsList${size}`, async () => {
        /** @type {Record<string, any[]>} */
        const byKind = {
          firstPage: [],
          limit100: [],
          nextPage: [],
          search: [],
        };
        await Promise.all(
          sessions.map(async (session) => {
            let cursor = null;
            for (let r = 0; r < PARAMS.listRequestsPerSeller; r++) {
              const kind =
                r % 10 < 5
                  ? 'firstPage'
                  : r % 10 < 7
                    ? 'limit100'
                    : r % 10 < 9 && cursor
                      ? 'nextPage'
                      : 'search';
              const query =
                kind === 'firstPage'
                  ? ''
                  : kind === 'limit100'
                    ? '?limit=100'
                    : kind === 'nextPage'
                      ? `?cursor=${encodeURIComponent(cursor)}`
                      : '?q=sint%C3%A9tico%200001';
              const response = await call(base, {
                path: `/api/v1/me/clients${query}`,
                headers: readHeaders(session),
                ip: session.ip,
              });
              if (kind === 'firstPage' && response.json?.nextCursor)
                cursor = response.json.nextCursor;
              byKind[kind].push(response);
            }
          }),
        );
        const all = Object.values(byKind).flat();
        const sample = byKind.firstPage.find((r) => r.status === 200)?.json;
        return {
          portfolioPerSeller: size,
          seedMs: Math.round(seedMs),
          requests: all.length,
          statuses: statuses(all),
          latencyMs: summary(all.map((r) => r.ms)),
          byKindLatencyMs: Object.fromEntries(
            Object.entries(byKind).map(([k, v]) => [
              k,
              summary(v.map((r) => r.ms)),
            ]),
          ),
          firstPageItems: sample?.items?.length ?? null,
          totalCountReported: sample?.totalCount ?? null,
          responseBytes: summary(all.map((r) => r.bytes)),
        };
      });
    }

    // ---- 4. concurrent order creation by Subject
    await phase('ordersBySubject', async () => {
      const subjectResults = [];
      const orderResults = [];
      /** @param {any} session @param {string} conversationId */
      const createSubject = async (session, conversationId) => {
        const response = await call(base, {
          method: 'POST',
          path: `/api/v1/inbox/conversations/${conversationId}/subjects`,
          headers: writeHeaders(session),
          body: { select: true },
          ip: session.ip,
        });
        subjectResults.push(response);
        return response.json?.subject?.id;
      };
      /** @param {any} session @param {string} conversationId @param {string} subjectId */
      const createOrder = async (session, conversationId, subjectId) => {
        const { rows } = await admin.query(
          'SELECT version FROM crm.conversations WHERE id=$1',
          [conversationId],
        );
        return call(base, {
          method: 'POST',
          path: `/api/v1/conversations/${conversationId}/orders`,
          headers: writeHeaders(session),
          body: {
            expectedVersion: Number(rows[0].version),
            subjectId,
            expectedSubjectVersion: 1,
          },
          ip: session.ip,
        });
      };
      await Promise.all(
        sessions.flatMap((session) =>
          (conversations.get(session.line.sellerId) ?? [])
            .slice(0, PARAMS.ordersPerSeller)
            .map(async ({ conversationId }) => {
              const subjectId = await createSubject(session, conversationId);
              if (!subjectId) return;
              orderResults.push(
                await createOrder(session, conversationId, subjectId),
              );
            }),
        ),
      );
      // Same Subject, two tabs: exactly one order.
      const raceConversation = conversations.get(sessions[0].line.sellerId)?.[
        PARAMS.ordersPerSeller
      ];
      let race = null;
      if (raceConversation) {
        const subjectId = await createSubject(
          sessions[0],
          raceConversation.conversationId,
        );
        if (subjectId) {
          const pair = await Promise.all([
            createOrder(
              sessions[0],
              raceConversation.conversationId,
              subjectId,
            ),
            createOrder(
              sessions[0],
              raceConversation.conversationId,
              subjectId,
            ),
          ]);
          race = {
            statuses: statuses(pair),
            codes: pair.map((r) => r.json?.error?.code ?? null),
          };
        }
      }
      const { rows } = await admin.query(
        'SELECT count(*)::int AS orders, count(DISTINCT number)::int AS numbers FROM crm.orders',
      );
      return {
        subjects: {
          statuses: statuses(subjectResults),
          latencyMs: summary(subjectResults.map((r) => r.ms)),
        },
        orders: {
          statuses: statuses(orderResults),
          latencyMs: summary(orderResults.map((r) => r.ms)),
        },
        sameSubjectRace: race,
        ledger: rows[0],
      };
    });

    // ---- 5. first send + personal send reservations (outbox only)
    await phase('sendReservations', async () => {
      const previews = [];
      const sends = [];
      const pendingRepeat = [];
      await Promise.all(
        sessions.map(async (session) => {
          const { rows: contacts } = await admin.query(
            `SELECT contact_id FROM crm.seller_client_links
              WHERE seller_id=$1 AND provenance='manual_create' ORDER BY contact_id LIMIT $2`,
            [session.line.sellerId, PARAMS.firstSendsPerSeller],
          );
          await Promise.all(
            contacts.map(async ({ contact_id: contactId }, index) => {
              const preview = await call(base, {
                path: `/api/v1/contacts/${contactId}/whatsapp/first-message-preview`,
                headers: readHeaders(session),
                ip: session.ip,
              });
              previews.push(preview);
              if (preview.status !== 200) return;
              const {
                rows: [versions],
              } = await admin.query(
                `SELECT c.version AS contact, l.version AS link, w.version AS line, w.generation
                   FROM crm.contacts c
                   JOIN crm.seller_client_links l ON l.contact_id=c.id AND l.seller_id=$2
                   JOIN crm.seller_whatsapp_lines w ON w.seller_id=$2
                  WHERE c.id=$1`,
                [contactId, session.line.sellerId],
              );
              const body = {
                text: 'Primeira mensagem sintética',
                expectedContactVersion: Number(versions.contact),
                expectedLinkVersion: Number(versions.link),
                expectedLineVersion: Number(versions.line),
                expectedGeneration: Number(versions.generation),
                expectedConversation: preview.json.preview.conversation,
              };
              const send = await call(base, {
                method: 'POST',
                path: `/api/v1/contacts/${contactId}/whatsapp/conversations`,
                headers: writeHeaders(session),
                body,
                ip: session.ip,
              });
              sends.push(send);
              if (index === 0 && send.status === 201) {
                // WAP-24: a second message before settlement is refused.
                const again = await call(base, {
                  path: `/api/v1/contacts/${contactId}/whatsapp/first-message-preview`,
                  headers: readHeaders(session),
                  ip: session.ip,
                });
                const repeat = await call(base, {
                  method: 'POST',
                  path: `/api/v1/contacts/${contactId}/whatsapp/conversations`,
                  headers: writeHeaders(session),
                  body: {
                    ...body,
                    expectedConversation:
                      again.json?.preview?.conversation ?? null,
                  },
                  ip: session.ip,
                });
                pendingRepeat.push(repeat);
              }
            }),
          );
        }),
      );
      // Personal sends from the Inbox on distinct conversations.
      const personal = [];
      await Promise.all(
        sessions.flatMap((session) =>
          (conversations.get(session.line.sellerId) ?? [])
            .slice(
              PARAMS.ordersPerSeller + 1,
              PARAMS.ordersPerSeller + 1 + PARAMS.personalSendsPerSeller,
            )
            .map(async ({ conversationId }) => {
              const { rows } = await admin.query(
                'SELECT version FROM crm.conversations WHERE id=$1',
                [conversationId],
              );
              personal.push(
                await call(base, {
                  method: 'POST',
                  path: `/api/v1/conversations/${conversationId}/messages`,
                  headers: writeHeaders(session),
                  body: {
                    messageType: 'text',
                    content: { text: 'Resposta sintética' },
                    expectedVersion: Number(rows[0].version),
                    reason: 'synthetic capacity rehearsal',
                  },
                  ip: session.ip,
                }),
              );
            }),
        ),
      );
      // Same conversation, same version, several tabs.
      const burstConversation = conversations
        .get(sessions[0].line.sellerId)
        ?.at(-1);
      let burst = null;
      if (burstConversation) {
        const { rows } = await admin.query(
          'SELECT version FROM crm.conversations WHERE id=$1',
          [burstConversation.conversationId],
        );
        const responses = await Promise.all(
          Array.from({ length: PARAMS.personalSendBurst }, () =>
            call(base, {
              method: 'POST',
              path: `/api/v1/conversations/${burstConversation.conversationId}/messages`,
              headers: writeHeaders(sessions[0]),
              body: {
                messageType: 'text',
                content: { text: 'Resposta sintética' },
                expectedVersion: Number(rows[0].version),
                reason: 'synthetic capacity rehearsal',
              },
              ip: sessions[0].ip,
            }),
          ),
        );
        burst = {
          statuses: statuses(responses),
          codes: [
            ...new Set(responses.map((r) => r.json?.error?.code ?? null)),
          ],
          latencyMs: summary(responses.map((r) => r.ms)),
        };
      }
      const { rows: queued } = await admin.query(
        `SELECT count(*)::int AS commands,
                (SELECT count(*)::int FROM crm.outbox_jobs WHERE job_type='n8n.command.deliver') AS jobs
           FROM crm.n8n_commands WHERE action='send_message'`,
      );
      return {
        firstSendPreview: {
          statuses: statuses(previews),
          latencyMs: summary(previews.map((r) => r.ms)),
        },
        firstSend: {
          statuses: statuses(sends),
          latencyMs: summary(sends.map((r) => r.ms)),
        },
        repeatBeforeSettlement: {
          statuses: statuses(pendingRepeat),
          codes: [
            ...new Set(
              pendingRepeat.map(
                (r) => r.json?.code ?? r.json?.error?.code ?? null,
              ),
            ),
          ],
        },
        personalSend: {
          statuses: statuses(personal),
          latencyMs: summary(personal.map((r) => r.ms)),
        },
        personalSameConversationBurst: burst,
        outbox: queued[0],
      };
    });

    // ---- 6. worker drain with an in-process n8n stub (no network)
    await phase('workerDrain', async () => {
      const worker = instrumentedDatabase(
        'crm-silmer-worker',
        PARAMS.workerPoolMax,
      );
      const personalSendSellers = new Set(sellerIds);
      const repository = new PostgresN8nIntegrationRepository({
        database: worker.database,
        envelopeKey: KEY,
        contactEnvelopeKey: KEY,
        contactLookupKey: KEY,
        messageEnvelopeKey: KEY,
        personalInboundEnabled: true,
        personalInboundSellerIds: sellerIds,
        personalSendSellers,
      });
      const service = createN8nIntegrationService({ repository });
      const technical = (
        /** @type {string} */ id,
        /** @type {string} */ executionId,
      ) => ({
        actor: 'AUTOMATION_EXECUTOR',
        correlationId: `correlation-${id}`,
        credentialVersion: 'current',
        executionId,
        idempotencyKey: id,
        requestId: `request-${id}`,
        workflowKey: 'evolution-panel',
        workflowVersion: '1.0',
      });
      let stubCalls = 0;
      let stubFailures = 0;
      /** Emulates the n8n panel workflow: reserve, preflight, sent. */
      const fetchImpl = async (
        /** @type {URL} */ url,
        /** @type {any} */ init,
      ) => {
        if (url.hostname !== '127.0.0.1') throw new Error('Unexpected host');
        stubCalls += 1;
        const commandId = init.headers['idempotency-key'];
        const payload = JSON.parse(init.body);
        try {
          if (payload.whatsapp_target) {
            const line = lineByAccount.get(
              payload.whatsapp_target.source?.accountId,
            );
            const {
              rows: [locked],
            } = await worker.database.query(
              'SELECT locked_by FROM crm.n8n_commands WHERE command_id=$1',
              [commandId],
            );
            const executionId = locked.locked_by;
            const reserveId = `reserve:${commandId}`;
            const reserve = {
              schema_version: '1.0',
              event_type: 'message.send.requested',
              event_id: reserveId,
              occurred_at: new Date().toISOString(),
              source: line?.source ?? payload.whatsapp_target.source,
              command_id: commandId,
              conversation_id: payload.conversation_id,
              message: payload.message,
              source_revision: payload.source_revision,
              automation_epoch: payload.automation_epoch,
              technical: technical(reserveId, executionId),
            };
            await service.recordEvent(reserve);
            await repository.readReservedSend({
              commandId,
              technical: reserve.technical,
              now: new Date(),
              dispatch: true,
            });
            const sentId = `sent:${commandId}`;
            /** @type {Record<string, unknown>} */
            const rest = { ...reserve };
            delete rest.message;
            await service.recordEvent({
              ...rest,
              event_type: 'message.sent',
              event_id: sentId,
              external_message_id: `cap-ext-${stubCalls}`,
              technical: technical(sentId, executionId),
            });
          }
        } catch {
          stubFailures += 1;
        }
        return {
          status: 200,
          json: async () => ({ accepted: true, command_id: commandId }),
        };
      };
      const runtime = createWorkerRuntime({
        database: worker.database,
        environment: environmentFor(sellerIds),
        commandStore: new PostgresN8nCommandStore({
          database: worker.database,
          envelopeKey: KEY,
          personalSendSellers,
        }),
        fetchImpl,
        logger: createSafeLogger({
          service: 'crm-silmer-worker',
          sink: () => {},
        }),
        workerId: 'capacity-worker',
      });
      const pendingSql = `SELECT count(*)::int AS n FROM crm.n8n_commands WHERE status IN ('pending','processing')`;
      const initial = (await admin.query(pendingSql)).rows[0].n;
      const started = performance.now();
      await runtime.start();
      const timeoutMs = Math.max(30_000, initial * 2_000 + 10_000);
      while (performance.now() - started < timeoutMs) {
        if ((await admin.query(pendingSql)).rows[0].n === 0) break;
        await sleep(250);
      }
      const drainMs = performance.now() - started;
      await runtime.stop();
      const { rows: outcomes } = await admin.query(
        `SELECT status, count(*)::int AS n FROM crm.n8n_commands GROUP BY status ORDER BY status`,
      );
      const { rows: latency } = await admin.query(
        `SELECT extract(epoch FROM (completed_at - created_at)) * 1000 AS ms
           FROM crm.n8n_commands WHERE completed_at IS NOT NULL`,
      );
      const { rows: messages } = await admin.query(
        `SELECT status, count(*)::int AS n FROM crm.messages WHERE direction='outbound' GROUP BY status ORDER BY status`,
      );
      const workerPool = worker.snapshot();
      await worker.database.close();
      return {
        commandsAtStart: initial,
        drainMs: Math.round(drainMs),
        throughputPerSecond:
          Math.round((initial / Math.max(1, drainMs / 1000)) * 100) / 100,
        queuedToSettledMs: summary(latency.map((r) => Number(r.ms))),
        commandOutcomes: Object.fromEntries(
          outcomes.map((r) => [r.status, r.n]),
        ),
        outboundMessageStatuses: Object.fromEntries(
          messages.map((r) => [r.status, r.n]),
        ),
        stubTransportCalls: stubCalls,
        stubEmulationFailures: stubFailures,
        workerPool,
      };
    });

    // ---- 7. rate-limit keying: shared vs distinct client addresses
    await phase('rateLimitKeying', async () => {
      const probeSellers = sessions.slice(0, 2);
      const { rows } = await admin.query(
        `SELECT seller_id, min(contact_id) AS contact_id FROM crm.seller_client_links
          WHERE seller_id = ANY($1::text[]) AND provenance='manual_create' GROUP BY seller_id`,
        [probeSellers.map((s) => s.line.sellerId)],
      );
      const contactOf = new Map(rows.map((r) => [r.seller_id, r.contact_id]));
      /** @param {(i:number)=>string} ipFor */
      const fire = (ipFor) =>
        runLimited(
          Array.from(
            { length: PARAMS.rateLimitProbeRequests },
            (_, n) => () => {
              const i = n % probeSellers.length;
              const session = probeSellers[i];
              return call(base, {
                path: `/api/v1/contacts/${contactOf.get(session.line.sellerId)}/whatsapp/first-message-preview`,
                headers: readHeaders(session),
                ip: ipFor(i),
              });
            },
          ),
          10,
        );
      const shared = await fire(() => '127.0.0.1');
      const distinct = await fire((i) => probeIp(i));
      // /me/clients carries no route rate limit.
      const clients = await runLimited(
        Array.from(
          { length: 120 },
          () => () =>
            call(base, {
              path: '/api/v1/me/clients?limit=1',
              headers: readHeaders(probeSellers[0]),
              ip: '127.0.0.3',
            }),
        ),
        10,
      );
      return {
        firstSendPreviewSharedAddress: {
          sellers: probeSellers.length,
          requests: shared.length,
          statuses: statuses(shared),
        },
        firstSendPreviewDistinctAddresses: {
          sellers: probeSellers.length,
          requests: distinct.length,
          statuses: statuses(distinct),
        },
        meClientsOneAddress: {
          requests: clients.length,
          statuses: statuses(clients),
        },
      };
    });

    const { rows: volume } = await admin.query(
      `SELECT (SELECT count(*)::int FROM crm.contacts) AS contacts,
              (SELECT count(*)::int FROM crm.seller_client_links) AS links,
              (SELECT count(*)::int FROM crm.conversations) AS conversations,
              (SELECT count(*)::int FROM crm.messages) AS messages,
              (SELECT count(*)::int FROM crm.domain_events) AS domain_events,
              (SELECT pg_database_size(current_database())::bigint) AS database_bytes`,
    );
    result.finalVolume = Object.fromEntries(
      Object.entries(volume[0]).map(([k, v]) => [k, Number(v)]),
    );
  } finally {
    await server.close();
    await api.database.close();
  }
  return result;
}

// ---------------------------------------------------------------- proposals
/** @param {any[]} scenarios */
function proposeLimits(scenarios) {
  const largest = scenarios.at(-1);
  const clean = scenarios.every((s) =>
    Object.values(s)
      .filter((v) => v && typeof v === 'object' && v.postgres)
      .every(
        (v) =>
          v.postgres.deadlocks === 0 &&
          !v.apiPool.errors.POOL_ACQUIRE_TIMEOUT &&
          !Object.keys(v.apiPool.errors).some((k) => k === 'SQLSTATE_40P01'),
      ),
  );
  const drain = largest.workerDrain.throughputPerSecond;
  const maxPortfolio = PARAMS.portfolioSizes.at(-1);
  const listKey = `clientsList${maxPortfolio}`;
  // Pilot budget for outbound sends: stay well under the measured single
  // worker drain so that a full burst of every seller settles in ~20 s.
  const pilotSellers = 2;
  const perSellerSendsPerMinute = 10;
  return {
    label:
      'PROPOSED for the pilot only. Local synthetic, Windows dev host; does not prove production capacity.',
    basis: {
      testedSellerCounts: PARAMS.sellerCounts,
      noDeadlockOrPoolTimeoutAcrossScenarios: clean,
      workerDrainPerSecondAtLargest: drain,
      inboundP95MsAtLargest: largest.inboundIngest.latencyMs.p95,
      clientsListP95MsAtLargestPortfolio: largest[listKey]?.latencyMs?.p95,
      sseFanOutP95MsAtLargest: largest.sseFanOut.ingestPlusFanOutMs.p95,
      ordersP95MsAtLargest: largest.ordersBySubject.orders.latencyMs.p95,
    },
    perService: {
      pilotAllowlistMaxSellers: pilotSellers,
      linesPerSeller: 1,
      outboundSendsPerMinuteHardCeiling: 20,
      outboundSendsPerMinutePilotBudget: pilotSellers * perSellerSendsPerMinute,
      sseStreamsPerProcess: 30,
      apiPoolMax: PARAMS.apiPoolMax,
      workerPoolMax: PARAMS.workerPoolMax,
      apiProcesses: 1,
      n8nCommandWorkerProcesses: 1,
    },
    perUser: {
      activePortfolioLinksMax: maxPortfolio,
      clientsPageSizeDefault: 50,
      clientsPageSizeMax: 100,
      outboundSendsPerMinute: perSellerSendsPerMinute,
      unsettledSendsPerConversation: 1,
      sseStreamsMax: 3,
      inboundMessagesPerLineSustainedPerSecond: 2,
      inboundSameConversationBurst: PARAMS.sameConversationBurst,
    },
    enforcedToday: {
      outboundSendsPerMinuteHardCeiling:
        'yes (20 personal reservations per rolling minute across all sellers)',
      unsettledSendsPerConversation: 'yes (WAP-24 pendingSend)',
      clientsPageSizeMax: 'yes (parseListQuery 1..100)',
      sseStreamsPerProcess: 'yes (activeStreams >= 30)',
      linesPerSeller: 'yes (seller_whatsapp_lines.seller_id UNIQUE)',
      pilotAllowlistMaxSellers: 'operational only (allowlist content)',
      activePortfolioLinksMax: 'no',
      outboundSendsPerMinute:
        'yes (10 personal reservations per seller per rolling minute)',
      sseStreamsMax: 'no per-user limiter',
      inboundMessagesPerLineSustainedPerSecond: 'no limiter on n8n ingress',
    },
  };
}

// ---------------------------------------------------------------- main
async function main() {
  const admin = new Pool({
    connectionString: DB_URL.href,
    max: 3,
    application_name: 'wap-capacity-admin',
  });
  admin.on('error', () => {});
  try {
    const {
      rows: [server],
    } = await admin.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('max_connections') AS max_connections,
              current_setting('shared_buffers') AS shared_buffers,
              current_database() AS database`,
    );
    const passwordHash = await hashPassword(PASSWORD);
    const scenarios = [];
    for (const count of PARAMS.sellerCounts)
      scenarios.push(await scenario(count, admin, passwordHash));
    let commit = null,
      dirty = null;
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root })
        .toString()
        .trim();
      dirty =
        execFileSync('git', ['status', '--porcelain'], { cwd: root })
          .toString()
          .trim().length > 0;
    } catch {
      commit = null;
    }
    const evidence = {
      schema: 'wap-capacity-evidence/1',
      task: 'WAP-T05-01',
      requirements: ['WAP-12', 'WAP-16'],
      label:
        'Local synthetic rehearsal on a Windows development host. Does not prove production capacity.',
      generatedAt: new Date().toISOString(),
      commit,
      worktreeDirty: dirty,
      host: {
        os: `${os.type()} ${os.release()} ${os.arch()}`,
        cpuModel: os.cpus()[0]?.model?.trim() ?? null,
        logicalCpus: os.cpus().length,
        memoryGiB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
        node: process.version,
        postgres: server.version,
        postgresMaxConnections: Number(server.max_connections),
        postgresSharedBuffers: server.shared_buffers,
        postgresOnSameHost: true,
        docker: false,
      },
      boundaries: {
        database: 'dedicated synthetic loopback database (name checked)',
        externalTransport:
          'none: worker n8n transport is an in-process stub; no Evolution, Meta or n8n call',
        clientAddresses:
          'each synthetic seller uses its own loopback alias; n8n ingress uses another',
        data: 'synthetic users, lines and contacts; phones +55 11 000xxxxxx (unassignable)',
      },
      params: PARAMS,
      scenarios,
      proposal: proposeLimits(scenarios),
    };
    await writeFile(OUT, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`\nEvidence written to ${OUT}`);
  } finally {
    await admin.end();
    agent.destroy();
  }
}

await main();
