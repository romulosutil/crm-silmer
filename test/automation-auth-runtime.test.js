import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AutomationAuthError,
  createAutomationAuthRuntime,
} from '../apps/api/src/automation-auth-runtime.js';

const CLIENT_ID = 'silmer-n8n';
const CURRENT_SECRET = 'current-automation-secret-with-32-characters';
const PREVIOUS_SECRET = 'previous-automation-secret-with-32-characters';
const environment = Object.freeze({
  CRM_AUTOMATION_CLIENT_ID: CLIENT_ID,
  CRM_AUTOMATION_CLIENT_SECRET: CURRENT_SECRET,
  CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET: PREVIOUS_SECRET,
});

/** @param {string} clientId @param {string} secret */
function basic(clientId, secret) {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
}

/** @param {Record<string, string|undefined>} [runtimeEnvironment] */
function harness(runtimeEnvironment = environment) {
  /** @type {Array<Record<string, unknown>>} */
  const auditEvents = [];
  const runtime = createAutomationAuthRuntime({
    auditPort: {
      append: async (event) => {
        auditEvents.push(structuredClone(event));
      },
    },
    environment: runtimeEnvironment,
  });
  return { auditEvents, runtime };
}

test('authorizes HTTP Basic credentials for every minimum n8n action', async () => {
  const { auditEvents, runtime } = harness();
  const allowedActions = [
    'integration.n8n.message.create',
    'integration.n8n.event.create',
    'conversation.convert',
    'deal.fields.patch',
    'deal.transition',
    'handoff.create',
  ];

  for (const action of allowedActions) {
    const principal = await runtime.authorize({
      action,
      authorization: basic(CLIENT_ID, CURRENT_SECRET),
      correlationId: `correlation-${action}`,
    });
    assert.equal(principal.actor.id, 'AUTOMATION_EXECUTOR');
    assert.equal(principal.actor.kind, 'AUTOMATION_EXECUTOR');
    assert.equal(principal.actor.role, 'AUTOMATION_EXECUTOR');
    assert.equal(principal.credentialVersion, 'current');
  }
  assert.deepEqual(auditEvents, []);
});

test('accepts the previous secret only during explicit rotation overlap', async () => {
  const { runtime } = harness();
  const principal = await runtime.authorize({
    action: 'conversation.convert',
    authorization: basic(CLIENT_ID, PREVIOUS_SECRET),
    correlationId: 'correlation-overlap',
  });
  assert.equal(principal.credentialVersion, 'previous');

  const { runtime: restarted } = harness({
    CRM_AUTOMATION_CLIENT_ID: CLIENT_ID,
    CRM_AUTOMATION_CLIENT_SECRET: CURRENT_SECRET,
  });
  await assert.rejects(
    restarted.authorize({
      action: 'conversation.convert',
      authorization: basic(CLIENT_ID, PREVIOUS_SECRET),
      correlationId: 'correlation-after-overlap',
    }),
    (error) =>
      error instanceof AutomationAuthError &&
      error.statusCode === 401 &&
      error.code === 'INVALID_AUTOMATION_CREDENTIALS',
  );
});

test('returns 401 and writes a sanitized audit event for invalid credentials', async () => {
  const { auditEvents, runtime } = harness();
  const authorization = basic(CLIENT_ID, 'invalid-secret-never-write-to-audit');

  await assert.rejects(
    runtime.authorize({
      action: 'deal.transition',
      authorization,
      correlationId: 'correlation-invalid-credential',
    }),
    (error) =>
      error instanceof AutomationAuthError &&
      error.statusCode === 401 &&
      error.code === 'INVALID_AUTOMATION_CREDENTIALS',
  );
  assert.deepEqual(auditEvents, [
    {
      action: 'automation.authentication.denied',
      actor: 'UNAUTHENTICATED_AUTOMATION_CALLER',
      correlationId: 'correlation-invalid-credential',
      reason: 'AUTOMATION_CREDENTIAL_REJECTED',
      target: { id: 'AUTOMATION_EXECUTOR', type: 'technical-actor' },
      version: 'unverified',
    },
  ]);
  const serializedAudit = JSON.stringify(auditEvents);
  assert.equal(serializedAudit.includes(authorization), false);
  assert.equal(serializedAudit.includes('invalid-secret'), false);
  assert.equal(serializedAudit.includes(CURRENT_SECRET), false);
  assert.equal(serializedAudit.includes(PREVIOUS_SECRET), false);
});

test('returns 403 and audits valid credentials attempting forbidden actions', async () => {
  for (const action of [
    'identity.capability.grant',
    'order-form.approve',
    'database.direct-access',
    'unknown.action',
  ]) {
    const { auditEvents, runtime } = harness();
    await assert.rejects(
      runtime.authorize({
        action,
        authorization: basic(CLIENT_ID, CURRENT_SECRET),
        correlationId: `correlation-forbidden-${action}`,
      }),
      (error) =>
        error instanceof AutomationAuthError &&
        error.statusCode === 403 &&
        error.code === 'FORBIDDEN_AUTOMATION_ACTION',
    );
    assert.deepEqual(auditEvents, [
      {
        action: 'automation.authorization.denied',
        actor: 'AUTOMATION_EXECUTOR',
        correlationId: `correlation-forbidden-${action}`,
        reason: 'AUTOMATION_ACTION_FORBIDDEN',
        target: { id: 'AUTOMATION_EXECUTOR', type: 'technical-actor' },
        version: 'current',
      },
    ]);
  }
});

test('rejects missing and malformed authorization without leaking the header', async () => {
  for (const authorization of [
    undefined,
    '',
    'Bearer token',
    'Basic not-base64!',
    `Basic ${Buffer.from(`${CLIENT_ID}:`).toString('base64')}`,
  ]) {
    const { auditEvents, runtime } = harness();
    await assert.rejects(
      runtime.authorize({
        action: 'integration.n8n.event.create',
        authorization,
        correlationId: 'correlation-malformed',
      }),
      (error) =>
        error instanceof AutomationAuthError && error.statusCode === 401,
    );
    if (authorization) {
      assert.equal(
        JSON.stringify(auditEvents).includes(String(authorization)),
        false,
      );
    }
  }
});

test('fails closed on partial runtime configuration', () => {
  for (const field of [
    'CRM_AUTOMATION_CLIENT_ID',
    'CRM_AUTOMATION_CLIENT_SECRET',
  ]) {
    assert.throws(
      () => harness({ ...environment, [field]: undefined }),
      new RegExp(field, 'u'),
    );
  }
  assert.throws(
    () =>
      harness({
        ...environment,
        CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET: 'short',
      }),
    /CRM_AUTOMATION_PREVIOUS_CLIENT_SECRET/u,
  );
});

test('keeps a denied request closed when the audit trail is unavailable', async () => {
  const runtime = createAutomationAuthRuntime({
    auditPort: {
      append: async () => {
        throw new Error('audit unavailable');
      },
    },
    environment,
  });

  await assert.rejects(
    runtime.authorize({
      action: 'identity.capability.grant',
      authorization: basic(CLIENT_ID, CURRENT_SECRET),
      correlationId: 'correlation-audit-unavailable',
    }),
    /audit unavailable/u,
  );
});
