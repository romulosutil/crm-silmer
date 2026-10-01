-- ADR 009: the bot hands off when it reaches its cap of automated messages,
-- and that handoff gets its own reason instead of borrowing low_confidence.
-- Expand-only: the previous release never writes the new value.

ALTER TABLE crm.handoffs
  DROP CONSTRAINT handoffs_reason_code_check,
  ADD CONSTRAINT handoffs_reason_code_check CHECK (reason_code IN (
    'customer_requested_human', 'price_before_quote', 'unresolved_blocker',
    'low_confidence', 'briefing_complete', 'human_requested', 'negotiation',
    'complaint', 'urgency', 'unsupported', 'iteration_limit'
  ));
