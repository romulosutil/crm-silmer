-- T22/MED-15/27: durable non-bindable intent precedes irreversible deletion.
ALTER TABLE crm.chat_media ADD COLUMN cleanup_started_at timestamptz;
-- A disconnected session releases advisory locks before its owner observes it.
-- Child/transport commands are bounded below this conservative 15 minute grace.
ALTER TABLE crm.chat_media ADD COLUMN processing_guard_until timestamptz;
ALTER TABLE crm.chat_media_admissions ADD COLUMN writer_guard_until timestamptz;
ALTER TABLE crm.chat_media ADD CONSTRAINT chat_media_cleanup_unbound_check
  CHECK (cleanup_started_at IS NULL OR
    (message_id IS NULL AND state IN ('unavailable', 'lost')));
