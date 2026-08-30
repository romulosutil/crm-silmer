import { createApi } from './app.js';
import { createSafeLogger, SERVICES } from '@crm-silmer/shared';

const logger = createSafeLogger({ service: SERVICES.api });
const api = createApi({}, { logger });
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
