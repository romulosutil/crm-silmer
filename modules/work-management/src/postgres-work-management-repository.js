import { randomUUID } from 'node:crypto';

import {
  WorkConflictError,
  WorkForbiddenError,
  WorkValidationError,
} from './errors.js';

export class PostgresWorkManagementRepository {
  /** @param {{dealPort: any, conversationPort: any, userPort: any, idFactory?: (kind: string) => string}} input */
  constructor({ dealPort, conversationPort, userPort, idFactory }) {
    for (const [port, method, name] of [
      [dealPort, 'lock', 'dealPort'],
      [dealPort, 'assign', 'dealPort'],
      [dealPort, 'touch', 'dealPort'],
      [conversationPort, 'lock', 'conversationPort'],
      [conversationPort, 'assignHuman', 'conversationPort'],
      [userPort, 'lockActive', 'userPort'],
    ]) {
      if (!port || typeof port[method] !== 'function') {
        throw new TypeError(`${name} must implement ${method}`);
      }
    }
    this.dealPort = dealPort;
    this.conversationPort = conversationPort;
    this.userPort = userPort;
    this.idFactory = idFactory ?? ((kind) => `${kind}-${randomUUID()}`);
  }

  /** @param {any} input @param {any} context */
  async assignDeal(input, context) {
    const deal = await this.dealPort.lock(
      { dealId: input.dealId, expectedVersion: input.expectedDealVersion },
      context,
    );
    await this.#activeHumanActor(input, context);
    const user = await this.#activeUser(input.assignedUserId, context);
    const changed = await this.dealPort.assign(
      {
        actorId: input.actor.id,
        assignedUserId: user.id,
        correlationId: input.correlationId,
        deal,
        occurredAt: input.occurredAt,
        reasonCode: input.reasonCode,
      },
      context,
    );
    return freeze({ deal: changed });
  }

  /** @param {any} input @param {any} context */
  async createTask(input, context) {
    const database = queryable(context);
    const deal = await this.dealPort.lock(
      { dealId: input.dealId, expectedVersion: input.expectedDealVersion },
      context,
    );
    await this.#activeHumanActor(input, context);
    const user = await this.#activeUser(input.assignedUserId, context);
    const changed = await this.dealPort.touch(
      { deal, occurredAt: input.occurredAt },
      context,
    );
    const taskId = this.idFactory('task');
    const task = mapTask(
      (
        await database.query(
          `INSERT INTO crm.tasks
             (id, deal_id, conversation_id, handoff_id, assigned_user_id,
              task_type, status, version, due_at, text_envelope,
              created_at, updated_at)
           VALUES ($1, $2, NULL, NULL, $3, 'follow_up', 'pending', 1,
                   $4, $5::jsonb, $6, $6)
           RETURNING *`,
          [
            taskId,
            deal.id,
            user.id,
            input.dueAt,
            JSON.stringify(input.textEnvelope),
            input.occurredAt,
          ],
        )
      ).rows[0],
    );
    await this.#appendTaskHistory(database, task, null, input);
    return freeze({ deal: changed, task });
  }

  /** @param {any} input @param {any} context */
  async updateTask(input, context) {
    const database = queryable(context);
    await this.#activeUser(input.actor.id, context);
    const result = await database.query(
      'SELECT * FROM crm.tasks WHERE id = $1 FOR UPDATE',
      [input.taskId],
    );
    const task = mapTask(result.rows[0]);
    if (task.version !== input.expectedTaskVersion) {
      throw new WorkConflictError('Task version conflicts');
    }
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
    const changed = mapTask(
      (
        await database.query(
          `UPDATE crm.tasks
           SET status = $3, version = version + 1, updated_at = $4,
               completed_at = CASE WHEN $3 = 'completed' THEN $4 ELSE NULL END
           WHERE id = $1 AND version = $2
           RETURNING *`,
          [task.id, task.version, transition.to, input.occurredAt],
        )
      ).rows[0],
    );
    await this.#appendTaskHistory(database, changed, task.status, input);
    return freeze({ task: changed });
  }

  /** @param {any} input @param {any} context */
  async createHandoff(input, context) {
    const database = queryable(context);
    const deal = await this.dealPort.lock(
      { dealId: input.dealId, expectedVersion: input.expectedDealVersion },
      context,
    );
    if (deal.status !== 'active')
      throw new WorkConflictError('Deal is not active');
    const conversation = await this.conversationPort.lock(
      {
        automationEpoch: input.automationEpoch,
        contactId: deal.contactId,
        conversationId: input.conversationId,
        expectedVersion: input.expectedConversationVersion,
        requireAutomationFence: input.actor.kind === 'AUTOMATION_EXECUTOR',
      },
      context,
    );
    await this.#activeHumanActor(input, context);
    const user = await this.#activeUser(input.assignedUserId, context);
    if (input.commercialReason && user.functionName !== 'Vendedor') {
      throw new WorkValidationError('Commercial handoffs require a Vendedor');
    }
    const active = await database.query(
      `SELECT id FROM crm.handoffs
       WHERE status IN ('pending', 'accepted')
         AND (deal_id = $1 OR conversation_id = $2)
       FOR UPDATE`,
      [deal.id, conversation.id],
    );
    if (active.rows.length > 0)
      throw new WorkConflictError('Active handoff exists');

    const changedDeal = await this.dealPort.assign(
      {
        actorId: input.actor.id,
        assignedUserId: user.id,
        correlationId: input.correlationId,
        deal,
        occurredAt: input.occurredAt,
        reasonCode: input.reasonCode,
      },
      context,
    );
    const changedConversation = await this.conversationPort.assignHuman(
      {
        assignedUserId: user.id,
        conversation,
        incrementEpoch: true,
        occurredAt: input.occurredAt,
      },
      context,
    );
    const handoffId = this.idFactory('handoff');
    const handoff = mapHandoff(
      (
        await database.query(
          `INSERT INTO crm.handoffs
             (id, deal_id, conversation_id, assigned_user_id, target_role,
              status, version,
              reason_code, summary_envelope, due_at, sla_minutes,
              sla_policy_version, automation_workflow_key,
              automation_workflow_version, automation_execution_id,
              created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', 1, $6, $7::jsonb, $8, $9,
                   $10, $11, $12, $13, $14, $14)
           RETURNING *`,
          [
            handoffId,
            deal.id,
            conversation.id,
            user.id,
            user.functionName,
            input.reasonCode,
            JSON.stringify(input.summaryEnvelope),
            input.dueAt,
            input.slaMinutes,
            input.slaPolicyVersion,
            input.automationContext?.workflowKey ?? null,
            input.automationContext?.workflowVersion ?? null,
            input.automationContext?.executionId ?? null,
            input.occurredAt,
          ],
        )
      ).rows[0],
    );
    const task = mapTask(
      (
        await database.query(
          `INSERT INTO crm.tasks
             (id, deal_id, conversation_id, handoff_id, assigned_user_id,
              task_type, status, version, due_at, text_envelope,
              created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'human_handoff', 'pending', 1,
                   $6, $7::jsonb, $8, $8)
           RETURNING *`,
          [
            this.idFactory('task'),
            deal.id,
            conversation.id,
            handoff.id,
            user.id,
            input.dueAt,
            JSON.stringify(input.taskTextEnvelope),
            input.occurredAt,
          ],
        )
      ).rows[0],
    );
    await this.#appendHandoffHistory(database, handoff, null, input);
    await this.#appendTaskHistory(database, task, null, input);
    return freeze({
      conversation: changedConversation,
      deal: changedDeal,
      handoff,
      task,
    });
  }

  /** @param {any} input @param {any} context */
  async claimHandoff(input, context) {
    const database = queryable(context);
    const locator = (
      await database.query(
        'SELECT conversation_id FROM crm.handoffs WHERE id = $1',
        [input.handoffId],
      )
    ).rows[0];
    if (!locator) throw new WorkConflictError('Handoff was not found');
    const conversation = (
      await database.query(
        `SELECT * FROM crm.conversations WHERE id = $1 FOR UPDATE`,
        [locator.conversation_id],
      )
    ).rows[0];
    if (!conversation)
      throw new WorkConflictError('Conversation was not found');
    const user = await this.#activeUser(input.actor.id, context);
    const handoff = mapHandoff(
      (
        await database.query(
          'SELECT * FROM crm.handoffs WHERE id = $1 FOR UPDATE',
          [input.handoffId],
        )
      ).rows[0],
    );
    if (
      handoff.version !== input.expectedHandoffVersion ||
      handoff.status !== 'pending' ||
      handoff.assignedUserId !== null
    ) {
      throw new WorkConflictError('Handoff was already claimed');
    }
    if (user.functionName !== handoff.targetRole) {
      throw new WorkForbiddenError();
    }
    if (conversation.automation_state !== 'human' || conversation.terminal_at) {
      throw new WorkConflictError('Conversation is not awaiting a human');
    }
    const changedConversation = (
      await database.query(
        `UPDATE crm.conversations
         SET assigned_user_id = $2, state = 'em_atendimento',
             version = version + 1
         WHERE id = $1 AND automation_state = 'human'
           AND terminal_at IS NULL
         RETURNING id, automation_state, automation_epoch, assigned_user_id,
                   state, version, terminal_at`,
        [handoff.conversationId, user.id],
      )
    ).rows[0];
    if (!changedConversation) throw new WorkConflictError();
    const changedHandoff = mapHandoff(
      (
        await database.query(
          `UPDATE crm.handoffs
           SET assigned_user_id = $3, status = 'accepted',
               version = version + 1, updated_at = $4
           WHERE id = $1 AND version = $2 AND status = 'pending'
             AND assigned_user_id IS NULL
           RETURNING *`,
          [handoff.id, handoff.version, user.id, input.occurredAt],
        )
      ).rows[0],
    );
    await this.#appendHandoffHistory(
      database,
      changedHandoff,
      handoff.status,
      input,
    );
    return freeze({
      conversation: {
        assignedUserId: changedConversation.assigned_user_id,
        automationEpoch: Number(changedConversation.automation_epoch),
        automationState: changedConversation.automation_state,
        id: changedConversation.id,
        state: changedConversation.state,
        terminalAt: null,
        version: Number(changedConversation.version),
      },
      handoff: changedHandoff,
    });
  }

  /** @param {any} input @param {any} context */
  async updateHandoff(input, context) {
    const database = queryable(context);
    const locator = await database.query(
      'SELECT deal_id, conversation_id FROM crm.handoffs WHERE id = $1',
      [input.handoffId],
    );
    if (!locator.rows[0]) throw new WorkConflictError('Handoff was not found');
    const deal = await this.dealPort.lock(
      {
        dealId: locator.rows[0].deal_id,
        expectedVersion: input.expectedDealVersion,
      },
      context,
    );
    const conversation = await this.conversationPort.lock(
      {
        contactId: deal.contactId,
        conversationId: locator.rows[0].conversation_id,
        expectedVersion: input.expectedConversationVersion,
      },
      context,
    );
    await this.#activeUser(input.actor.id, context);
    const transferTarget =
      input.action === 'transfer'
        ? await this.#activeUser(input.assignedUserId, context)
        : null;
    const handoff = mapHandoff(
      (
        await database.query(
          'SELECT * FROM crm.handoffs WHERE id = $1 FOR UPDATE',
          [input.handoffId],
        )
      ).rows[0],
    );
    const task = mapTask(
      (
        await database.query(
          'SELECT * FROM crm.tasks WHERE handoff_id = $1 FOR UPDATE',
          [handoff.id],
        )
      ).rows[0],
    );
    if (
      handoff.version !== input.expectedHandoffVersion ||
      task.version !== input.expectedTaskVersion
    ) {
      throw new WorkConflictError('Handoff or task version conflicts');
    }
    if (handoff.assignedUserId !== input.actor.id) {
      throw new WorkConflictError('Handoff belongs to another assignee');
    }
    if (conversation.automationState !== 'human') {
      throw new WorkConflictError('Conversation automation state changed');
    }

    let changedDeal = deal;
    let changedConversation = conversation;
    let assignedUserId = handoff.assignedUserId;
    let handoffStatus = handoff.status;
    let taskStatus = task.status;
    if (input.action === 'accept') {
      if (handoff.status !== 'pending' || task.status !== 'pending') {
        throw new WorkConflictError('Handoff cannot be accepted');
      }
      handoffStatus = 'accepted';
      taskStatus = 'in_progress';
    } else if (input.action === 'transfer') {
      if (!['pending', 'accepted'].includes(handoff.status)) {
        throw new WorkConflictError('Handoff cannot be transferred');
      }
      const target = transferTarget;
      if (!target) throw new WorkValidationError('Assignee is unavailable');
      if (
        handoff.reasonCode === 'price_before_quote' &&
        target.functionName !== 'Vendedor'
      ) {
        throw new WorkValidationError('Commercial handoffs require a Vendedor');
      }
      assignedUserId = target.id;
      changedDeal = await this.dealPort.assign(
        {
          actorId: input.actor.id,
          assignedUserId,
          correlationId: input.correlationId,
          deal,
          occurredAt: input.occurredAt,
          reasonCode: input.reasonCode,
        },
        context,
      );
      changedConversation = await this.conversationPort.assignHuman(
        {
          assignedUserId,
          conversation,
          incrementEpoch: false,
          occurredAt: input.occurredAt,
        },
        context,
      );
    } else {
      if (!['pending', 'accepted'].includes(handoff.status)) {
        throw new WorkConflictError('Handoff cannot be resolved');
      }
      handoffStatus = 'resolved';
      taskStatus = 'completed';
    }

    const changedHandoff = mapHandoff(
      (
        await database.query(
          `UPDATE crm.handoffs
           SET status = $3, assigned_user_id = $4, version = version + 1,
               updated_at = $5,
               resolved_at = CASE WHEN $3 = 'resolved' THEN $5 ELSE NULL END
           WHERE id = $1 AND version = $2 RETURNING *`,
          [
            handoff.id,
            handoff.version,
            handoffStatus,
            assignedUserId,
            input.occurredAt,
          ],
        )
      ).rows[0],
    );
    const changedTask = mapTask(
      (
        await database.query(
          `UPDATE crm.tasks
           SET status = $3, assigned_user_id = $4, version = version + 1,
               updated_at = $5,
               completed_at = CASE WHEN $3 = 'completed' THEN $5 ELSE NULL END
           WHERE id = $1 AND version = $2 RETURNING *`,
          [task.id, task.version, taskStatus, assignedUserId, input.occurredAt],
        )
      ).rows[0],
    );
    await this.#appendHandoffHistory(
      database,
      changedHandoff,
      handoff.status,
      input,
    );
    await this.#appendTaskHistory(database, changedTask, task.status, input);
    return freeze({
      conversation: changedConversation,
      deal: changedDeal,
      handoff: changedHandoff,
      task: changedTask,
    });
  }

  /** @param {string} userId @param {any} context */
  async #activeUser(userId, context) {
    const user = await this.userPort.lockActive({ userId }, context);
    if (!user) throw new WorkValidationError('Assignee is unavailable');
    return user;
  }

  /** @param {any} input @param {any} context */
  async #activeHumanActor(input, context) {
    if (input.actor.kind === 'human')
      await this.#activeUser(input.actor.id, context);
  }

  /** @param {any} database @param {any} task @param {string|null} fromStatus @param {any} input */
  async #appendTaskHistory(database, task, fromStatus, input) {
    await database.query(
      `INSERT INTO crm.task_history
         (task_id, resulting_version, from_status, to_status, actor_id,
          reason_code, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        task.id,
        task.version,
        fromStatus,
        task.status,
        input.actor.id,
        input.reasonCode,
        input.correlationId,
        input.occurredAt,
      ],
    );
  }

  /** @param {any} database @param {any} handoff @param {string|null} fromStatus @param {any} input */
  async #appendHandoffHistory(database, handoff, fromStatus, input) {
    await database.query(
      `INSERT INTO crm.handoff_history
         (handoff_id, resulting_version, from_status, to_status,
          assigned_user_id, target_role, actor_id, reason_code, correlation_id,
          occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        handoff.id,
        handoff.version,
        fromStatus,
        handoff.status,
        handoff.assignedUserId,
        handoff.targetRole,
        input.actor.id,
        input.reasonCode,
        input.correlationId,
        input.occurredAt,
      ],
    );
  }
}

/** @param {any} context */
function queryable(context) {
  if (
    !context?.transaction ||
    typeof context.transaction.query !== 'function'
  ) {
    throw new TypeError('context.transaction must implement query');
  }
  return context.transaction;
}

/** @param {any} row */
function mapTask(row) {
  if (!row) throw new WorkConflictError('Stored task was not found');
  return Object.freeze({
    assignedUserId: row.assigned_user_id,
    createdAt: iso(row.created_at),
    dealId: row.deal_id,
    dueAt: iso(row.due_at),
    handoffId: row.handoff_id,
    id: row.id,
    status: row.status,
    type: row.task_type,
    updatedAt: iso(row.updated_at),
    version: Number(row.version),
  });
}

/** @param {any} row */
function mapHandoff(row) {
  if (!row) throw new WorkConflictError('Stored handoff was not found');
  return Object.freeze({
    assignedUserId: row.assigned_user_id,
    conversationId: row.conversation_id,
    createdAt: iso(row.created_at),
    dealId: row.deal_id,
    dueAt: iso(row.due_at),
    id: row.id,
    reasonCode: row.reason_code,
    targetRole: row.target_role,
    slaMinutes: Number(row.sla_minutes),
    slaPolicyVersion: row.sla_policy_version,
    status: row.status,
    updatedAt: iso(row.updated_at),
    version: Number(row.version),
  });
}

/** @param {any} value */
function iso(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
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
