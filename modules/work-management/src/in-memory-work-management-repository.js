import { randomUUID } from 'node:crypto';

import {
  WorkConflictError,
  WorkForbiddenError,
  WorkValidationError,
} from './errors.js';

export class InMemoryWorkManagementRepository {
  /** @type {any[]} */
  #assignmentHistory = [];
  #conversations = new Map();
  #deals = new Map();
  #handoffs = new Map();
  /** @type {any[]} */
  #handoffHistory = [];
  #idFactory;
  #tasks = new Map();
  /** @type {any[]} */
  #taskHistory = [];
  #users = new Map();

  /** @param {{deals?: any[], conversations?: any[], handoffs?: any[], users?: any[], idFactory?: (kind: string) => string}} [options] */
  constructor({
    deals = [],
    conversations = [],
    handoffs = [],
    users = [],
    idFactory,
  } = {}) {
    this.#idFactory = idFactory ?? ((kind) => `${kind}-${randomUUID()}`);
    for (const value of deals)
      this.#deals.set(value.id, structuredClone(value));
    for (const value of conversations)
      this.#conversations.set(value.id, structuredClone(value));
    for (const value of handoffs)
      this.#handoffs.set(value.id, structuredClone(value));
    for (const value of users)
      this.#users.set(value.id, structuredClone(value));
  }

  /** @param {any} input */
  async assignDeal(input) {
    this.#humanActor(input);
    const deal = this.#deal(input.dealId, input.expectedDealVersion);
    const user = this.#user(input.assignedUserId);
    this.#assign(deal, user, input);
    return freeze({ deal: publicDeal(deal) });
  }

  /** @param {any} input */
  async createTask(input) {
    this.#humanActor(input);
    const deal = this.#deal(input.dealId, input.expectedDealVersion);
    const user = this.#user(input.assignedUserId);
    deal.version += 1;
    deal.updatedAt = input.occurredAt;
    const task = {
      assignedUserId: user.id,
      createdAt: input.occurredAt,
      dealId: deal.id,
      dueAt: input.dueAt,
      handoffId: null,
      id: this.#idFactory('task'),
      status: 'pending',
      textEnvelope: structuredClone(input.textEnvelope),
      type: 'follow_up',
      updatedAt: input.occurredAt,
      version: 1,
    };
    this.#tasks.set(task.id, task);
    this.#taskHistory.push(history(task, null, 'pending', input));
    return freeze({ deal: publicDeal(deal), task: publicTask(task) });
  }

  /** @param {any} input */
  async updateTask(input) {
    this.#humanActor(input);
    const task = this.#task(input.taskId, input.expectedTaskVersion);
    if (task.handoffId) {
      throw new WorkConflictError(
        'Handoff tasks can only change with their handoff',
      );
    }
    if (task.assignedUserId !== input.actor.id) {
      throw new WorkConflictError('Task belongs to another assignee');
    }
    const transitions = {
      cancel: { from: ['pending', 'in_progress'], to: 'cancelled' },
      complete: { from: ['pending', 'in_progress'], to: 'completed' },
      start: { from: ['pending'], to: 'in_progress' },
    };
    const transition =
      transitions[/** @type {'cancel'|'complete'|'start'} */ (input.action)];
    if (!transition?.from.includes(task.status)) {
      throw new WorkConflictError('Task state conflicts with action');
    }
    const previous = task.status;
    task.status = transition.to;
    task.version += 1;
    task.updatedAt = input.occurredAt;
    this.#taskHistory.push(history(task, previous, task.status, input));
    return freeze({ task: publicTask(task) });
  }

  /** @param {any} input */
  async createHandoff(input) {
    this.#humanActor(input);
    const deal = this.#deal(input.dealId, input.expectedDealVersion);
    const conversation = this.#conversation(
      input.conversationId,
      input.expectedConversationVersion,
    );
    const user = this.#user(input.assignedUserId);
    if (deal.status !== 'active')
      throw new WorkConflictError('Deal is not active');
    if (conversation.terminalAt || conversation.contactId !== deal.contactId) {
      throw new WorkConflictError(
        'Conversation is not active for the Deal contact',
      );
    }
    if (
      input.actor.kind === 'AUTOMATION_EXECUTOR' &&
      (conversation.automationState !== 'assistant' ||
        conversation.automationEpoch !== input.automationEpoch)
    ) {
      throw new WorkConflictError('Automation fence is stale');
    }
    if (
      [...this.#handoffs.values()].some(
        (value) =>
          value.status !== 'resolved' &&
          (value.dealId === deal.id ||
            value.conversationId === conversation.id),
      )
    ) {
      throw new WorkConflictError('An active handoff already exists');
    }
    if (input.commercialReason && user.functionName !== 'Vendedor') {
      throw new WorkValidationError('Commercial handoffs require a Vendedor');
    }

    this.#assign(deal, user, input);
    conversation.assignedUserId = user.id;
    conversation.automationEpoch += 1;
    conversation.automationState = 'human';
    conversation.state = 'em_atendimento';
    conversation.version += 1;
    conversation.updatedAt = input.occurredAt;

    const handoff = {
      assignedUserId: user.id,
      automationExecutionId: input.automationContext?.executionId ?? null,
      automationWorkflowKey: input.automationContext?.workflowKey ?? null,
      automationWorkflowVersion:
        input.automationContext?.workflowVersion ?? null,
      conversationId: conversation.id,
      createdAt: input.occurredAt,
      dealId: deal.id,
      dueAt: input.dueAt,
      id: this.#idFactory('handoff'),
      reasonCode: input.reasonCode,
      targetRole: user.functionName,
      slaMinutes: input.slaMinutes,
      slaPolicyVersion: input.slaPolicyVersion,
      status: 'pending',
      summaryEnvelope: structuredClone(input.summaryEnvelope),
      updatedAt: input.occurredAt,
      version: 1,
    };
    const task = {
      assignedUserId: user.id,
      createdAt: input.occurredAt,
      dealId: deal.id,
      dueAt: input.dueAt,
      handoffId: handoff.id,
      id: this.#idFactory('task'),
      status: 'pending',
      textEnvelope: structuredClone(input.taskTextEnvelope),
      type: 'human_handoff',
      updatedAt: input.occurredAt,
      version: 1,
    };
    this.#handoffs.set(handoff.id, handoff);
    this.#tasks.set(task.id, task);
    this.#handoffHistory.push(history(handoff, null, 'pending', input));
    this.#taskHistory.push(history(task, null, 'pending', input));
    return freeze({
      conversation: publicConversation(conversation),
      deal: publicDeal(deal),
      handoff: publicHandoff(handoff),
      task: publicTask(task),
    });
  }

  /** @param {any} input */
  async updateHandoff(input) {
    this.#humanActor(input);
    const handoff = this.#handoff(
      input.handoffId,
      input.expectedHandoffVersion,
    );
    const deal = this.#deal(handoff.dealId, input.expectedDealVersion);
    const conversation = this.#conversation(
      handoff.conversationId,
      input.expectedConversationVersion,
    );
    const task = [...this.#tasks.values()].find(
      (value) => value.handoffId === handoff.id,
    );
    if (!task || task.version !== input.expectedTaskVersion) {
      throw new WorkConflictError('Handoff task version conflicts');
    }
    if (handoff.assignedUserId !== input.actor.id) {
      throw new WorkConflictError('Handoff belongs to another assignee');
    }
    if (conversation.automationState !== 'human') {
      throw new WorkConflictError('Conversation automation state changed');
    }

    const previousHandoff = handoff.status;
    const previousTask = task.status;
    if (input.action === 'accept') {
      if (handoff.status !== 'pending' || task.status !== 'pending') {
        throw new WorkConflictError('Handoff cannot be accepted');
      }
      handoff.status = 'accepted';
      task.status = 'in_progress';
    } else if (input.action === 'transfer') {
      if (!['pending', 'accepted'].includes(handoff.status)) {
        throw new WorkConflictError('Handoff cannot be transferred');
      }
      const user = this.#user(input.assignedUserId);
      if (
        handoff.reasonCode === 'price_before_quote' &&
        user.functionName !== 'Vendedor'
      ) {
        throw new WorkValidationError('Commercial handoffs require a Vendedor');
      }
      this.#assign(deal, user, input);
      conversation.assignedUserId = user.id;
      conversation.version += 1;
      conversation.updatedAt = input.occurredAt;
      handoff.assignedUserId = user.id;
      task.assignedUserId = user.id;
    } else {
      if (!['pending', 'accepted'].includes(handoff.status)) {
        throw new WorkConflictError('Handoff cannot be resolved');
      }
      handoff.status = 'resolved';
      task.status = 'completed';
    }
    handoff.version += 1;
    handoff.updatedAt = input.occurredAt;
    task.version += 1;
    task.updatedAt = input.occurredAt;
    this.#handoffHistory.push(
      history(handoff, previousHandoff, handoff.status, input),
    );
    this.#taskHistory.push(history(task, previousTask, task.status, input));
    return freeze({
      conversation: publicConversation(conversation),
      deal: publicDeal(deal),
      handoff: publicHandoff(handoff),
      task: publicTask(task),
    });
  }

  /** @param {any} input */
  async claimHandoff(input) {
    this.#humanActor(input);
    const handoff = this.#handoff(
      input.handoffId,
      input.expectedHandoffVersion,
    );
    const user = this.#user(input.actor.id);
    const conversation = this.#conversations.get(handoff.conversationId);
    if (
      handoff.status !== 'pending' ||
      handoff.assignedUserId !== null ||
      !conversation ||
      conversation.terminalAt ||
      conversation.automationState !== 'human'
    ) {
      throw new WorkConflictError('Handoff was already claimed');
    }
    if (user.functionName !== handoff.targetRole) {
      throw new WorkForbiddenError();
    }
    conversation.assignedUserId = user.id;
    conversation.state = 'em_atendimento';
    conversation.updatedAt = input.occurredAt;
    conversation.version += 1;
    const previous = handoff.status;
    handoff.assignedUserId = user.id;
    handoff.status = 'accepted';
    handoff.updatedAt = input.occurredAt;
    handoff.version += 1;
    this.#handoffHistory.push(
      history(handoff, previous, handoff.status, input),
    );
    return freeze({
      conversation: publicConversation(conversation),
      handoff: publicHandoff(handoff),
    });
  }

  listTasks() {
    return freeze([...this.#tasks.values()].map(publicTask));
  }

  listAssignmentHistory() {
    return freeze(this.#assignmentHistory);
  }

  snapshot() {
    return structuredClone({
      assignments: this.#assignmentHistory,
      conversations: [...this.#conversations.values()],
      deals: [...this.#deals.values()],
      handoffs: [...this.#handoffs.values()],
      handoffHistory: this.#handoffHistory,
      tasks: [...this.#tasks.values()],
      taskHistory: this.#taskHistory,
    });
  }

  /** @param {any} deal @param {any} user @param {any} input */
  #assign(deal, user, input) {
    const previous = deal.assignedUserId ?? null;
    deal.assignedUserId = user.id;
    deal.version += 1;
    deal.updatedAt = input.occurredAt;
    this.#assignmentHistory.push({
      actorId: input.actor.id,
      assignedUserId: user.id,
      correlationId: input.correlationId,
      dealId: deal.id,
      previousUserId: previous,
      reasonCode: input.reasonCode,
      resultingVersion: deal.version,
      occurredAt: input.occurredAt,
    });
  }

  /** @param {string} id @param {number} version */
  #deal(id, version) {
    const value = this.#deals.get(id);
    if (!value || value.version !== version)
      throw new WorkConflictError('Deal version conflicts');
    return value;
  }

  /** @param {string} id @param {number} version */
  #conversation(id, version) {
    const value = this.#conversations.get(id);
    if (!value || value.version !== version) {
      throw new WorkConflictError('Conversation version conflicts');
    }
    return value;
  }

  /** @param {string} id */
  #user(id) {
    const value = this.#users.get(id);
    if (
      !value ||
      value.disabledAt ||
      value.functionName !== 'Vendedor'
    ) {
      throw new WorkValidationError('Assignee is unavailable');
    }
    return value;
  }

  /** @param {any} input */
  #humanActor(input) {
    if (input.actor.kind === 'human') this.#user(input.actor.id);
  }

  /** @param {string} id @param {number} version */
  #task(id, version) {
    const value = this.#tasks.get(id);
    if (!value || value.version !== version)
      throw new WorkConflictError('Task version conflicts');
    return value;
  }

  /** @param {string} id @param {number} version */
  #handoff(id, version) {
    const value = this.#handoffs.get(id);
    if (!value || value.version !== version) {
      throw new WorkConflictError('Handoff version conflicts');
    }
    return value;
  }
}

/** @param {any} value */
function publicDeal(value) {
  return cloneWithout(value, []);
}

/** @param {any} value */
function publicConversation(value) {
  return cloneWithout(value, ['contactId', 'terminalAt', 'updatedAt']);
}

/** @param {any} value */
function publicTask(value) {
  return cloneWithout(value, ['textEnvelope']);
}

/** @param {any} value */
function publicHandoff(value) {
  return cloneWithout(value, ['summaryEnvelope']);
}

/** @param {any} value @param {string[]} fields */
function cloneWithout(value, fields) {
  const clone = structuredClone(value);
  for (const field of fields) delete clone[field];
  return clone;
}

/** @param {any} entity @param {string|null} fromStatus @param {string} toStatus @param {any} input */
function history(entity, fromStatus, toStatus, input) {
  return {
    actorId: input.actor.id,
    correlationId: input.correlationId,
    entityId: entity.id,
    fromStatus,
    occurredAt: input.occurredAt,
    resultingVersion: entity.version,
    toStatus,
  };
}

/** @param {any} value @returns {any} */
function freeze(value) {
  return deepFreeze(structuredClone(value));
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
