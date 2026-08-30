import { pathToFileURL } from 'node:url';

import { createApi } from './app.js';
import { createSafeLogger, SERVICES } from '@crm-silmer/shared';

/**
 * Production wiring stays unavailable until T01.1 injects the PostgreSQL
 * checker. Tests may inject a checker without weakening that default.
 *
 * @param {{
 *   logger?: ReturnType<typeof createSafeLogger>,
 *   readiness?: () => boolean | Promise<boolean>
 * }} [runtime]
 */
export function createServerApi(runtime = {}) {
  const logger = runtime.logger ?? createSafeLogger({ service: SERVICES.api });
  return createApi({}, { ...runtime, logger });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const logger = createSafeLogger({ service: SERVICES.api });
  const api = createServerApi({ logger });
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  try {
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
