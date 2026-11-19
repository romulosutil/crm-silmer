import { clearInterval, setInterval } from 'node:timers';
import {
  PostgresSellerWhatsAppRepository,
  sellerWhatsAppConfiguration,
} from '@crm-silmer/inbox-channels';
import {
  createWhatsAppControlClient,
  PostgresJobQueue,
} from '@crm-silmer/integration-reliability';

/** WAP-E02: a lost lease never starts HTTP, and an uncertain effect never retries.
 * @param {{repository:any,client?:any,environment?:Record<string,string|undefined>}} options */
export function createWhatsAppControlJobHandler(options) {
  const env = options.environment ?? process.env;
  /** @param {any} job @param {{markEffectStarted:(input:{provider:string})=>Promise<boolean>}} context */
  return async (job, context) => {
    let started = false;
    const operationId =
      job.whatsappOperationId ??
      job.whatsapp_operation_id ??
      job.idempotencyKey;
    const action =
      job.whatsappAction ??
      job.whatsapp_action ??
      (job.jobType === 'whatsapp.control.reconcile' ? 'reconcile' : undefined);
    try {
      if (
        !['whatsapp.control.deliver', 'whatsapp.control.reconcile'].includes(
          job.jobType,
        )
      )
        throw new Error('WHATSAPP_JOB_INVALID');
      const envelope = await options.repository.loadDelivery(operationId, {
        action,
      });
      const client =
        options.client ??
        createWhatsAppControlClient({
          enabled: true,
          allowlist: [envelope.lineId],
          controlEndpoint: env.N8N_WAP_CONTROL_URL ?? '',
          challengeEndpoint: env.N8N_WAP_CHALLENGE_URL ?? '',
          clientId: env.N8N_WAP_CLIENT_ID ?? '',
          clientSecret: env.N8N_WAP_CLIENT_SECRET ?? '',
        });
      if (!(await context.markEffectStarted({ provider: 'n8n' })))
        return {
          outcome: /** @type {const} */ ('failed'),
          errorCode: 'WHATSAPP_LEASE_LOST',
          retryable: false,
          retrySafe: false,
        };
      started = true;
      const result = await client.control(envelope);
      if (
        result.accepted !== true ||
        result.operationId !== envelope.operationId ||
        result.generation !== envelope.generation
      )
        throw new Error('WHATSAPP_ACK_INVALID');
      return {
        outcome: /** @type {const} */ ('sent'),
        providerExternalId: envelope.operationId,
      };
    } catch {
      if (started) await options.repository.markUnknown(operationId);
      return started
        ? {
            outcome: /** @type {const} */ ('outcome_unknown'),
            errorCode: 'WHATSAPP_OPERATION_UNCERTAIN',
            retryable: false,
            retrySafe: false,
          }
        : {
            outcome: /** @type {const} */ ('failed'),
            errorCode: 'WHATSAPP_CONTROL_DENIED',
            retryable: false,
            retrySafe: false,
          };
    }
  };
}

/** @param {{database:any,environment?:Record<string,string|undefined>,repository?:any,client?:any,queue?:any,logger?:any,healthSignals?:any,workerId?:string,WorkerRuntime:any}} options */
export function createWhatsAppControlWorkerRuntime(options) {
  const environment = options.environment ?? process.env;
  const config = sellerWhatsAppConfiguration(environment);
  if (!config.enabled) return undefined;
  if (!options.client)
    createWhatsAppControlClient({
      enabled: true,
      allowlist: [],
      controlEndpoint: environment.N8N_WAP_CONTROL_URL ?? '',
      challengeEndpoint: environment.N8N_WAP_CHALLENGE_URL ?? '',
      clientId: environment.N8N_WAP_CLIENT_ID ?? '',
      clientSecret: environment.N8N_WAP_CLIENT_SECRET ?? '',
    });
  const repository =
    options.repository ??
    new PostgresSellerWhatsAppRepository(options.database, config);
  const handler = createWhatsAppControlJobHandler({
    repository,
    environment,
    client: options.client,
  });
  const worker = new options.WorkerRuntime({
    handlers: {
      'whatsapp.control.deliver': handler,
      'whatsapp.control.reconcile': handler,
    },
    queue:
      options.queue ?? new PostgresJobQueue({ database: options.database }),
    queueName: 'whatsapp_control',
    logger: options.logger,
    healthSignals: options.healthSignals,
    workerId: options.workerId,
  });
  /** @type {ReturnType<typeof setInterval>|undefined} */
  let timer;
  let sweeping = false;
  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      await repository.scheduleReconciliations();
    } catch {
      /* Ledger remains uncertain; a later read-only sweep can reconcile. */
    } finally {
      sweeping = false;
    }
  }
  return {
    async start() {
      await sweep();
      await worker.start();
      timer = setInterval(() => {
        void sweep();
      }, 30_000);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      await worker.stop();
    },
  };
}
