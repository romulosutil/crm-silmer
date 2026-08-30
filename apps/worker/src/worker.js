import { pathToFileURL } from 'node:url';
import { clearInterval, setInterval } from 'node:timers';

import { createSafeLogger, MetricRegistry, SERVICES } from '@crm-silmer/shared';

/**
 * Minimal process boundary for the asynchronous runtime. Domain jobs are added
 * by later tracked tasks.
 */
export class WorkerRuntime {
  /**
   * @param {{
   *   heartbeatIntervalMs?: number,
   *   logger?: ReturnType<typeof createSafeLogger>,
   *   metrics?: MetricRegistry,
   *   now?: () => number
   * }} [options]
   */
  constructor(options = {}) {
    this.name = SERVICES.worker;
    this.logger =
      options.logger ?? createSafeLogger({ service: SERVICES.worker });
    this.metrics =
      options.metrics ?? new MetricRegistry({ logger: this.logger });
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.now = options.now ?? Date.now;
    /** @type {NodeJS.Timeout | undefined} */
    this.heartbeatTimer = undefined;
  }

  /** @returns {Promise<void>} */
  async start() {
    if (this.heartbeatTimer) return;

    this.emitHeartbeat();
    this.heartbeatTimer = setInterval(
      () => this.emitHeartbeat(),
      this.heartbeatIntervalMs,
    );
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

  async stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.logger.info('worker_stopped');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const worker = new WorkerRuntime();
  await worker.start();
}
