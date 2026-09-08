ALTER TABLE crm.conversations
  ADD COLUMN briefing_envelope jsonb,
  ADD COLUMN briefing_updated_at timestamptz,
  ADD CONSTRAINT conversations_briefing_snapshot_check CHECK (
    (
      briefing_envelope IS NULL
      AND briefing_updated_at IS NULL
    )
    OR (
      jsonb_typeof(briefing_envelope) = 'object'
      AND briefing_envelope ->> 'algorithm' = 'AES-256-GCM'
      AND briefing_envelope ->> 'keyVersion' = '1'
      AND briefing_envelope ->> 'version' = '1'
      AND briefing_updated_at IS NOT NULL
      AND briefing_version > 0
    )
  );

-- Preserve the latest encrypted briefing while the old history table remains
-- available for a later, explicitly executed contract migration. The original
-- AAD includes conversation_id and briefing_version, so the ciphertext can be
-- copied without decrypting personal data in SQL.
UPDATE crm.conversations AS conversation
SET briefing_envelope = briefing.context_envelope,
    briefing_updated_at = briefing.created_at
FROM crm.conversation_briefing_versions AS briefing
WHERE briefing.conversation_id = conversation.id
  AND briefing.version = conversation.briefing_version;

ALTER TABLE crm.n8n_events
  ADD COLUMN workflow_key text,
  ADD COLUMN workflow_version text,
  ADD COLUMN execution_id text,
  ADD COLUMN automation_epoch bigint,
  ADD COLUMN source_revision bigint,
  ADD CONSTRAINT n8n_events_mvp_trace_check CHECK (
    (workflow_key IS NULL AND workflow_version IS NULL AND execution_id IS NULL)
    OR (
      octet_length(workflow_key) BETWEEN 1 AND 128
      AND octet_length(workflow_version) BETWEEN 1 AND 128
      AND octet_length(execution_id) BETWEEN 1 AND 256
    )
  ),
  ADD CONSTRAINT n8n_events_mvp_fence_check CHECK (
    (automation_epoch IS NULL OR automation_epoch >= 0)
    AND (source_revision IS NULL OR source_revision > 0)
  );

UPDATE crm.n8n_events AS event
SET workflow_key = run.workflow_key,
    workflow_version = run.workflow_version,
    execution_id = run.execution_id,
    automation_epoch = COALESCE(event.automation_epoch, run.automation_epoch)
FROM crm.automation_runs AS run
WHERE run.id = event.run_id;
