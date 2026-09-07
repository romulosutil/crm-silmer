import { randomUUID } from 'node:crypto';

/** @param {any} input */
function validate(input) {
  for (const field of [
    'aggregateId',
    'aggregateType',
    'correlationId',
    'type',
  ]) {
    if (typeof input?.[field] !== 'string' || input[field].trim() === '') {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }
  if (
    !Number.isSafeInteger(input.aggregateVersion) ||
    input.aggregateVersion < 1
  ) {
    throw new TypeError('aggregateVersion must be a positive integer');
  }
  if (
    !input.payload ||
    typeof input.payload !== 'object' ||
    Array.isArray(input.payload)
  ) {
    throw new TypeError('payload must be an object');
  }
}

export class InMemoryDomainEventStore {
  /** @type {any[]} */
  #events = [];
  /** @type {() => Date} */
  #clock;
  /** @type {() => string} */
  #idFactory;

  /** @param {{clock?: () => Date, idFactory?: () => string}} [options] */
  constructor({ clock = () => new Date(), idFactory = randomUUID } = {}) {
    this.#clock = clock;
    this.#idFactory = idFactory;
  }

  /** @param {any} input */
  async append(input) {
    validate(input);
    if (
      this.#events.some(
        (event) =>
          event.aggregateId === input.aggregateId &&
          event.aggregateVersion === input.aggregateVersion &&
          event.type === input.type,
      )
    ) {
      throw Object.assign(new Error('Domain event already exists'), {
        code: '23505',
      });
    }
    const event = Object.freeze({
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      aggregateVersion: input.aggregateVersion,
      correlationId: input.correlationId,
      id: this.#idFactory(),
      occurredAt: (input.occurredAt ?? this.#clock()).toISOString(),
      payload: Object.freeze(structuredClone(input.payload)),
      type: input.type,
    });
    this.#events.push(event);
    return event;
  }

  list() {
    return structuredClone(this.#events);
  }
}

export class PostgresDomainEventStore {
  /** @param {any} input @param {{transaction?: any}} [context] */
  async append(input, context = {}) {
    validate(input);
    const transaction = context.transaction;
    if (!transaction || typeof transaction.query !== 'function') {
      throw new TypeError('context.transaction must implement query');
    }
    const id = input.id ?? randomUUID();
    const occurredAt = (input.occurredAt ?? new Date()).toISOString();
    const result = await transaction.query(
      `INSERT INTO crm.domain_events
         (id, aggregate_type, aggregate_id, aggregate_version, event_type,
          payload, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       RETURNING id, aggregate_type, aggregate_id, aggregate_version,
                 event_type, payload, correlation_id, occurred_at`,
      [
        id,
        input.aggregateType,
        input.aggregateId,
        input.aggregateVersion,
        input.type,
        JSON.stringify(input.payload),
        input.correlationId,
        occurredAt,
      ],
    );
    const row = result.rows[0];
    return Object.freeze({
      aggregateId: row.aggregate_id,
      aggregateType: row.aggregate_type,
      aggregateVersion: Number(row.aggregate_version),
      correlationId: row.correlation_id,
      id: row.id,
      occurredAt: new Date(row.occurred_at).toISOString(),
      payload: Object.freeze(structuredClone(row.payload)),
      type: row.event_type,
    });
  }
}
