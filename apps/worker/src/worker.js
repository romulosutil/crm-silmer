import { pathToFileURL } from 'node:url';
import { clearInterval, setInterval } from 'node:timers';

import { createSafeLogger, MetricRegistry, SERVICES } from '@crm-silmer/shared';

/**
 * Process boundary for asynchronous jobs. Concrete handlers are injected by
 * each domain module, keeping queue reliability independent from job payloads.
 */
export class WorkerRuntime {
  /**
   * @param {{
   *   handlers?: Record<string, (job: Readonly<Record<string, unknown>>, context: {heartbeat: () => Promise<boolean>, markEffectStarted: (input: {provider: string}) => Promise<boolean>}) => Promise<{outcome: 'sent'|'failed'|'outcome_unknown', errorCode?: string, providerExternalId?: string, retryable?: boolean, retrySafe?: boolean}>>,
   *   heartbeatIntervalMs?: number,
   *   leaseMs?: number,
   *   logger?: ReturnType<typeof createSafeLogger>,
   *   metrics?: MetricRegistry,
   *   now?: () => number,
   *   pollIntervalMs?: number,
   *   queue?: {claim: Function, heartbeat: Function, markEffectStarted: Function, settle: Function},
   *   workerId?: string
   * }} [options]
   */
  constructor(options = {}) {
    this.name = SERVICES.worker;
    this.logger =
      options.logger ?? createSafeLogger({ service: SERVICES.worker });
    this.metrics =
      options.metrics ?? new MetricRegistry({ logger: this.logger });
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.queue = options.queue;
    this.handlers = Object.freeze({ ...(options.handlers ?? {}) });
    this.workerId = options.workerId ?? `worker-${process.pid}`;
    /** @type {NodeJS.Timeout | undefined} */
    this.heartbeatTimer = undefined;
    /** @type {NodeJS.Timeout | undefined} */
    this.pollTimer = undefined;
    /** @type {Promise<void>|undefined} */
    this.pollInFlight = undefined;
  }

  /** @returns {Promise<void>} */
  async start() {
    if (this.heartbeatTimer) return;

    this.emitHeartbeat();
    this.heartbeatTimer = setInterval(
      () => this.emitHeartbeat(),
      this.heartbeatIntervalMs,
    );
    if (this.queue) {
      this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
      this.poll();
    }
    this.logger.info('worker_started');
  }

  emitHeartbeat() {
    this.metrics.record(
      'worker_heartbeat_unixtime_seconds',
      Math.floor(this.now() / 1000),
    );
  }

  /**
   * Records bounded technical dimensions only. Job content and errors are not
   * accepted by this boundary.
   *
   * @param {{ ageSeconds?: number, errorCode?: string, jobType?: string, queue?: string }} [event]
   */
  recordJobFailure(event = {}) {
    const context = {
      error_code: event.errorCode ?? 'JOB_FAILED',
      job_type: event.jobType ?? 'unknown_job',
      queue: event.queue ?? 'default',
    };
    this.metrics.increment('worker_jobs_failed_total', 1, context);
    this.metrics.record(
      'worker_oldest_job_age_seconds',
      Math.max(0, event.ageSeconds ?? 0),
      context,
    );
    this.logger.error('worker_job_failed', context);
  }

  /** Processes at most one claim batch without overlapping another poll. */
  async poll() {
    if (this.pollInFlight) return this.pollInFlight;
    this.pollInFlight = this.runOnce()
      .then(() => {})
      .finally(() => {
        this.pollInFlight = undefined;
      });
    return this.pollInFlight;
  }

  /** @returns {Promise<number>} */
  async runOnce() {
    const queue = this.queue;
    if (!queue) return 0;
    const jobs = await queue.claim({
      leaseMs: this.leaseMs,
      limit: 1,
      now: new Date(this.now()),
      workerId: this.workerId,
    });
    for (const job of jobs) {
      await this.processJob(job);
    }
    return jobs.length;
  }

  /** @param {Readonly<Record<string, any>>} job */
  async processJob(job) {
    const queue = this.queue;
    if (!queue) throw new Error('Worker queue is not configured');
    const handler = this.handlers[job.jobType];
    let effectStarted = false;
    const heartbeat = () =>
      queue.heartbeat({
        attemptId: job.attemptId,
        jobId: job.id,
        leaseMs: this.leaseMs,
        now: new Date(this.now()),
        workerId: this.workerId,
      });
    /** @param {{provider: string}} input */
    const markEffectStarted = async ({ provider }) => {
      const marked = await queue.markEffectStarted({
        attemptId: job.attemptId,
        jobId: job.id,
        now: new Date(this.now()),
        provider,
        workerId: this.workerId,
      });
      if (!marked) throw new Error('Job lease was lost before effect start');
      effectStarted = true;
      return true;
    };
    const context = Object.freeze({
      heartbeat,
      markEffectStarted,
    });

    try {
      if (!handler) throw new Error('No handler registered for job type');
      const result = await handler(job, context);
      await queue.settle({
        attemptId: job.attemptId,
        errorCode: result.errorCode,
        jobId: job.id,
        now: new Date(this.now()),
        outcome: result.outcome,
        providerExternalId: result.providerExternalId,
        retryable: result.retryable ?? false,
        retrySafe: result.retrySafe ?? false,
        workerId: this.workerId,
      });
    } catch (error) {
      const errorCode = technicalErrorCode(error);
      this.recordJobFailure({
        errorCode,
        jobType: job.jobType,
        queue: job.queue,
      });
      await queue.settle({
        attemptId: job.attemptId,
        errorCode,
        jobId: job.id,
        now: new Date(this.now()),
        outcome: effectStarted ? 'outcome_unknown' : 'failed',
        retryable: !effectStarted,
        retrySafe: !effectStarted,
        workerId: this.workerId,
      });
    }
  }

  async stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    await this.pollInFlight;
    this.logger.info('worker_stopped');
  }
}

/** @param {unknown} error */
function technicalErrorCode(error) {
  const candidate =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'JOB_HANDLER_FAILED';
  return /^[A-Z0-9_]{1,64}$/u.test(candidate)
    ? candidate
    : 'JOB_HANDLER_FAILED';
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const worker = new WorkerRuntime();
  await worker.start();
}
