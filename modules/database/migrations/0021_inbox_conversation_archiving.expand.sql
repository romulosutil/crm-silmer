-- Archiving is an operational Inbox concern, not a terminal conversation state:
-- it preserves the history, automation state, and the retention trigger.
ALTER TABLE crm.conversations
  ADD COLUMN archived_at timestamptz;

CREATE INDEX conversations_inbox_active_idx
  ON crm.conversations (last_message_at DESC, id DESC)
  WHERE archived_at IS NULL;
