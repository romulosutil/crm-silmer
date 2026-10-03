-- REV-08/T77-T80: a delivery/read receipt is not the send clock.
ALTER TABLE crm.messages
  ADD COLUMN sent_at timestamptz,
  ADD CONSTRAINT messages_sent_at_outbound_check CHECK (
    sent_at IS NULL OR direction = 'outbound'
  );

-- Older messages only get a send time where the CRM retained proof of send.
-- delivery_status_at is deliberately excluded: later receipts replace it.
WITH proven_sends AS (
  SELECT message_id, occurred_at AS confirmed_at
  FROM crm.n8n_events
  WHERE event_type = 'message.sent' AND message_id IS NOT NULL
  UNION ALL
  SELECT message_id, completed_at AS confirmed_at
  FROM crm.n8n_commands
  WHERE action = 'send_message' AND status = 'sent'
    AND message_id IS NOT NULL AND completed_at IS NOT NULL
), first_sends AS (
  SELECT message_id, min(confirmed_at) AS confirmed_at
  FROM proven_sends
  GROUP BY message_id
)
UPDATE crm.messages AS message
SET sent_at = first_sends.confirmed_at
FROM first_sends
WHERE message.id = first_sends.message_id
  AND message.direction = 'outbound';

-- Once observed, the first confirmed send cannot drift with delivery state.
CREATE FUNCTION crm.preserve_message_first_sent_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
    RAISE EXCEPTION 'message first sent time is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_preserve_first_sent_at
BEFORE UPDATE ON crm.messages
FOR EACH ROW EXECUTE FUNCTION crm.preserve_message_first_sent_at();
