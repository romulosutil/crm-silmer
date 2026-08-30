export const SERVICES = Object.freeze({
  api: 'crm-silmer-api',
  worker: 'crm-silmer-worker',
});

export {
  createSafeLogger,
  createSafeLogRecord,
  MetricRegistry,
  normalizeTraceId,
  REDACTED_FIELD_NAMES,
} from './observability.js';
