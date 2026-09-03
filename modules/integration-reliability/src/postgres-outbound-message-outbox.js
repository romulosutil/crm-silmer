/**
 * @typedef {{query: (sql: string, values?: unknown[]) => Promise<{rows: any[]}>}} Queryable
 */

export class PostgresOutboundMessageOutbox {
  /**
   * @param {{id: string, idempotencyKey: string, messageId: string, availableAt: string|Date}} input
   * @param {{transaction?: Queryable}} [context]
   */
  async enqueueChannelMessage(input, context = {}) {
    if (
      !context.transaction ||
      typeof context.transaction.query !== 'function'
    ) {
      throw new TypeError('A queryable transaction is required');
    }
    await context.transaction.query(
      `INSERT INTO crm.outbox_jobs
         (id, job_type, idempotency_key, channel_event_id, status, priority,
          available_at, created_at, transient_media_id, queue, attempt_count,
          max_attempts, updated_at, effect_policy, message_id)
       VALUES ($1, 'channel_message.send', $2, NULL, 'pending', 100, $3, $3,
               NULL, 'channel-outbound', 0, 8, $3, 'manual', $4)`,
      [input.id, input.idempotencyKey, input.availableAt, input.messageId],
    );
  }
}
