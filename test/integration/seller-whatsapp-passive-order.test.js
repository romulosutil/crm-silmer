import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { Pool } from 'pg';
import { createIdentityApiRuntime } from '../../apps/api/src/identity-runtime.js';
import { createServerApi } from '../../apps/api/src/server.js';
import { contactPhoneHash } from '../../modules/contacts/src/index.js';
import {
  createDatabase,
  loadMigrations,
  migrate,
} from '../../modules/database/src/index.js';
import { hashPassword } from '../../modules/identity-access/src/index.js';
import { encryptJson } from '../../modules/n8n-integration/src/crypto.js';
import { createSafeLogger } from '../../modules/shared/src/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
const origin = `http://127.0.0.1:${process.env.WAP_TEST_EDGE_PORT ?? '4187'}`;
const A = 'wap-e07-seller-a';
const B = 'wap-e07-seller-b';
const password = 'synthetic WAP E07 login password';
const envelopeKey = Buffer.alloc(32, 67);
const secret = envelopeKey.toString('base64url');
const automationSecret = 'synthetic n8n credential for WAP E07';
const environment = {
  APP_ENV: 'development',
  APP_ORIGIN: origin,
  AUTH_THROTTLE_HMAC_KEY: secret,
  IDENTITY_BOOTSTRAP_TOKEN: 'synthetic unused WAP E07 bootstrap token',
  IDEMPOTENCY_ENVELOPE_KEY: secret,
  CONTACT_IDENTITY_ENVELOPE_KEY: secret,
  CONTACT_IDENTITY_LOOKUP_KEY: secret,
  DEAL_ENVELOPE_KEY: secret,
  HANDOFF_ENVELOPE_KEY: secret,
  INBOX_MESSAGE_ENVELOPE_KEY: secret,
  N8N_INTEGRATION_ENVELOPE_KEY: secret,
  OPERATION_CURSOR_HMAC_KEY: secret,
  FAB_CODE: '01',
  CRM_AUTOMATION_CLIENT_ID: 'wap-e07-synthetic-n8n',
  CRM_AUTOMATION_CLIENT_SECRET: automationSecret,
  N8N_INTEGRATION_ENABLED: 'true',
  PRIVATE_MEDIA_MAX_BYTES: String(64 * 1024 * 1024),
  PRIVATE_MEDIA_MAX_FILE_BYTES: String(16 * 1024 * 1024),
  PRIVATE_MEDIA_ROOT: join(tmpdir(), `wap-e07-${randomUUID()}`),
  SELLER_CLIENTS_ENABLED: 'true',
  SELLER_CLIENTS_SELLER_IDS: JSON.stringify([A, B]),
  SELLER_WHATSAPP_INBOUND_ENABLED: 'true',
  SELLER_WHATSAPP_INBOUND_SELLER_IDS: JSON.stringify([A, B]),
  ORDER_SUBJECT_CREATION_ENABLED: 'true',
  ORDER_SUBJECT_READERS_READY: 'true',
  ORDER_SUBJECT_SELLER_IDS: `${A},${B}`,
};

test(
  'WAP-E07: n8n API, PostgreSQL and browser deliver the passive order',
  { timeout: 120_000 },
  async (t) => {
    assert.ok(
      connectionString,
      'Set TEST_DATABASE_URL to a dedicated synthetic PostgreSQL database',
    );
    const dbUrl = new URL(connectionString);
    assert.equal(dbUrl.hostname, '127.0.0.1');
    assert.equal(dbUrl.pathname, '/crm_silmer_test_wap_e07');
    const pool = new Pool({ connectionString });
    t.after(() => pool.end());
    await pool.query('DROP SCHEMA IF EXISTS crm_meta CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS crm CASCADE');
    const migrations = await loadMigrations();
    await migrate(pool, { migrations });
    await migrate(pool, {
      migrations: migrations.filter(({ version }) => version === '0081'),
      phase: 'contract',
    });
    const passwordHash = await hashPassword(password);
    for (const seller of [A, B]) {
      await pool.query(
        'INSERT INTO crm.users(id,email,password_hash,name) VALUES($1,$2,$3,$4)',
        [seller, email(seller), passwordHash, seller],
      );
      await pool.query(
        "INSERT INTO crm.user_functions(user_id,function_name) VALUES($1,'Vendedor')",
        [seller],
      );
    }
    const browser = await chromium.launch();
    // Terminate browser SSE connections before closing Fastify.
    t.after(() => browser.close());
    const database = createDatabase({ connectionString, max: 8 });
    const api = createServerApi({
      database,
      environment,
      identity: createIdentityApiRuntime(database, environment),
      logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
    });
    t.after(() => api.close());
    const apiOrigin = await api.listen({ host: '127.0.0.1', port: 0 });
    const edge = spawn(process.execPath, ['scripts/serve-dev.mjs'], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: new URL(origin).port,
        API_ORIGIN: apiOrigin,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    });
    t.after(async () => {
      if (edge.exitCode === null) {
        const closed = once(edge, 'exit');
        edge.kill();
        await closed;
      }
    });
    await Promise.race([
      once(edge.stdout, 'data'),
      once(edge, 'exit').then(([code]) =>
        assert.fail(`Development edge exited: ${code}`),
      ),
    ]);
    assert.equal(
      (await globalThis.fetch(origin)).status,
      200,
      'Run npm run build first',
    );

    const a = await seedLine(pool, A, '5511990000081');
    const b = await seedLine(pool, B, '5511990000091');
    const first = await receiveInbound(apiOrigin, a, 'first-a');
    const unlinked = await receiveInbound(apiOrigin, b, 'first-b');
    assert.notEqual(unlinked.contact_id, first.contact_id);
    // Seed an explicit identity resolution as in the E04 PostgreSQL rehearsal.
    // Telephone equality alone did not merge the two Contacts.
    await pool.query(
      'UPDATE crm.contact_identities SET current_contact_id=$1 WHERE current_contact_id=$2',
      [first.contact_id, unlinked.contact_id],
    );
    const second = await receiveInbound(apiOrigin, b, 'shared-b');
    assert.equal(second.contact_id, first.contact_id);
    assert.equal(second.conversation_id, unlinked.conversation_id);
    assert.notEqual(first.conversation_id, second.conversation_id);
    for (const [inbound, owner, source] of [
      [first, A, a],
      [second, B, b],
    ]) {
      assert.equal(inbound.mode, 'human_active');
      const {
        rows: [conversation],
      } = await pool.query(
        'SELECT assigned_user_id,automation_state,provider_account_id FROM crm.conversations WHERE id=$1',
        [inbound.conversation_id],
      );
      assert.deepEqual(conversation, {
        assigned_user_id: owner,
        automation_state: 'human',
        provider_account_id: source.accountId,
      });
    }

    const effects = await externalEffects(pool);
    assert.ok(Object.values(effects).every((count) => count === 0));
    const desktopContext = await browser.newContext({
      viewport: { width: 1366, height: 900 },
    });
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const desktop = await desktopContext.newPage();
    const mobile = await mobileContext.newPage();
    const desktopCaughtUp = await observeLiveCursor(desktop, pool);
    const mobileCaughtUp = await observeLiveCursor(mobile, pool);
    await login(desktop, A);
    await login(mobile, B);
    const convA = first.conversation_id;
    const convB = second.conversation_id;
    const contactId = first.contact_id;
    for (const [page, own, foreign] of [
      [desktop, convA, convB],
      [mobile, convB, convA],
    ]) {
      const portfolio = await json(
        await read(page, `${origin}/api/v1/me/clients`),
      );
      assert.ok(
        portfolio.items.some(
          (/** @type {any} */ item) => item.id === contactId,
        ),
      );
      const detail = await json(
        await read(page, `${origin}/api/v1/contacts/${contactId}`),
      );
      assert.deepEqual(
        detail.conversations.map((/** @type {any} */ item) => item.id),
        [own],
      );
      assert.equal(detail.contact.provisional, true);
      await denied(
        await read(page, `${origin}/api/v1/inbox/conversations/${foreign}`),
      );
      await denied(await read(page, subjectPath(foreign)));
    }

    const targetA = await createTarget(desktop, convA);
    await createTarget(desktop, convA);
    const targetB = await createTarget(mobile, convB);
    await createTarget(mobile, convB);
    await desktopCaughtUp();
    await openFromPortfolio(desktop, contactId, convA);
    const buyA = await confirmInBrowser(desktop, convA, targetA);
    assert.equal(buyA.status, 201);
    const orderA = await assertOrder(
      pool,
      desktop,
      buyA.order,
      first,
      targetA,
      A,
    );
    const replay = await write(desktop, orderPath(convA), buyA.body, buyA.key);
    assert.equal((await json(replay, 201)).order.id, orderA.id);
    await denied(await write(mobile, orderPath(convA), buyA.body, buyA.key));
    const foreignTarget = await write(desktop, orderPath(convA), {
      ...buyA.body,
      subjectId: targetB,
      expectedSubjectVersion: 1,
    });
    assert.equal(
      (await json(foreignTarget, 404)).error.code,
      'SUBJECT_NOT_FOUND',
    );
    await assertForeignOrder(mobile, orderA);

    await pool.query(
      "UPDATE crm.seller_whatsapp_lines SET state='disconnected',version=version+1 WHERE id=$1",
      [b.lineId],
    );
    await mobileCaughtUp();
    await openFromPortfolio(mobile, contactId, convB);
    const buyB = await confirmInBrowser(mobile, convB, targetB, true);
    assert.equal(buyB.status, 201);
    const orderB = await assertOrder(
      pool,
      mobile,
      buyB.order,
      second,
      targetB,
      B,
    );
    assert.notEqual(orderB.number, orderA.number);
    await assertForeignOrder(desktop, orderB);

    await mobileCaughtUp();
    await mobile.goBack();
    await expect(mobile).toHaveURL(`${origin}/inbox/${convB}`);
    const reopened = await confirmInBrowser(mobile, convB, targetB);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.order.id, orderB.id);
    assert.equal(reopened.order.number, orderB.number);
    await expect(mobile.locator('.notice-toast')).toContainText(
      `Pedido ${orderB.number} aberto.`,
    );

    const raceTarget = await createTarget(desktop, convA);
    const raceBody = {
      ...buyA.body,
      subjectId: raceTarget,
      expectedSubjectVersion: 1,
    };
    const race = await Promise.all(
      [randomUUID(), randomUUID()].map(async (key) => ({
        key,
        response: await write(desktop, orderPath(convA), raceBody, key),
      })),
    );
    race.sort((a, b) => a.response.status() - b.response.status());
    const raced = await json(race[0].response, 201);
    assert.equal(
      (await json(race[1].response, 409)).error.code,
      'VERSION_CONFLICT',
    );
    assert.equal(
      (
        await json(
          await write(desktop, orderPath(convA), raceBody, race[0].key),
          201,
        )
      ).order.id,
      raced.order.id,
    );
    assert.deepEqual(await externalEffects(pool), effects);
    const {
      rows: [ledger],
    } = await pool.query(
      `SELECT count(*)::int AS orders, count(DISTINCT number)::int AS numbers,
              (SELECT count(*)::int FROM crm.domain_events WHERE event_type='order.created') AS events
         FROM crm.orders`,
    );
    assert.deepEqual(ledger, { orders: 3, numbers: 3, events: 3 });

    await json(
      await write(desktop, `${origin}/api/v1/conversations/${convA}/close`, {
        expectedVersion: buyA.body.expectedVersion,
        acknowledgePending: true,
        outcome: 'concluido',
      }),
      202,
    );
    assert.equal(
      (
        await json(
          await write(desktop, orderPath(convA), buyA.body, buyA.key),
          409,
        )
      ).error.code,
      'CONVERSATION_CLOSED',
    );
    await pool.query(
      "UPDATE crm.seller_client_links SET status='revoked',revoked_at=now(),updated_at=now(),version=version+1 WHERE seller_id=$1 AND contact_id=$2",
      [B, contactId],
    );
    await denied(await write(mobile, orderPath(convB), buyB.body, buyB.key));
    await assertForeignOrder(mobile, orderA);
    const retained = (
      await json(await read(mobile, `${origin}/api/v1/orders/${orderB.id}`))
    ).order;
    assert.equal(retained.id, orderB.id);
    assert.equal(retained.conversationId, null);
    assert.equal(retained.originSubjectId, null);
    await pool.query('UPDATE crm.users SET disabled_at=now() WHERE id=$1', [B]);
    await denied(
      await write(mobile, orderPath(convB), buyB.body, buyB.key),
      true,
    );
    await denied(
      await read(mobile, `${origin}/api/v1/orders/${orderB.id}`),
      true,
    );
  },
);

/** @param {string} seller */
function email(seller) {
  return `${seller}@example.test`;
}

/** @param {Pool} pool @param {string} seller @param {string} number */
async function seedLine(pool, seller, number) {
  const source = {
    lineId: randomUUID(),
    accountId: randomUUID(),
    bindingId: randomUUID(),
    generation: 1,
  };
  const instance = `wap_${source.lineId.replaceAll('-', '')}`;
  const digest = contactPhoneHash(number, envelopeKey);
  const encrypted = JSON.stringify(
    encryptJson({ number }, 'synthetic-number', envelopeKey),
  );
  await pool.query(
    `WITH line AS (
      INSERT INTO crm.seller_whatsapp_lines(id,seller_id,account_id,instance_name,number_digest,number_envelope,confirmed_number_envelope,state,generation,version,verified_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$6::jsonb,'connected',1,1,now(),now(),now()) RETURNING id
    ), reservation AS (
      INSERT INTO crm.whatsapp_number_reservations(number_digest,kind,line_id,created_at)
      SELECT $5,'personal',id,now() FROM line
    )
    INSERT INTO crm.seller_whatsapp_bindings(id,line_id,account_id,instance_name,generation,token_hash,token_envelope,created_at)
    SELECT $7,id,$3,$4,1,$8,$6::jsonb,now() FROM line`,
    [
      source.lineId,
      seller,
      source.accountId,
      instance,
      digest,
      encrypted,
      source.bindingId,
      createHash('sha256').update(source.bindingId).digest('hex'),
    ],
  );
  return source;
}

/** @param {string} apiOrigin @param {Awaited<ReturnType<typeof seedLine>>} source @param {string} id */
async function receiveInbound(apiOrigin, source, id) {
  const authorization = `Basic ${Buffer.from(`${environment.CRM_AUTOMATION_CLIENT_ID}:${automationSecret}`).toString('base64')}`;
  const response = await globalThis.fetch(
    `${apiOrigin}/api/v1/integrations/n8n/messages/inbound`,
    {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
        'idempotency-key': `${source.accountId}:${id}`,
        'x-correlation-id': randomUUID(),
        'x-silmer-execution-id': 'wap-e07-synthetic-execution',
        'x-silmer-workflow-key': 'seller-whatsapp-inbound',
        'x-silmer-workflow-version': '1.0',
      },
      body: JSON.stringify({
        schema_version: '1.0',
        channel: 'whatsapp',
        provider: 'evolution',
        source,
        metadata: { provider_account_id: source.accountId },
        contact: { wa_id: '5511990000082' },
        event_id: `${source.accountId}:${id}`,
        message: {
          external_id: id,
          type: 'text',
          text: 'Quero fazer uma compra.',
        },
        occurred_at: new Date().toISOString(),
      }),
    },
  );
  return json(response);
}

/** @param {Pool} pool */
async function externalEffects(pool) {
  const {
    rows: [counts],
  } = await pool.query(`
    SELECT (SELECT count(*)::int FROM crm.outbox_jobs) AS jobs,
           (SELECT count(*)::int FROM crm.n8n_commands) AS commands,
           (SELECT count(*)::int FROM crm.handoffs) AS handoffs,
           (SELECT count(*)::int FROM crm.messages WHERE direction='outbound') AS outbound,
           (SELECT count(*)::int FROM crm.order_assistance_commands) AS assistance,
           (SELECT count(*)::int FROM crm.order_assistance_suggestions) AS suggestions,
           (SELECT count(*)::int FROM crm.order_billing_charges) AS charges,
           (SELECT count(*)::int FROM crm.order_billing_payments) AS payments,
           (SELECT count(*)::int FROM crm.order_billing_send_intents) AS send_intents
  `);
  return counts;
}

/** @typedef {import('@playwright/test').Page} Page */
/** @param {Page} page @param {Pool} pool */
async function observeLiveCursor(page, pool) {
  // Synchronize on real SSE delivery. A replayed private-scope reset can
  // otherwise arrive between opening a confirmation and submitting it.
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  let received = 0;
  session.on('Network.eventSourceMessageReceived', ({ eventId }) => {
    if (eventId) received = Math.max(received, Number(eventId));
  });
  return async () => {
    const {
      rows: [head],
    } = await pool.query(
      `SELECT max(stream_cursor) AS cursor FROM crm.domain_events
        WHERE aggregate_type IN ('contact','seller_client_link','conversation','order','user')`,
    );
    await expect
      .poll(() => received)
      .toBeGreaterThanOrEqual(Number(head.cursor));
  };
}

/** @param {Page} page @param {string} seller */
async function login(page, seller) {
  await page.goto(`${origin}/clientes`);
  await page.getByLabel('E-mail', { exact: true }).fill(email(seller));
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Entrar com segurança' })
    .press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Clientes', exact: true }),
  ).toBeVisible();
}

/** @param {string} conversation */
function subjectPath(conversation) {
  return `${origin}/api/v1/inbox/conversations/${conversation}/subjects`;
}

/** @param {string} conversation */
function orderPath(conversation) {
  return `${origin}/api/v1/conversations/${conversation}/orders`;
}

/** @param {Page} page */
async function sessionHeaders(page) {
  // APIRequestContext can omit Secure cookies on HTTP loopback. Reuse the
  // session actually issued to Chromium for the direct API probes.
  const cookies = await page.context().cookies();
  const session = cookies.find(({ name }) => name === 'crm_session');
  const csrf = cookies.find(({ name }) => name === 'crm_csrf');
  assert.ok(
    session && csrf,
    'Browser login must establish both session cookies',
  );
  return {
    origin,
    cookie: `crm_session=${session.value}; crm_csrf=${csrf.value}`,
    'x-csrf-token': csrf.value,
  };
}

/** @param {Page} page @param {string} path */
async function read(page, path) {
  return page.request.get(path, { headers: await sessionHeaders(page) });
}

/** @param {Page} page @param {string} path @param {object} data @param {string} [key] */
async function write(page, path, data, key = randomUUID()) {
  return page.request.post(path, {
    data,
    headers: { ...(await sessionHeaders(page)), 'idempotency-key': key },
  });
}

/** @param {Response|import('@playwright/test').APIResponse} response @param {number} [status] */
async function json(response, status = 200) {
  const body = await response.json();
  assert.equal(
    typeof response.status === 'function' ? response.status() : response.status,
    status,
    body.error?.code,
  );
  return body;
}

/** @param {import('@playwright/test').APIResponse} response @param {boolean} [inactive] */
async function denied(response, inactive = false) {
  const status = response.status();
  assert.ok(
    (inactive ? [401, 403] : [403, 404]).includes(status),
    `Access returned HTTP ${status}`,
  );
  const {
    error,
    request_id: requestId,
    ...privateFields
  } = await response.json();
  assert.equal(typeof error.code, 'string');
  assert.ok(requestId === undefined || typeof requestId === 'string');
  assert.deepEqual(privateFields, {});
}

/** @param {Page} page @param {any} expected */
async function assertForeignOrder(page, expected) {
  // The existing order.read capability permits this standalone detail.
  // Commercial management and private Inbox context have separate guards.
  const path = `${origin}/api/v1/orders/${expected.id}`;
  const { order } = await json(await read(page, path));
  assert.equal(order.id, expected.id);
  assert.equal(order.number, expected.number);
  assert.equal(order.conversationId, null);
  assert.equal(order.originSubjectId, null);
  assert.equal(order.receiptAvailable, false);
  await denied(await read(page, `${path}/receipt`));
  await denied(
    await page.request.patch(`${path}/sections/observations`, {
      data: {
        expectedVersion: order.version,
        value: ['Edição cruzada sintética'],
      },
      headers: {
        ...(await sessionHeaders(page)),
        'idempotency-key': randomUUID(),
      },
    }),
  );
}

/** @param {Page} page @param {string} conversation */
async function createTarget(page, conversation) {
  return (
    await json(
      await write(page, subjectPath(conversation), { select: true }),
      201,
    )
  ).subject.id;
}

/** @param {Page} page @param {string} contactId @param {string} conversation */
async function openFromPortfolio(page, contactId, conversation) {
  await page.bringToFront();
  await page.getByRole('link', { name: 'Meus clientes', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/meus-clientes`);
  await expect(
    page.getByRole('heading', { name: 'Meus clientes' }),
  ).toBeFocused();
  await page.locator(`a[href="/meus-clientes/${contactId}"]`).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${origin}/meus-clientes/${contactId}`);
  const link = page
    .getByRole('link', { name: 'WhatsApp', exact: true })
    .and(page.locator(`[href="/inbox/${conversation}"]`));
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${origin}/inbox/${conversation}`);
}

/** @param {Page} page @param {string} conversation @param {string} target @param {boolean} [doubleClick] */
async function confirmInBrowser(
  page,
  conversation,
  target,
  doubleClick = false,
) {
  const create = page.getByRole('button', {
    name: 'Criar pedido',
    exact: true,
  });
  const dialog = page.getByRole('dialog', {
    name: 'O cliente confirmou a compra?',
  });
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  const select = dialog.getByLabel('Assunto desta compra');
  await expect(select).toBeFocused();
  await select.selectOption(target);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.bringToFront();
  const submit = dialog.getByRole('button', {
    name: 'Cliente confirmou, criar pedido',
  });
  await expect(submit).toBeEnabled();
  /** @param {import('@playwright/test').Request} request */
  const matches = (request) =>
    request.url() === orderPath(conversation) && request.method() === 'POST';
  /** @type {import('@playwright/test').Request[]} */
  const writes = [];
  /** @param {import('@playwright/test').Request} request */
  const track = (request) => {
    if (matches(request)) writes.push(request);
  };
  page.on('request', track);
  const responsePromise = page.waitForResponse((response) =>
    matches(response.request()),
  );
  if (doubleClick) await submit.dblclick();
  else {
    await submit.focus();
    await expect(submit).toBeFocused();
    await page.keyboard.press('Enter');
  }
  const response = await responsePromise;
  const result = await response.json();
  assert.ok([200, 201].includes(response.status()), result.error?.code);
  const request = response.request();
  const body = request.postDataJSON();
  assert.equal(body.subjectId, target);
  const key = request.headers()['idempotency-key'];
  assert.match(key, /^[a-f0-9-]{36}$/u);
  await expect(page).toHaveURL(
    `${origin}/pedidos/${result.order.id}?conversa=${conversation}`,
  );
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  page.off('request', track);
  assert.equal(writes.length, 1);
  return { order: result.order, status: response.status(), body, key };
}

/** @param {Pool} pool @param {Page} page @param {any} order @param {any} inbound @param {string} target @param {string} seller */
async function assertOrder(pool, page, order, inbound, target, seller) {
  assert.equal(order.status, 'pendente');
  assert.match(order.number, /^\d{2,}-CRM$/u);
  const {
    rows: [state],
  } = await pool.query(
    `SELECT o.contact_id,o.conversation_id,o.origin_subject_id,o.status,o.number,o.created_by,
            c.assigned_user_id,s.order_id,s.contact_id AS subject_contact_id
       FROM crm.orders o JOIN crm.conversations c ON c.id=o.conversation_id
       JOIN crm.conversation_subjects s ON s.id=o.origin_subject_id WHERE o.id=$1`,
    [order.id],
  );
  assert.deepEqual(state, {
    contact_id: inbound.contact_id,
    conversation_id: inbound.conversation_id,
    origin_subject_id: target,
    status: 'pendente',
    number: order.number,
    created_by: seller,
    assigned_user_id: seller,
    order_id: order.id,
    subject_contact_id: inbound.contact_id,
  });
  const observations = page.getByRole('region', {
    name: 'Observações do pedido',
  });
  const collapsed = observations.getByRole('button', {
    name: /^Observações do pedido/u,
    expanded: false,
  });
  if (await collapsed.count()) await collapsed.press('Enter');
  const observation = observations.getByRole('textbox', {
    name: 'Nova observação, linha 1',
  });
  const edit = `Observação sintética ${seller}`;
  await observation.fill(edit);
  const saved = page.waitForResponse(
    (response) =>
      response.url() ===
        `${origin}/api/v1/orders/${order.id}/sections/observations` &&
      response.request().method() === 'PATCH',
  );
  await observation.press('Enter');
  assert.equal((await saved).status(), 200);
  const { order: reread } = await json(
    await read(page, `${origin}/api/v1/orders/${order.id}`),
  );
  assert.deepEqual(reread.ficha.observations, [edit]);
  assert.equal(reread.confirmedAt, null);
  assert.equal(reread.seller.id, seller);
  assert.equal(reread.contactId, inbound.contact_id);
  assert.equal(reread.conversationId, inbound.conversation_id);
  assert.equal(reread.originSubjectId, target);
  return reread;
}
