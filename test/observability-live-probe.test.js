import assert from 'node:assert/strict';
import test from 'node:test';

import {
  observeApiTransition,
  probeLiveEndpoint,
  validateProbeEnvironment,
} from '../scripts/observability-live-probe.mjs';

const { Response } = globalThis;

const liveUrl =
  'https://espectro-mvp-silmer-edge-web.jicnzg.easypanel.host/api/health/live';
const authorizationRef =
  'https://github.com/romulosutil/crm-silmer/issues/11#issuecomment-1234567890';

test('accepts a safe baseline and requires versioned drill authorization', () => {
  assert.deepEqual(
    validateProbeEnvironment({
      OBSERVABILITY_LIVE_URL: liveUrl,
    }),
    {
      authorizationRef: null,
      evidencePath: 'var/observability-live-baseline.json',
      liveUrl,
      mode: 'baseline',
      pollIntervalMs: 5_000,
      timeoutMs: 900_000,
    },
  );

  assert.throws(
    () =>
      validateProbeEnvironment({
        OBSERVABILITY_LIVE_URL: liveUrl,
        OBSERVABILITY_MODE: 'watch-api-drill',
      }),
    /authorization reference/iu,
  );
  assert.equal(
    validateProbeEnvironment({
      OBSERVABILITY_AUTHORIZATION_REF: authorizationRef,
      OBSERVABILITY_LIVE_URL: liveUrl,
      OBSERVABILITY_MODE: 'watch-api-drill',
    }).authorizationRef,
    authorizationRef,
  );
});

test('rejects unsafe targets, query data and evidence outside var', () => {
  for (const environment of [
    { OBSERVABILITY_LIVE_URL: liveUrl.replace('https:', 'http:') },
    { OBSERVABILITY_LIVE_URL: `${liveUrl}?contact=cliente@example.test` },
    {
      OBSERVABILITY_LIVE_URL: liveUrl.replace(
        '/api/health/live',
        '/api/health/ready',
      ),
    },
    {
      OBSERVABILITY_EVIDENCE_PATH: 'docs/live.json',
      OBSERVABILITY_LIVE_URL: liveUrl,
    },
  ]) {
    assert.throws(
      () => validateProbeEnvironment(environment),
      /canonical HTTPS endpoint|evidence path/iu,
    );
  }
});

test('records a bounded probe without response body, headers or URL query', async () => {
  const evidence = await probeLiveEndpoint({
    fetchImpl: async () =>
      new Response('{"email":"cliente@example.test","token":"secret"}', {
        headers: { authorization: 'Bearer secret' },
        status: 200,
      }),
    liveUrl,
    monotonicNow: (() => {
      const values = [10, 22];
      return () => /** @type {number} */ (values.shift());
    })(),
    now: () => new Date('2026-09-01T12:00:00.000Z'),
  });

  assert.deepEqual(evidence, {
    durationMs: 12,
    httpStatusCode: 200,
    observedAt: '2026-09-01T12:00:00.000Z',
    status: 'healthy',
    target:
      'https://espectro-mvp-silmer-edge-web.jicnzg.easypanel.host/api/health/live',
  });
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /cliente|email|token|secret|authorization/iu,
  );
});

test('observes an authorized healthy-unavailable-recovered transition', async () => {
  const probes = [
    {
      durationMs: 20,
      httpStatusCode: 200,
      observedAt: '2026-09-01T12:00:00.000Z',
      status: 'healthy',
      target: liveUrl,
    },
    {
      durationMs: 25,
      httpStatusCode: null,
      observedAt: '2026-09-01T12:00:05.000Z',
      status: 'unavailable',
      target: liveUrl,
    },
    {
      durationMs: 18,
      httpStatusCode: 200,
      observedAt: '2026-09-01T12:00:10.000Z',
      status: 'healthy',
      target: liveUrl,
    },
  ];
  const evidence = await observeApiTransition({
    authorizationRef,
    pollIntervalMs: 1,
    probe: async () => /** @type {any} */ (probes.shift()),
    sleep: async () => {},
    timeoutMs: 10,
  });

  assert.equal(evidence.status, 'partial-live-evidence');
  assert.equal(evidence.scenario, 'api-stop-recovery');
  assert.equal(evidence.startedAt, '2026-09-01T12:00:00.000Z');
  assert.equal(evidence.detectedAt, '2026-09-01T12:00:05.000Z');
  assert.equal(evidence.recoveredAt, '2026-09-01T12:00:10.000Z');
  assert.equal(evidence.deliveryEvidenceRef, null);
  assert.equal(evidence.observations.length, 3);
});

test('refuses a drill that does not begin healthy', async () => {
  await assert.rejects(
    observeApiTransition({
      authorizationRef,
      pollIntervalMs: 1,
      probe: async () => ({
        durationMs: 20,
        httpStatusCode: 503,
        observedAt: '2026-09-01T12:00:00.000Z',
        status: 'unavailable',
        target: liveUrl,
      }),
      sleep: async () => {},
      timeoutMs: 10,
    }),
    /must begin healthy/iu,
  );
});
