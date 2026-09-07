import { freezeDealRecord } from '../domain/deal.js';
import { DealConflictError } from '../domain/errors.js';

export class InMemoryDealRepository {
  /** @type {Map<string, any>} */
  #deals = new Map();
  /** @type {any[]} */
  #gates = [];
  /** @type {any[]} */
  #history = [];
  /** @type {Map<string, Promise<unknown>>} */
  #locks = new Map();

  /** @param {{deals?: any[]}} [options] */
  constructor({ deals = [] } = {}) {
    for (const deal of deals) this.#deals.set(deal.id, structuredClone(deal));
  }

  /** @param {any} input @param {(deal: any) => Promise<any>} operation */
  async executeLocked(input, operation) {
    const previous = this.#locks.get(input.dealId) ?? Promise.resolve();
    /** @type {(value?: unknown) => void} */
    let release = () => {};
    const current = new Promise((resolve) => {
      release = resolve;
    });
    this.#locks.set(input.dealId, current);
    await previous;
    try {
      const deal = this.#deals.get(input.dealId);
      if (!deal || deal.version !== input.expectedVersion) {
        throw new DealConflictError(
          'Deal version conflicts with current state',
        );
      }
      return await operation(freezeDealRecord(structuredClone(deal)));
    } finally {
      release();
      if (this.#locks.get(input.dealId) === current)
        this.#locks.delete(input.dealId);
    }
  }

  /** @param {any} input */
  async applyTransition(input) {
    const stored = this.#current(input.deal);
    const version = stored.version + 1;
    if (input.gate) this.#gates.push(structuredClone(input.gate));
    this.#history.push({
      actorId: input.actorId,
      dealId: stored.id,
      fromStage: stored.stage,
      kind: input.direction === 'advance' ? 'advanced' : 'retreated',
      occurredAt: input.occurredAt,
      reason: input.reason,
      resultingVersion: version,
      toStage: input.toStage,
    });
    Object.assign(stored, {
      stage: input.toStage,
      updatedAt: input.occurredAt,
      version,
    });
    return freezeDealRecord(structuredClone(stored));
  }

  /** @param {any} input */
  async lose(input) {
    const stored = this.#current(input.deal);
    const version = stored.version + 1;
    this.#history.push({
      actorId: input.actorId,
      dealId: stored.id,
      fromStage: stored.stage,
      kind: 'lost',
      occurredAt: input.occurredAt,
      reason: null,
      resultingVersion: version,
      toStage: null,
    });
    Object.assign(stored, {
      lostAt: input.occurredAt,
      lossReasonEnvelope: structuredClone(input.lossReasonEnvelope),
      status: 'lost',
      updatedAt: input.occurredAt,
      version,
    });
    return freezeDealRecord(publicDeal(stored));
  }

  /** @param {any} input */
  async applyFields(input) {
    const stored = this.#current(input.deal);
    const version = stored.version + 1;
    if (input.returnedTo) {
      this.#history.push({
        actorId: input.actorId,
        dealId: stored.id,
        fromStage: stored.stage,
        kind: 'returned',
        occurredAt: input.occurredAt,
        reason: null,
        resultingVersion: version,
        toStage: input.returnedTo,
      });
    }
    Object.assign(stored, {
      ...(input.returnedTo ? { stage: input.returnedTo } : {}),
      updatedAt: input.occurredAt,
      version,
    });
    return freezeDealRecord(publicDeal(stored));
  }

  /** @param {string} id */
  get(id) {
    const deal = this.#deals.get(id);
    return deal ? freezeDealRecord(publicDeal(deal)) : null;
  }

  /** @param {string} id */
  getStored(id) {
    const deal = this.#deals.get(id);
    return deal ? structuredClone(deal) : null;
  }

  /** @param {string} dealId */
  listGates(dealId) {
    return structuredClone(
      this.#gates.filter((gate) => gate.dealId === dealId),
    );
  }
  /** @param {string} dealId */
  listHistory(dealId) {
    return structuredClone(
      this.#history.filter((entry) => entry.dealId === dealId),
    );
  }

  /** @param {any} deal */
  #current(deal) {
    const stored = this.#deals.get(deal.id);
    if (!stored || stored.version !== deal.version) {
      throw new DealConflictError('Deal changed during command');
    }
    return stored;
  }
}

/** @param {any} deal */
function publicDeal(deal) {
  const copy = structuredClone(deal);
  delete copy.lossReasonEnvelope;
  return copy;
}
