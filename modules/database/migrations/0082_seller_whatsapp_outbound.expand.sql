-- WAP-E08: fence the existing send and preserve device observations separately.
ALTER TABLE crm.n8n_commands ADD COLUMN whatsapp_dispatched_at timestamptz;

ALTER TABLE crm.n8n_events DROP CONSTRAINT n8n_events_mvp_fence_check,
  ADD CONSTRAINT n8n_events_mvp_fence_check CHECK (
    (automation_epoch IS NULL OR automation_epoch >= 0)
    AND (source_revision IS NULL OR source_revision > 0 OR
      (source_revision = 0 AND event_type IN ('message.send.requested','message.sent','message.send.unknown','workflow.failed')))
  );

ALTER TABLE crm.n8n_events DROP CONSTRAINT n8n_events_conversation_check,
  ADD CONSTRAINT n8n_events_conversation_check CHECK (
    conversation_id IS NOT NULL OR event_type='workflow.failed' OR (
      event_type IN ('message.delivered','message.read','message.failed') AND
      outcome ? 'pendingExternalId' AND outcome ? 'source'
    )
  );

CREATE INDEX n8n_events_pending_whatsapp_receipt_idx ON crm.n8n_events
  ((outcome->'source'->>'accountId'),(outcome->>'pendingExternalId'))
  WHERE conversation_id IS NULL AND outcome ? 'pendingExternalId';

ALTER TABLE crm.order_billing_send_intents
  ADD COLUMN whatsapp_target jsonb;

CREATE TABLE crm.personal_whatsapp_external_sends (
  account_id uuid NOT NULL,
  external_message_id text NOT NULL CHECK (
    octet_length(external_message_id) BETWEEN 1 AND 512 AND external_message_id ~ '^[A-Za-z0-9_-]+$'
  ),
  binding_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  conversation_id text NOT NULL REFERENCES crm.conversations(id) ON DELETE RESTRICT,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, external_message_id),
  FOREIGN KEY (binding_id, generation) REFERENCES crm.seller_whatsapp_bindings(id, generation)
);

CREATE TRIGGER personal_whatsapp_external_sends_immutable BEFORE UPDATE OR DELETE
  ON crm.personal_whatsapp_external_sends FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();
