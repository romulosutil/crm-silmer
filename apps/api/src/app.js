import Fastify from 'fastify';
import { performance } from 'node:perf_hooks';

import {
  createSafeLogger,
  MetricRegistry,
  normalizeTraceId,
  SERVICES,
} from '@crm-silmer/shared';

/**
 * Creates the HTTP API without binding a socket, so callers and tests own its
 * lifecycle.
 *
 * @param {import('fastify').FastifyServerOptions} [options]
 * @param {{
 *   logger?: ReturnType<typeof createSafeLogger>,
 *   metrics?: MetricRegistry,
 *   readiness?: () => boolean | Promise<boolean>
 * }} [runtime]
 */
export function createApi(options = {}, runtime = {}) {
  const api = Fastify({ ...options, logger: false });
  const logger = runtime.logger ?? createSafeLogger({ service: SERVICES.api });
  const metrics = runtime.metrics ?? new MetricRegistry({ logger });
  const readiness = runtime.readiness ?? (() => true);
  /** @type {WeakMap<object, { correlationId: string, requestId: string, startedAt: number }>} */
  const requests = new WeakMap();

  api.addHook('onRequest', async (request, reply) => {
    const requestId = normalizeTraceId(request.headers['x-request-id']);
    const correlationId = normalizeTraceId(
      request.headers['x-correlation-id'] ?? requestId,
    );
    requests.set(request, {
      correlationId,
      requestId,
      startedAt: performance.now(),
    });
    reply.header('x-request-id', requestId);
    reply.header('x-correlation-id', correlationId);
    logger.info('api_request_started', {
      correlation_id: correlationId,
      request_id: requestId,
    });
  });

  api.addHook('onError', async (request, _reply, error) => {
    const context = requests.get(request);
    logger.error('api_request_failed', {
      correlation_id: context?.correlationId,
      error_code:
        typeof error.code === 'string' ? error.code : 'UNHANDLED_ERROR',
      request_id: context?.requestId,
    });
  });

  api.addHook('onResponse', async (request, reply) => {
    const context = requests.get(request);
    const duration = Math.max(
      0,
      Math.round(
        (performance.now() - (context?.startedAt ?? performance.now())) * 100,
      ) / 100,
    );
    const metricContext = {
      correlation_id: context?.correlationId,
      request_id: context?.requestId,
      status_code: reply.statusCode,
    };

    metrics.increment('api_requests_total', 1, metricContext);
    metrics.record('api_duration_ms', duration, metricContext);
    if (reply.statusCode >= 500) {
      metrics.increment('api_5xx_total', 1, metricContext);
    }
    logger.info('api_request_completed', {
      ...metricContext,
      duration_ms: duration,
    });
  });

  const live = async () => ({
    service: SERVICES.api,
    status: 'ok',
  });

  api.get('/api/health/live', live);

  api.get('/api/health/ready', async (request, reply) => {
    try {
      if (await readiness()) {
        return { service: SERVICES.api, status: 'ready' };
      }
    } catch {
      const context = requests.get(request);
      logger.error('api_readiness_failed', {
        correlation_id: context?.correlationId,
        error_code: 'READINESS_CHECK_FAILED',
        request_id: context?.requestId,
      });
    }

    reply.code(503);
    return { service: SERVICES.api, status: 'unavailable' };
  });

  // Temporary compatibility for the T00.1 container contract.
  api.get('/health/live', live);

  return api;
}
