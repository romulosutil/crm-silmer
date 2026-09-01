import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootPath = fileURLToPath(new URL('../', import.meta.url));
const authorizationReferencePattern =
  /^https:\/\/github\.com\/romulosutil\/crm-silmer\/issues\/11#issuecomment-\d+$/u;
const evidencePathPattern = /^var\/[a-z0-9][a-z0-9._/-]*\.json$/u;
const nativePathApi = { isAbsolute, relative, sep };

/**
 * @param {string} candidatePath
 * @param {string} directoryPath
 * @param {{ isAbsolute: typeof isAbsolute, relative: typeof relative, sep: string }} [pathApi]
 */
export function isPathWithinDirectory(
  candidatePath,
  directoryPath,
  pathApi = nativePathApi,
) {
  const nestedPath = pathApi.relative(directoryPath, candidatePath);
  return (
    nestedPath !== '' &&
    nestedPath !== '..' &&
    !nestedPath.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(nestedPath)
  );
}
const forbiddenEvidencePattern =
  /(?:authorization["':]|body["':]|cliente|cookie|email|password|phone|secret|token|webhook)/iu;

/** @param {unknown} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {Record<string, string|undefined>} environment @param {string} name */
function required(environment, name) {
  const value = environment[name]?.trim();
  invariant(value, `${name} is required`);
  return /** @type {string} */ (value);
}

/**
 * @param {Record<string, string|undefined>} environment
 * @param {string} name
 * @param {number} fallback
 */
function positiveInteger(environment, name, fallback) {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  invariant(Number.isInteger(value) && value > 0, `${name} must be positive`);
  return value;
}

/** @param {string} value */
function canonicalLiveUrl(value) {
  const url = new URL(value);
  invariant(
    url.protocol === 'https:' &&
      url.pathname === '/api/health/live' &&
      url.search === '' &&
      url.hash === '',
    'Probe target must be the canonical HTTPS endpoint without query data',
  );
  return url.toString();
}

/** @param {Record<string, string|undefined>} environment */
export function validateProbeEnvironment(environment) {
  const liveUrl = canonicalLiveUrl(
    required(environment, 'OBSERVABILITY_LIVE_URL'),
  );
  const evidencePath =
    environment.OBSERVABILITY_EVIDENCE_PATH?.trim() ||
    'var/observability-live-baseline.json';
  invariant(
    evidencePathPattern.test(evidencePath) && !evidencePath.includes('..'),
    'Observability evidence path must stay below var/',
  );
  const mode = environment.OBSERVABILITY_MODE?.trim() || 'baseline';
  invariant(
    ['baseline', 'watch-api-drill'].includes(mode),
    'OBSERVABILITY_MODE must be baseline or watch-api-drill',
  );
  const authorizationRef =
    environment.OBSERVABILITY_AUTHORIZATION_REF?.trim() || null;
  if (mode === 'watch-api-drill') {
    invariant(
      authorizationRef && authorizationReferencePattern.test(authorizationRef),
      'Live drill requires a versioned issue 11 authorization reference',
    );
  }

  return {
    authorizationRef,
    evidencePath,
    liveUrl,
    mode,
    pollIntervalMs: positiveInteger(
      environment,
      'OBSERVABILITY_POLL_INTERVAL_MS',
      5_000,
    ),
    timeoutMs: positiveInteger(
      environment,
      'OBSERVABILITY_TIMEOUT_MS',
      900_000,
    ),
  };
}

/**
 * @param {{
 *   liveUrl: string,
 *   fetchImpl?: typeof fetch,
 *   monotonicNow?: () => number,
 *   now?: () => Date,
 * }} options
 */
export async function probeLiveEndpoint({
  liveUrl,
  fetchImpl = globalThis.fetch,
  monotonicNow = () => performance.now(),
  now = () => new Date(),
}) {
  const target = canonicalLiveUrl(liveUrl);
  const started = monotonicNow();
  let httpStatusCode = null;
  try {
    const response = await fetchImpl(target, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    httpStatusCode = response.status === 200 ? 200 : null;
  } catch {
    // Network error details are intentionally discarded to keep evidence bounded.
  }
  const durationMs = Math.max(0, Math.round(monotonicNow() - started));

  return {
    durationMs,
    httpStatusCode,
    observedAt: now().toISOString(),
    status: httpStatusCode === 200 ? 'healthy' : 'unavailable',
    target,
  };
}

/** @template T @param {T} evidence @returns {T} */
export function assertSafeProbeEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  invariant(
    !forbiddenEvidencePattern.test(serialized),
    'Observability evidence contains a forbidden field or value',
  );
  invariant(
    serialized.length <= 100_000,
    'Observability evidence is unbounded',
  );
  return evidence;
}

/**
 * @param {{
 *   authorizationRef: string,
 *   pollIntervalMs: number,
 *   probe: () => Promise<any>,
 *   sleep?: (milliseconds: number) => Promise<void>,
 *   timeoutMs: number,
 *   monotonicNow?: () => number,
 * }} options
 */
export async function observeApiTransition({
  authorizationRef,
  pollIntervalMs,
  probe,
  sleep = (milliseconds) => sleepTimer(milliseconds),
  timeoutMs,
  monotonicNow = () => performance.now(),
}) {
  invariant(
    authorizationReferencePattern.test(authorizationRef),
    'Live drill requires a versioned issue 11 authorization reference',
  );
  invariant(
    Number.isInteger(pollIntervalMs) && pollIntervalMs > 0,
    'Poll interval must be positive',
  );
  invariant(
    Number.isInteger(timeoutMs) && timeoutMs > 0,
    'Drill timeout must be positive',
  );

  const startedMonotonic = monotonicNow();
  const first = await probe();
  invariant(first?.status === 'healthy', 'API drill must begin healthy');
  const observations = [first];
  let detectedAt = null;

  while (monotonicNow() - startedMonotonic <= timeoutMs) {
    await sleep(pollIntervalMs);
    const observation = await probe();
    invariant(
      observation?.status === 'healthy' ||
        observation?.status === 'unavailable',
      'Probe returned an invalid observation',
    );
    observations.push(observation);
    invariant(
      observations.length <= 256,
      'Drill observation count is unbounded',
    );

    if (!detectedAt && observation.status === 'unavailable') {
      detectedAt = observation.observedAt;
      continue;
    }
    if (detectedAt && observation.status === 'healthy') {
      return assertSafeProbeEvidence({
        authorizationRef,
        deliveredAt: null,
        deliveryEvidenceRef: null,
        detectedAt,
        issue: 11,
        observations,
        recoveredAt: observation.observedAt,
        scenario: 'api-stop-recovery',
        schemaVersion: 1,
        startedAt: first.observedAt,
        status: 'partial-live-evidence',
        target: first.target,
        task: 'T00.7',
      });
    }
  }

  throw new Error(
    'API drill timed out before outage and recovery were observed',
  );
}

/** @param {string} evidencePath @param {unknown} evidence */
async function writeEvidence(evidencePath, evidence) {
  const absolutePath = resolve(rootPath, evidencePath);
  invariant(
    isPathWithinDirectory(absolutePath, resolve(rootPath, 'var')),
    'Observability evidence path must stay below var/',
  );
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    `${JSON.stringify(assertSafeProbeEvidence(evidence), null, 2)}\n`,
    'utf8',
  );
  return absolutePath;
}

async function main() {
  const cliMode = process.argv.includes('--watch-api-drill')
    ? 'watch-api-drill'
    : 'baseline';
  const config = validateProbeEnvironment({
    ...process.env,
    OBSERVABILITY_MODE: cliMode,
  });
  const probe = () => probeLiveEndpoint({ liveUrl: config.liveUrl });
  const evidence =
    config.mode === 'watch-api-drill'
      ? await observeApiTransition({
          authorizationRef: /** @type {string} */ (config.authorizationRef),
          pollIntervalMs: config.pollIntervalMs,
          probe,
          timeoutMs: config.timeoutMs,
        })
      : assertSafeProbeEvidence({
          deliveryEvidenceRef: null,
          issue: 11,
          observation: await probe(),
          scenario: 'baseline',
          schemaVersion: 1,
          status: 'baseline-observed',
          task: 'T00.7',
        });
  await writeEvidence(config.evidencePath, evidence);
  console.log('Observability evidence written below the local var directory.');
  console.log(
    'This probe does not prove provider delivery or complete the T00.7 gate.',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error('Observability live probe failed:', error.message);
    process.exitCode = 1;
  });
}
