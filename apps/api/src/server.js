import { pathToFileURL } from 'node:url';

import { createDatabase } from '@crm-silmer/database';
import { createMetaWhatsAppNormalizer } from '@crm-silmer/inbox-channels';
import {
  InMemoryMetaEventStore,
  PostgresWebhookInbox,
  processMetaWebhook,
} from '@crm-silmer/integration-reliability';
import { createApi } from './app.js';
import { createCommercialRuntime } from './commercial-runtime.js';
import { createIdentityApiRuntime } from './identity-runtime.js';
import { createWhatsAppWebhookRuntime } from './whatsapp-webhook-runtime.js';
import { createSafeLogger, SERVICES } from '@crm-silmer/shared';

/**
 * Production wiring stays unavailable until T01.1 injects the PostgreSQL
 * checker. Tests may inject a checker without weakening that default.
 *
 * @param {{
 *   database?: ReturnType<typeof createDatabase>,
 *   commercial?: ReturnType<typeof createCommercialRuntime>,
 *   environment?: Record<string, string|undefined>,
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
  const metaWebhook =
    runtime.metaWebhook ??
    (runtime.database
      ? createDurableMetaWebhookRuntime(
          runtime.database,
          runtime.environment ?? process.env,
        )
      : undefined);
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
 * Legacy Phase 0 sandbox helper. Production wiring never calls this in-memory
 * runtime; it remains only for the isolated synthetic smoke contract.
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

/**
 * Creates the production webhook only when its complete durable configuration
 * exists. Partial configuration is a startup error rather than an in-memory
 * fallback.
 *
 * @param {ReturnType<typeof createDatabase>|{query: Function, transaction: Function}} database
 * @param {Record<string, string|undefined>} [environment]
 */
export function createDurableMetaWebhookRuntime(
  database,
  environment = process.env,
) {
  const names = [
    'META_APP_SECRET',
    'META_VERIFY_TOKEN',
    'META_WHATSAPP_BUSINESS_ACCOUNT_ID',
    'META_WHATSAPP_PHONE_NUMBER_ID',
    'META_WEBHOOK_PAYLOAD_ENVELOPE_KEY',
  ];
  if (names.every((name) => !environment[name])) return undefined;

  const appSecret = requireConfiguredSecret(
    environment.META_APP_SECRET,
    'META_APP_SECRET',
  );
  const verifyToken = requireConfiguredSecret(
    environment.META_VERIFY_TOKEN,
    'META_VERIFY_TOKEN',
  );
  const envelopeKey = readEnvelopeKey(
    environment.META_WEBHOOK_PAYLOAD_ENVELOPE_KEY,
  );
  const normalize = createMetaWhatsAppNormalizer({
    businessAccountId: requireConfiguredSecret(
      environment.META_WHATSAPP_BUSINESS_ACCOUNT_ID,
      'META_WHATSAPP_BUSINESS_ACCOUNT_ID',
    ),
    phoneNumberId: requireConfiguredSecret(
      environment.META_WHATSAPP_PHONE_NUMBER_ID,
      'META_WHATSAPP_PHONE_NUMBER_ID',
    ),
  });
  const inbox = new PostgresWebhookInbox({ database, envelopeKey });
  return createWhatsAppWebhookRuntime({
    appSecret,
    inbox,
    normalize,
    verifyToken,
  });
}

/** @param {string|undefined} value @param {string} name */
function requireConfiguredSecret(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required when the Meta webhook is enabled`);
  }
  return value;
}

/** @param {string|undefined} value */
function readEnvelopeKey(value) {
  const name = 'META_WEBHOOK_PAYLOAD_ENVELOPE_KEY';
  const encoded = requireConfiguredSecret(value, name);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new Error(`${name} must use base64url`);
  }
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
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
