class DealRequestError extends Error {
  /** @param {number} statusCode @param {string} code */
  constructor(statusCode, code) {
    super(code);
    this.name = 'DealRequestError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * @param {import('fastify').FastifyInstance} api
 * @param {Record<string, any>} deals
 * @param {(request: object) => {correlationId: string}} contextFor
 */
export function registerDealRoutes(api, deals, contextFor) {
  api.get('/api/v1/kanban', async (request, reply) => {
    return respond(reply, async () => {
      await authorizeDealRead(request, deals, 'kanban.read');
      const query = readQuery(request.query, [
        'assignedUserId',
        'hasOverdueTask',
        'limit',
      ]);
      privateReadHeaders(reply);
      return reply
        .code(200)
        .send(await deals.getKanbanBoard(parseKanbanFilters(query)));
    });
  });

  api.get('/api/v1/kanban/cards', async (request, reply) => {
    return respond(reply, async () => {
      await authorizeDealRead(request, deals, 'kanban.read');
      const query = readQuery(request.query, [
        'assignedUserId',
        'cursor',
        'hasOverdueTask',
        'limit',
        'stage',
      ]);
      privateReadHeaders(reply);
      return reply.code(200).send(
        await deals.getKanbanColumn({
          ...parseKanbanFilters(query),
          ...(query.cursor === undefined
            ? {}
            : { cursor: requireString(query.cursor, 'CURSOR') }),
          stage: requireString(query.stage, 'STAGE'),
        }),
      );
    });
  });

  api.get('/api/v1/deals/:dealId', async (request, reply) => {
    return respond(reply, async () => {
      await authorizeDealRead(request, deals, 'deal.read');
      const params = requireObject(request.params);
      privateReadHeaders(reply);
      const result = await deals.getDealDetail({
        dealId: requireString(params.dealId, 'DEAL_ID'),
        ...(typeof request.headers['if-none-match'] === 'string'
          ? { ifNoneMatch: request.headers['if-none-match'] }
          : {}),
      });
      reply.header('etag', result.etag);
      return result.notModified
        ? reply.code(304).send()
        : reply.code(200).send(result.detail);
    });
  });

  api.get('/api/v1/events', async (request, reply) => {
    const query = readQuery(request.query, ['after', 'topic']);
    await authorizeDealRead(request, deals, 'deal.events.read');
    const topic =
      query.topic === undefined
        ? 'kanban'
        : requireString(query.topic, 'TOPIC');
    const headerCursor = request.headers['last-event-id'];
    const queryCursor = query.after;
    let cursor =
      headerCursor !== undefined &&
      queryCursor !== undefined &&
      String(headerCursor) !== String(queryCursor)
        ? 'invalid'
        : (headerCursor ?? queryCursor ?? 0);
    let closed = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let pollTimer;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let heartbeatTimer;
    reply.hijack();
    reply.raw.writeHead(200, {
      'cache-control': 'private, no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      vary: 'Origin, Cookie',
      'x-accel-buffering': 'no',
    });
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
    };
    request.raw.on('close', cleanup);
    reply.raw.on('close', cleanup);
    const heartbeat = () => {
      if (!closed && !reply.raw.write(': heartbeat\n\n')) {
        cleanup();
        reply.raw.end();
        return;
      }
      if (!closed) heartbeatTimer = setTimeout(heartbeat, 15_000);
    };
    heartbeatTimer = setTimeout(heartbeat, 15_000);
    heartbeatTimer.unref?.();
    const poll = async () => {
      try {
        await authorizeDealRead(request, deals, 'deal.events.read');
        const batch = await deals.readDealEvents({
          after: cursor,
          limit: 100,
          topic,
        });
        if (batch.reset) {
          cursor = batch.cursor;
          if (
            !writeSse(reply.raw, {
              cursor: batch.cursor,
              payload: { cursor: batch.cursor, reason: batch.reset.reason },
              type: 'stream.reset',
            })
          ) {
            cleanup();
            reply.raw.end();
            return;
          }
        } else {
          for (const event of batch.events) {
            if (!writeSse(reply.raw, event)) {
              cleanup();
              reply.raw.end();
              return;
            }
          }
          cursor = batch.cursor;
        }
        if (!closed) {
          pollTimer = setTimeout(poll, 1_000);
          pollTimer.unref?.();
        }
      } catch {
        if (!closed) {
          writeSse(reply.raw, {
            cursor: Number.isSafeInteger(Number(cursor)) ? Number(cursor) : 0,
            payload: { reason: 'authorization_revoked' },
            type: 'stream.reset',
          });
          reply.raw.end();
        }
        cleanup();
      }
    };
    await poll();
    return reply;
  });

  api.post(
    '/api/v1/conversations/:conversationId/convert',
    async (request, reply) => {
      return respond(reply, async () => {
        const params = requireObject(request.params);
        const body = requireObject(request.body);
        rejectUnknownKeys(body, [
          'automationEpoch',
          'expectedVersion',
          'reason',
        ]);
        const conversationId = requireString(
          params.conversationId,
          'CONVERSATION_ID',
        );
        const correlationId = contextFor(request).correlationId;
        const idempotencyKey = requireString(
          request.headers['idempotency-key'],
          'IDEMPOTENCY_KEY',
        );
        const principal = await deals.authorize({
          action: 'conversation.convert',
          authorization: request.headers.authorization,
          cookie: request.headers.cookie,
          correlationId,
          csrfToken: request.headers['x-csrf-token'],
          origin: request.headers.origin,
        });
        const result = await deals.convertConversation({
          actor: principal.actor,
          ...(body.automationEpoch === undefined
            ? {}
            : {
                automationEpoch: requireAutomationEpoch(body.automationEpoch),
              }),
          conversationId,
          correlationId,
          expectedVersion: requireVersion(body.expectedVersion),
          idempotencyKey,
          reason: requireString(body.reason, 'REASON'),
        });
        reply.header('location', `/api/v1/deals/${result.deal.id}`);
        return reply.code(201).send(result);
      });
    },
  );

  api.post('/api/v1/deals/:dealId/transitions', async (request, reply) => {
    return respond(reply, async () => {
      const params = requireObject(request.params);
      const body = requireObject(request.body);
      rejectUnknownKeys(body, [
        'automationEpoch',
        'conversationId',
        'direction',
        'expectedVersion',
        'reason',
      ]);
      const command = await authorizeDealCommand(
        request,
        deals,
        contextFor,
        'deal.transition',
      );
      const result = await deals.transitionDeal({
        ...command,
        ...(body.automationEpoch === undefined
          ? {}
          : { automationEpoch: requireAutomationEpoch(body.automationEpoch) }),
        ...(body.conversationId === undefined
          ? {}
          : {
              conversationId: requireString(
                body.conversationId,
                'CONVERSATION_ID',
              ),
            }),
        dealId: requireString(params.dealId, 'DEAL_ID'),
        direction: requireDirection(body.direction),
        expectedVersion: requireVersion(body.expectedVersion),
        reason: requireString(body.reason, 'REASON'),
      });
      return reply.code(200).send(result);
    });
  });

  api.post('/api/v1/deals/:dealId/lose', async (request, reply) => {
    return respond(reply, async () => {
      const params = requireObject(request.params);
      const body = requireObject(request.body);
      rejectUnknownKeys(body, ['expectedVersion', 'reason']);
      const command = await authorizeDealCommand(
        request,
        deals,
        contextFor,
        'deal.lose',
      );
      const result = await deals.loseDeal({
        ...command,
        dealId: requireString(params.dealId, 'DEAL_ID'),
        expectedVersion: requireVersion(body.expectedVersion),
        reason: requireString(body.reason, 'REASON'),
      });
      return reply.code(200).send(result);
    });
  });

  api.patch('/api/v1/deals/:dealId/fields', async (request, reply) => {
    return respond(reply, async () => {
      const params = requireObject(request.params);
      const body = requireObject(request.body);
      rejectUnknownKeys(body, [
        'automationEpoch',
        'conversationId',
        'expectedVersion',
        'fields',
        'reasonCode',
        'reasonDetail',
      ]);
      const command = await authorizeDealCommand(
        request,
        deals,
        contextFor,
        'deal.fields.patch',
      );
      const result = await deals.patchFields({
        ...command,
        ...(body.automationEpoch === undefined
          ? {}
          : { automationEpoch: requireAutomationEpoch(body.automationEpoch) }),
        ...(body.conversationId === undefined
          ? {}
          : {
              conversationId: requireString(
                body.conversationId,
                'CONVERSATION_ID',
              ),
            }),
        dealId: requireString(params.dealId, 'DEAL_ID'),
        expectedVersion: requireVersion(body.expectedVersion),
        fields: requireObject(body.fields),
        reasonCode: requireString(body.reasonCode, 'REASON_CODE'),
        ...(body.reasonDetail === undefined
          ? {}
          : {
              reasonDetail: requireString(body.reasonDetail, 'REASON_DETAIL'),
            }),
      });
      return reply.code(200).send(result);
    });
  });

  api.post('/api/v1/deals/:dealId/assign', async (request, reply) => {
    return respond(reply, async () => {
      const params = requireObject(request.params);
      const body = requireObject(request.body);
      rejectUnknownKeys(body, [
        'assignedUserId',
        'expectedDealVersion',
        'reasonCode',
      ]);
      const command = await authorizeDealCommand(
        request,
        deals,
        contextFor,
        'deal.assign',
      );
      return reply.code(200).send(
        await deals.assignDeal({
          ...command,
          assignedUserId: requireString(
            body.assignedUserId,
            'ASSIGNED_USER_ID',
          ),
          dealId: requireString(params.dealId, 'DEAL_ID'),
          expectedDealVersion: requireVersion(body.expectedDealVersion),
          reasonCode: requireString(body.reasonCode, 'REASON_CODE'),
        }),
      );
    });
  });

  api.post('/api/v1/deals/:dealId/tasks', async (request, reply) => {
    return respond(reply, async () => {
      const params = requireObject(request.params);
      const body = requireObject(request.body);
      rejectUnknownKeys(body, [
        'assignedUserId',
        'dueAt',
        'expectedDealVersion',
        'reasonCode',
        'text',
        'type',
      ]);
      const command = await authorizeDealCommand(
        request,
        deals,
        contextFor,
        'task.create',
      );
      const result = await deals.createTask({
        ...command,
        assignedUserId: requireString(body.assignedUserId, 'ASSIGNED_USER_ID'),
        dealId: requireString(params.dealId, 'DEAL_ID'),
        dueAt: requireString(body.dueAt, 'DUE_AT'),
        expectedDealVersion: requireVersion(body.expectedDealVersion),
        reasonCode: requireString(body.reasonCode, 'REASON_CODE'),
        text: requireString(body.text, 'TEXT'),
        type: requireString(body.type, 'TYPE'),
      });
      reply.header('location', `/api/v1/tasks/${result.task.id}`);
      return reply.code(201).send(result);
    });
  });

  for (const [path, action, method] of [
    ['start', 'task.start', 'startTask'],
    ['complete', 'task.complete', 'completeTask'],
    ['cancel', 'task.cancel', 'cancelTask'],
  ]) {
    api.post(`/api/v1/tasks/:taskId/${path}`, async (request, reply) => {
      return respond(reply, async () => {
        const params = requireObject(request.params);
        const body = requireObject(request.body);
        rejectUnknownKeys(body, ['expectedTaskVersion', 'reasonCode']);
        const command = await authorizeDealCommand(
          request,
          deals,
          contextFor,
          action,
        );
        return reply.code(200).send(
          await deals[method]({
            ...command,
            expectedTaskVersion: requireVersion(body.expectedTaskVersion),
            reasonCode: requireString(body.reasonCode, 'REASON_CODE'),
            taskId: requireString(params.taskId, 'TASK_ID'),
          }),
        );
      });
    });
  }

  api.post('/api/v1/deals/:dealId/handoffs', async (request, reply) => {
    return respond(reply, async () => {
      const params = requireObject(request.params);
      const body = requireObject(request.body);
      rejectUnknownKeys(body, [
        'assignedUserId',
        'automationContext',
        'automationEpoch',
        'conversationId',
        'expectedConversationVersion',
        'expectedDealVersion',
        'reasonCode',
        'summary',
      ]);
      const command = await authorizeDealCommand(
        request,
        deals,
        contextFor,
        'handoff.create',
      );
      const result = await deals.createHandoff({
        ...command,
        assignedUserId: requireString(body.assignedUserId, 'ASSIGNED_USER_ID'),
        ...(body.automationContext === undefined
          ? {}
          : {
              automationContext: requireAutomationContext(
                body.automationContext,
              ),
            }),
        ...(body.automationEpoch === undefined
          ? {}
          : { automationEpoch: requireAutomationEpoch(body.automationEpoch) }),
        conversationId: requireString(body.conversationId, 'CONVERSATION_ID'),
        dealId: requireString(params.dealId, 'DEAL_ID'),
        expectedConversationVersion: requireVersion(
          body.expectedConversationVersion,
        ),
        expectedDealVersion: requireVersion(body.expectedDealVersion),
        reasonCode: requireString(body.reasonCode, 'REASON_CODE'),
        summary: requireString(body.summary, 'SUMMARY'),
      });
      reply.header('location', `/api/v1/handoffs/${result.handoff.id}`);
      return reply.code(201).send(result);
    });
  });

  for (const [path, action, method] of [
    ['accept', 'handoff.accept', 'acceptHandoff'],
    ['transfer', 'handoff.transfer', 'transferHandoff'],
    ['resolve', 'handoff.resolve', 'resolveHandoff'],
  ]) {
    api.post(`/api/v1/handoffs/:handoffId/${path}`, async (request, reply) => {
      return respond(reply, async () => {
        const params = requireObject(request.params);
        const body = requireObject(request.body);
        rejectUnknownKeys(body, [
          'assignedUserId',
          'expectedConversationVersion',
          'expectedDealVersion',
          'expectedHandoffVersion',
          'expectedTaskVersion',
          'reasonCode',
        ]);
        const command = await authorizeDealCommand(
          request,
          deals,
          contextFor,
          action,
        );
        return reply.code(200).send(
          await deals[method]({
            ...command,
            ...(body.assignedUserId === undefined
              ? {}
              : {
                  assignedUserId: requireString(
                    body.assignedUserId,
                    'ASSIGNED_USER_ID',
                  ),
                }),
            expectedConversationVersion: requireVersion(
              body.expectedConversationVersion,
            ),
            expectedDealVersion: requireVersion(body.expectedDealVersion),
            expectedHandoffVersion: requireVersion(body.expectedHandoffVersion),
            expectedTaskVersion: requireVersion(body.expectedTaskVersion),
            handoffId: requireString(params.handoffId, 'HANDOFF_ID'),
            reasonCode: requireString(body.reasonCode, 'REASON_CODE'),
          }),
        );
      });
    });
  }
}

/** @param {any} request @param {any} deals @param {Function} contextFor @param {string} action */
async function authorizeDealCommand(request, deals, contextFor, action) {
  const correlationId = contextFor(request).correlationId;
  const idempotencyKey = requireString(
    request.headers['idempotency-key'],
    'IDEMPOTENCY_KEY',
  );
  const principal = await deals.authorize({
    action,
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    correlationId,
    csrfToken: request.headers['x-csrf-token'],
    origin: request.headers.origin,
  });
  return { actor: principal.actor, correlationId, idempotencyKey };
}

/** @param {import('fastify').FastifyReply} reply @param {() => Promise<unknown>} operation */
async function respond(reply, operation) {
  try {
    return await operation();
  } catch (error) {
    const normalized = /** @type {{code?: unknown, statusCode?: unknown}} */ (
      error
    );
    const statusCode = Number(normalized?.statusCode);
    if (statusCode >= 500 && statusCode < 600) {
      return reply
        .code(statusCode)
        .send({ error: { code: 'SERVICE_UNAVAILABLE' } });
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: { code: publicCode(error) },
      });
    }
    throw error;
  }
}

/** @param {any} error */
function publicCode(error) {
  const normalized = /** @type {{code?: unknown}} */ (error);
  const allowed = new Set([
    'DEAL_CONFLICT',
    'DEAL_FORBIDDEN',
    'DEAL_GATE_INCOMPLETE',
    'DEAL_INVALID',
    'DEAL_NOT_FOUND',
    'FORBIDDEN',
    'FORBIDDEN_AUTOMATION_ACTION',
    'IDEMPOTENCY_KEY_REUSED',
    'INVALID_AUTOMATION_CREDENTIALS',
    'INVALID_AUTOMATION_EPOCH',
    'INVALID_CONVERSATION_ID',
    'INVALID_DEAL_ID',
    'INVALID_DIRECTION',
    'INVALID_CURSOR',
    'INVALID_EXPECTED_VERSION',
    'INVALID_IDEMPOTENCY_KEY',
    'INVALID_FILTER',
    'INVALID_LIMIT',
    'INVALID_REASON',
    'INVALID_REQUEST',
    'INVALID_STAGE',
    'WORK_CONFLICT',
    'WORK_FORBIDDEN',
    'WORK_INVALID',
  ]);
  return allowed.has(String(normalized?.code))
    ? String(normalized.code)
    : 'INVALID_REQUEST';
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DealRequestError(400, 'INVALID_REQUEST');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} field */
function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DealRequestError(400, `INVALID_${field}`);
  }
  return value.trim();
}

/** @param {unknown} value */
function requireVersion(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new DealRequestError(400, 'INVALID_EXPECTED_VERSION');
  }
  return value;
}

/** @param {unknown} value */
function requireDirection(value) {
  if (!['advance', 'retreat'].includes(String(value))) {
    throw new DealRequestError(400, 'INVALID_DIRECTION');
  }
  return value;
}

/** @param {unknown} value */
function requireAutomationEpoch(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new DealRequestError(400, 'INVALID_AUTOMATION_EPOCH');
  }
  return value;
}

/** @param {unknown} value */
function requireAutomationContext(value) {
  const context = requireObject(value);
  rejectUnknownKeys(context, ['executionId', 'workflowKey', 'workflowVersion']);
  return {
    executionId: requireString(context.executionId, 'EXECUTION_ID'),
    workflowKey: requireString(context.workflowKey, 'WORKFLOW_KEY'),
    workflowVersion: requireString(context.workflowVersion, 'WORKFLOW_VERSION'),
  };
}

/** @param {Record<string, unknown>} value @param {string[]} allowed */
function rejectUnknownKeys(value, allowed) {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((key) => !accepted.has(key))) {
    throw new DealRequestError(400, 'INVALID_REQUEST');
  }
}

/** @param {any} request @param {any} deals @param {string} action */
async function authorizeDealRead(request, deals, action) {
  return deals.authorizeRead({
    action,
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    origin: request.headers.origin,
    secFetchSite: request.headers['sec-fetch-site'],
  });
}

/** @param {unknown} value @param {string[]} allowed */
function readQuery(value, allowed) {
  const query =
    value && typeof value === 'object' && !Array.isArray(value)
      ? /** @type {Record<string, unknown>} */ (value)
      : {};
  rejectUnknownKeys(query, allowed);
  return query;
}

/** @param {Record<string, unknown>} query */
function parseKanbanFilters(query) {
  const parsed = {};
  if (query.assignedUserId !== undefined)
    parsed.assignedUserId = requireString(
      query.assignedUserId,
      'ASSIGNED_USER_ID',
    );
  if (query.hasOverdueTask !== undefined) {
    if (!['true', 'false'].includes(String(query.hasOverdueTask)))
      throw new DealRequestError(400, 'INVALID_FILTER');
    parsed.hasOverdueTask = query.hasOverdueTask === 'true';
  }
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[0-9]+$/u.test(query.limit))
      throw new DealRequestError(400, 'INVALID_LIMIT');
    parsed.limit = Number(query.limit);
  }
  return parsed;
}

/** @param {import('fastify').FastifyReply} reply */
function privateReadHeaders(reply) {
  reply.header('cache-control', 'private, no-cache');
  reply.header('vary', 'Origin, Cookie');
}

/** @param {import('node:http').ServerResponse} stream @param {{cursor: number, payload?: unknown, type: string, [key: string]: unknown}} event */
function writeSse(stream, event) {
  return stream.write(formatDealSseEvent(event));
}

/** @param {{cursor: number, payload?: unknown, type: string, [key: string]: unknown}} event */
export function formatDealSseEvent(event) {
  const reset = event.type === 'stream.reset';
  const type = reset ? 'stream.reset' : 'kanban.card.changed';
  const payload = reset
    ? event.payload
    : {
        dealId: event.dealId,
        aggregateVersion: event.aggregateVersion,
        occurredAt: event.occurredAt,
        sourceType: event.type,
      };
  return `id: ${event.cursor}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}
