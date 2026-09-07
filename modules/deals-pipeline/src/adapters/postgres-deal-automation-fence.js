import { DealConflictError } from '../domain/errors.js';

export class PostgresDealAutomationFencePort {
  /** @param {any} input @param {any} context */
  async assertCurrent(input, context) {
    const transaction = context?.transaction;
    if (!transaction || typeof transaction.query !== 'function') {
      throw new TypeError('context.transaction must implement query');
    }
    const result = await transaction.query(
      `SELECT c.id
       FROM crm.deals d
       JOIN crm.conversations c ON c.id = $2
       JOIN crm.contact_identities ci ON ci.id = c.contact_identity_id
       WHERE d.id = $1
         AND ci.current_contact_id = d.contact_id
         AND c.terminal_at IS NULL
         AND c.automation_state = 'assistant'
         AND c.automation_epoch = $3
       FOR UPDATE OF c`,
      [input.dealId, input.conversationId, input.automationEpoch],
    );
    if (result.rows.length !== 1) {
      throw new DealConflictError('Automation fence is stale');
    }
  }
}
