import { pathToFileURL } from 'node:url';

import { createDatabase } from '@crm-silmer/database';
import {
  InMemoryMetaEventStore,
  processMetaWebhook,
} from '@crm-silmer/integration-reliability';
import { createApi } from './app.js';
import { createCommercialRuntime } from './commercial-runtime.js';
import { createIdentityApiRuntime } from './identity-runtime.js';
import { createSafeLogger, SERVICES } from '@crm-silmer/shared';

/**
 * Production wiring stays unavailable until T01.1 injects the PostgreSQL
 * checker. Tests may inject a checker without weakening that default.
 *
 * @param {{
 *   database?: ReturnType<typeof createDatabase>,
 *   commercial?: ReturnType<typeof createCommercialRuntime>,
 *   logger?: ReturnType<typeof createSafeLogger>,
 *   readiness?: () => boolean | Promise<boolean>,
 *   metaWebhook?: ReturnType<typeof createMetaWebhookRuntime>,
 *   identity?: ReturnType<typeof createIdentityApiRuntime>,
 *   trustProxy?: import('fastify').FastifyServerOptions['trustProxy']
 * }} [runtime]
 */
export function createServerApi(runtime = {}) {
  const logger = runtime.logger ?? createSafeLogger({ service: SERVICES.api });
  const readiness = runtime.readiness ?? runtime.database?.readiness;
  const metaWebhook = runtime.metaWebhook ?? createMetaWebhookRuntime();
  const commercial =
    runtime.commercial ??
    (runtime.database ? createCommercialRuntime(runtime.database) : undefined);
  const api = createApi(
    { trustProxy: runtime.trustProxy ?? false },
    { ...runtime, commercial, logger, metaWebhook, readiness },
  );
  const database = runtime.database;
  if (database) {
    api.addHook('onClose', () => database.close());
  }
  return api;
}

/**
 * The Phase 0 sandbox store proves the webhook boundary and replay behavior in
 * one process. T02.2 replaces it with the PostgreSQL inbox before production.
 *
 * @param {Record<string, string|undefined>} [environment]
 */
export function createMetaWebhookRuntime(environment = process.env) {
  const appSecret = environment.META_APP_SECRET;
  const verifyToken = environment.META_VERIFY_TOKEN;
  if (!appSecret || !verifyToken) return undefined;

  const eventStore = new InMemoryMetaEventStore();
  return Object.freeze({
    verifyToken,
    /** @param {{rawBody: Buffer, signature: unknown}} input */
    process: (input) =>
      processMetaWebhook({
        appSecret,
        eventStore,
        onEvent: async () => undefined,
        ...input,
      }),
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const logger = createSafeLogger({ service: SERVICES.api });
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  try {
    const database = createDatabase({
      connectionString: process.env.DATABASE_URL ?? '',
    });
    const api = createServerApi({
      database,
      identity: createIdentityApiRuntime(database),
      logger,
      trustProxy: 'loopback, linklocal, uniquelocal',
    });
    await api.listen({ host, port });
  } catch (error) {
    logger.error('api_start_failed', {
      error_code:
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : 'API_START_FAILED',
    });
    process.exitCode = 1;
  }
}
