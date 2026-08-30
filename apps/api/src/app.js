import Fastify from 'fastify';

import { SERVICES } from '@crm-silmer/shared';

/**
 * Creates the HTTP API without binding a socket, so callers and tests own its
 * lifecycle.
 *
 * @param {import('fastify').FastifyServerOptions} [options]
 */
export function createApi(options = {}) {
  const api = Fastify(options);

  api.get('/health/live', async () => ({
    service: SERVICES.api,
    status: 'ok',
  }));

  return api;
}
