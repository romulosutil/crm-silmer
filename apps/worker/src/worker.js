import { SERVICES } from '@crm-silmer/shared';

/**
 * Minimal process boundary for the asynchronous runtime. Domain jobs are added
 * by later tracked tasks.
 */
export class WorkerRuntime {
  name = SERVICES.worker;

  /** @returns {Promise<void>} */
  async start() {
    await Promise.resolve();
  }
}

const worker = new WorkerRuntime();
await worker.start();
