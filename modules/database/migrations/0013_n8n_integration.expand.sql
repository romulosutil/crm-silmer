ALTER TABLE crm.conversations
  ADD COLUMN inbound_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN claimed_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN briefing_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN last_inbound_event_id text;

WITH inbound AS (
  SELECT
    conversation_id,
    count(*)::bigint AS revision,
    (array_agg(external_message_id ORDER BY occurred_at DESC, id DESC))[1]
      AS last_event_id
  FROM crm.messages
  WHERE direction = 'inbound'
  GROUP BY conversation_id
)
UPDATE crm.conversations AS conversation
SET inbound_revision = inbound.revision,
    briefing_version = inbound.revision,
    last_inbound_event_id = inbound.last_event_id
FROM inbound
WHERE conversation.id = inbound.conversation_id;

ALTER TABLE crm.conversations
  ADD CONSTRAINT conversations_n8n_revision_check CHECK (
    inbound_revision >= 0
    AND claimed_revision >= 0
    AND claimed_revision <= inbound_revision
    AND briefing_version >= 0
  ),
  ADD CONSTRAINT conversations_last_inbound_event_check CHECK (
    (inbound_revision = 0 AND last_inbound_event_id IS NULL)
    OR (
      inbound_revision > 0
      AND octet_length(last_inbound_event_id) BETWEEN 1 AND 512
    )
  );

-- Conversion creates a Deal but does not end the customer conversation.  Keep
-- legacy converted cycles terminal only when a newer open cycle already exists;
-- new conversions and every unambiguous backfill remain open.
ALTER TABLE crm.conversations
  DROP CONSTRAINT conversations_terminal_state_check;

UPDATE crm.conversations AS converted
SET terminal_at = NULL
WHERE converted.state = 'convertida_em_lead'
  AND NOT EXISTS (
    SELECT 1
    FROM crm.conversations AS active
    WHERE active.provider = converted.provider
      AND active.provider_account_id = converted.provider_account_id
      AND active.external_conversation_id = converted.external_conversation_id
      AND active.id <> converted.id
      AND active.terminal_at IS NULL
  );

ALTER TABLE crm.conversations
  ADD CONSTRAINT conversations_terminal_state_check CHECK (
    (state = 'sem_lead' AND terminal_at IS NOT NULL)
    OR (state = 'convertida_em_lead')
    OR (state NOT IN ('convertida_em_lead', 'sem_lead') AND terminal_at IS NULL)
  );

ALTER TABLE crm.messages
  ADD COLUMN inbound_revision bigint,
  ADD COLUMN delivery_status text,
  ADD COLUMN delivery_status_at timestamptz,
  ADD COLUMN automation_epoch bigint,
  ADD COLUMN n8n_execution_id text;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY conversation_id
      ORDER BY occurred_at, id
    )::bigint AS revision
  FROM crm.messages
  WHERE direction = 'inbound'
)
UPDATE crm.messages AS message
SET inbound_revision = ranked.revision
FROM ranked
WHERE message.id = ranked.id;

UPDATE crm.messages
SET delivery_status = 'sent', delivery_status_at = occurred_at
WHERE direction = 'outbound' AND status = 'sent';

ALTER TABLE crm.messages
  DROP CONSTRAINT messages_direction_identity_check,
  ADD CONSTRAINT messages_direction_identity_check CHECK (
    (
      direction = 'inbound'
      AND external_message_id IS NOT NULL
      AND command_id IS NULL
      AND author_kind = 'contact'
      AND status = 'received'
    )
    OR
    (
      direction = 'outbound'
      AND channel_event_id IS NULL
      AND (
        (command_id IS NOT NULL AND author_kind IN ('human', 'assistant', 'system'))
        OR (
          command_id IS NULL
          AND external_message_id IS NOT NULL
          AND author_kind = 'assistant'
        )
      )
      AND status IN ('queued', 'sending', 'sent', 'failed', 'outcome_unknown')
    )
  ),
  ADD CONSTRAINT messages_inbound_revision_check CHECK (
    (direction = 'inbound' AND inbound_revision > 0)
    OR (direction = 'outbound' AND inbound_revision IS NULL)
  ),
  ADD CONSTRAINT messages_delivery_status_check CHECK (
    delivery_status IS NULL
    OR delivery_status IN ('sent', 'delivered', 'read', 'failed', 'outcome_unknown')
  ),
  ADD CONSTRAINT messages_delivery_time_check CHECK (
    (delivery_status IS NULL AND delivery_status_at IS NULL)
    OR (delivery_status IS NOT NULL AND delivery_status_at IS NOT NULL)
  ),
  ADD CONSTRAINT messages_automation_epoch_check CHECK (
    automation_epoch IS NULL OR automation_epoch >= 0
  ),
  ADD CONSTRAINT messages_n8n_execution_check CHECK (
    n8n_execution_id IS NULL
    OR octet_length(n8n_execution_id) BETWEEN 1 AND 256
  );

CREATE UNIQUE INDEX messages_conversation_inbound_revision_key
  ON crm.messages (conversation_id, inbound_revision)
  WHERE inbound_revision IS NOT NULL;

ALTER TABLE crm.attachments
  ADD COLUMN filename_envelope jsonb,
  ADD COLUMN created_at timestamptz;

UPDATE crm.attachments AS attachment
SET created_at = media.first_received_at
FROM crm.transient_media AS media
WHERE media.id = attachment.transient_media_id;

ALTER TABLE crm.attachments
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ADD CONSTRAINT attachments_filename_envelope_check CHECK (
    filename_envelope IS NULL
    OR (
      jsonb_typeof(filename_envelope) = 'object'
      AND filename_envelope ->> 'algorithm' = 'AES-256-GCM'
      AND filename_envelope ->> 'keyVersion' = key_version::text
      AND filename_envelope ->> 'version' = '1'
    )
  );

ALTER TABLE crm.handoffs
  DROP CONSTRAINT handoffs_reason_code_check,
  ALTER COLUMN deal_id DROP NOT NULL,
  ALTER COLUMN assigned_user_id DROP NOT NULL,
  ADD COLUMN target_role text;

UPDATE crm.handoffs AS handoff
SET target_role = COALESCE(
  (
    SELECT function_name
    FROM crm.user_functions
    WHERE user_id = handoff.assigned_user_id
  ),
  CASE
    WHEN handoff.reason_code IN ('price_before_quote', 'negotiation')
      THEN 'Vendedor'
    ELSE 'Atendimento'
  END
);

ALTER TABLE crm.handoffs
  ALTER COLUMN target_role SET NOT NULL,
  ADD CONSTRAINT handoffs_target_role_check
    CHECK (target_role IN ('Atendimento', 'Vendedor')),
  ADD CONSTRAINT handoffs_reason_code_check CHECK (reason_code IN (
    'customer_requested_human', 'price_before_quote', 'unresolved_blocker',
    'low_confidence', 'briefing_complete', 'human_requested', 'negotiation',
    'complaint', 'urgency', 'unsupported'
  )),
  ADD CONSTRAINT handoffs_assignment_check CHECK (
    (status = 'pending')
    OR (status IN ('accepted', 'resolved') AND assigned_user_id IS NOT NULL)
  );

ALTER TABLE crm.handoff_history
  ALTER COLUMN assigned_user_id DROP NOT NULL,
  ADD COLUMN target_role text;

DROP TRIGGER handoff_history_immutable ON crm.handoff_history;

UPDATE crm.handoff_history AS history
SET target_role = handoff.target_role
FROM crm.handoffs AS handoff
WHERE handoff.id = history.handoff_id;

ALTER TABLE crm.handoff_history
  ALTER COLUMN target_role SET NOT NULL,
  ADD CONSTRAINT handoff_history_target_role_check
    CHECK (target_role IN ('Atendimento', 'Vendedor'));

CREATE TRIGGER handoff_history_immutable
BEFORE UPDATE OR DELETE ON crm.handoff_history
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TABLE crm.conversation_briefing_versions (
  conversation_id text NOT NULL
    REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  version bigint NOT NULL CHECK (version > 0),
  source_revision bigint NOT NULL CHECK (source_revision > 0),
  automation_epoch bigint NOT NULL CHECK (automation_epoch >= 0),
  context_envelope jsonb NOT NULL,
  key_version smallint NOT NULL DEFAULT 1 CHECK (key_version = 1),
  workflow_key text NOT NULL,
  workflow_version text NOT NULL,
  execution_id text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, version),
  CONSTRAINT conversation_briefing_versions_context_envelope_check CHECK (
    jsonb_typeof(context_envelope) = 'object'
    AND context_envelope ->> 'algorithm' = 'AES-256-GCM'
    AND context_envelope ->> 'keyVersion' = key_version::text
    AND context_envelope ->> 'version' = '1'
  ),
  CONSTRAINT conversation_briefing_versions_workflow_check CHECK (
    octet_length(workflow_key) BETWEEN 1 AND 128
    AND octet_length(workflow_version) BETWEEN 1 AND 128
    AND octet_length(execution_id) BETWEEN 1 AND 256
    AND octet_length(correlation_id) BETWEEN 1 AND 128
  )
);

CREATE TABLE crm.automation_runs (
  id text PRIMARY KEY,
  workflow_key text NOT NULL,
  workflow_version text NOT NULL,
  execution_id text NOT NULL,
  correlation_id text NOT NULL,
  conversation_id text REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  source_message_id text REFERENCES crm.messages (id) ON DELETE RESTRICT,
  automation_epoch bigint,
  ai_provider text,
  ai_model text,
  prompt_version text,
  status text NOT NULL DEFAULT 'running',
  result_code text,
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT automation_runs_execution_key
    UNIQUE (workflow_key, workflow_version, execution_id),
  CONSTRAINT automation_runs_workflow_check CHECK (
    octet_length(workflow_key) BETWEEN 1 AND 128
    AND octet_length(workflow_version) BETWEEN 1 AND 128
    AND octet_length(execution_id) BETWEEN 1 AND 256
    AND octet_length(correlation_id) BETWEEN 1 AND 128
  ),
  CONSTRAINT automation_runs_epoch_check CHECK (
    automation_epoch IS NULL OR automation_epoch >= 0
  ),
  CONSTRAINT automation_runs_provider_check CHECK (
    ai_provider IS NULL OR ai_provider IN ('openai', 'gemini')
  ),
  CONSTRAINT automation_runs_status_check CHECK (
    status IN ('running', 'completed', 'failed', 'outcome_unknown')
  ),
  CONSTRAINT automation_runs_completion_check CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status <> 'running' AND completed_at IS NOT NULL)
  ),
  CONSTRAINT automation_runs_time_check CHECK (
    updated_at >= started_at
    AND (completed_at IS NULL OR completed_at >= started_at)
  )
);

CREATE INDEX automation_runs_conversation_timeline_idx
  ON crm.automation_runs (conversation_id, started_at DESC, id)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX automation_runs_source_message_idx
  ON crm.automation_runs (source_message_id, id)
  WHERE source_message_id IS NOT NULL;

CREATE TABLE crm.ai_turns (
  id text PRIMARY KEY,
  conversation_id text NOT NULL
    REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision > 0),
  automation_epoch bigint NOT NULL CHECK (automation_epoch >= 0),
  last_event_id text NOT NULL,
  worker_id text NOT NULL,
  execution_id text NOT NULL,
  claim_token_hash text NOT NULL UNIQUE,
  claim_token_envelope jsonb NOT NULL,
  key_version smallint NOT NULL DEFAULT 1 CHECK (key_version = 1),
  status text NOT NULL DEFAULT 'claimed',
  claimed_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  finished_at timestamptz,
  CONSTRAINT ai_turns_identity_check CHECK (
    octet_length(last_event_id) BETWEEN 1 AND 512
    AND octet_length(worker_id) BETWEEN 1 AND 128
    AND octet_length(execution_id) BETWEEN 1 AND 256
    AND claim_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ai_turns_token_envelope_check CHECK (
    jsonb_typeof(claim_token_envelope) = 'object'
    AND claim_token_envelope ->> 'algorithm' = 'AES-256-GCM'
    AND claim_token_envelope ->> 'keyVersion' = key_version::text
    AND claim_token_envelope ->> 'version' = '1'
  ),
  CONSTRAINT ai_turns_status_check CHECK (
    status IN ('claimed', 'completed', 'failed', 'expired')
  ),
  CONSTRAINT ai_turns_time_check CHECK (
    lease_expires_at > claimed_at
    AND (
      (status = 'claimed' AND finished_at IS NULL)
      OR (status <> 'claimed' AND finished_at IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX ai_turns_one_active_revision_key
  ON crm.ai_turns (conversation_id, revision)
  WHERE status = 'claimed';
CREATE INDEX ai_turns_active_lease_idx
  ON crm.ai_turns (lease_expires_at, conversation_id)
  WHERE status = 'claimed';

CREATE TABLE crm.n8n_events (
  id text PRIMARY KEY,
  idempotency_scope text NOT NULL,
  idempotency_key text NOT NULL,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  conversation_id text REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  message_id text REFERENCES crm.messages (id) ON DELETE RESTRICT,
  run_id text REFERENCES crm.automation_runs (id) ON DELETE RESTRICT,
  correlation_id text NOT NULL,
  outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL,
  CONSTRAINT n8n_events_idempotency_key
    UNIQUE (idempotency_scope, idempotency_key),
  CONSTRAINT n8n_events_type_check CHECK (event_type IN (
    'message.inbound', 'attachment.stored', 'message.sent',
    'message.delivered', 'message.read', 'message.failed', 'lead.updated',
    'handoff.requested', 'workflow.failed', 'message.send.requested',
    'message.send.unknown'
  )),
  CONSTRAINT n8n_events_conversation_check CHECK (
    conversation_id IS NOT NULL OR event_type = 'workflow.failed'
  ),
  CONSTRAINT n8n_events_correlation_check CHECK (
    octet_length(idempotency_scope) BETWEEN 1 AND 128
    AND octet_length(idempotency_key) BETWEEN 1 AND 512
    AND octet_length(external_event_id) BETWEEN 1 AND 512
    AND
    octet_length(correlation_id) BETWEEN 1 AND 128
  ),
  CONSTRAINT n8n_events_outcome_check CHECK (jsonb_typeof(outcome) = 'object'),
  CONSTRAINT n8n_events_time_check CHECK (processed_at >= occurred_at)
);

CREATE INDEX n8n_events_conversation_timeline_idx
  ON crm.n8n_events (conversation_id, occurred_at, id)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX n8n_events_message_idx
  ON crm.n8n_events (message_id, occurred_at, id)
  WHERE message_id IS NOT NULL;
CREATE INDEX n8n_events_run_idx
  ON crm.n8n_events (run_id, occurred_at, id)
  WHERE run_id IS NOT NULL;

CREATE TABLE crm.n8n_commands (
  command_id text PRIMARY KEY,
  conversation_id text NOT NULL
    REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  message_id text UNIQUE
    REFERENCES crm.messages (id) ON DELETE RESTRICT,
  action text NOT NULL,
  actor_id text NOT NULL,
  actor_kind text NOT NULL,
  automation_epoch bigint NOT NULL CHECK (automation_epoch >= 0),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  payload_envelope jsonb NOT NULL,
  key_version smallint NOT NULL DEFAULT 1 CHECK (key_version = 1),
  status text NOT NULL DEFAULT 'pending',
  locked_by text,
  locked_until timestamptz,
  external_message_id text,
  last_error_code text,
  retryable boolean,
  retry_safe boolean,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT n8n_commands_actor_check CHECK (
    actor_kind IN ('human', 'assistant', 'system')
    AND octet_length(actor_id) BETWEEN 1 AND 128
  ),
  CONSTRAINT n8n_commands_action_check CHECK (
    action IN ('send_message', 'take_over', 'return_to_ai', 'close')
    AND (
      (action = 'send_message' AND message_id IS NOT NULL)
      OR (action <> 'send_message' AND message_id IS NULL)
    )
  ),
  CONSTRAINT n8n_commands_payload_envelope_check CHECK (
    jsonb_typeof(payload_envelope) = 'object'
    AND payload_envelope ->> 'algorithm' = 'AES-256-GCM'
    AND payload_envelope ->> 'keyVersion' = key_version::text
    AND payload_envelope ->> 'version' = '1'
  ),
  CONSTRAINT n8n_commands_status_check CHECK (
    status IN ('pending', 'processing', 'sent', 'failed', 'outcome_unknown')
  ),
  CONSTRAINT n8n_commands_lock_check CHECK (
    (status = 'processing' AND locked_by IS NOT NULL AND locked_until IS NOT NULL)
    OR (status <> 'processing' AND locked_by IS NULL AND locked_until IS NULL)
  ),
  CONSTRAINT n8n_commands_completion_check CHECK (
    (status IN ('sent', 'failed', 'outcome_unknown') AND completed_at IS NOT NULL)
    OR (status IN ('pending', 'processing') AND completed_at IS NULL)
  ),
  CONSTRAINT n8n_commands_time_check CHECK (
    updated_at >= created_at
    AND (completed_at IS NULL OR completed_at >= created_at)
  )
);

CREATE INDEX n8n_commands_conversation_timeline_idx
  ON crm.n8n_commands (conversation_id, created_at, command_id);
CREATE INDEX n8n_commands_pending_idx
  ON crm.n8n_commands (created_at, command_id)
  WHERE status = 'pending';
CREATE UNIQUE INDEX n8n_commands_external_message_key
  ON crm.n8n_commands (external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE TABLE crm.message_delivery_attempts (
  id text PRIMARY KEY,
  message_id text NOT NULL REFERENCES crm.messages (id) ON DELETE RESTRICT,
  command_id text REFERENCES crm.n8n_commands (command_id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  provider text NOT NULL,
  external_message_id text,
  status text NOT NULL,
  occurred_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  error_code text,
  CONSTRAINT message_delivery_attempts_number_key
    UNIQUE (message_id, attempt_no),
  CONSTRAINT message_delivery_attempts_provider_check CHECK (
    provider = lower(provider) AND octet_length(provider) BETWEEN 1 AND 64
  ),
  CONSTRAINT message_delivery_attempts_status_check CHECK (
    status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'outcome_unknown')
  ),
  CONSTRAINT message_delivery_attempts_time_check CHECK (updated_at >= occurred_at)
);

CREATE INDEX message_delivery_attempts_command_idx
  ON crm.message_delivery_attempts (command_id, attempt_no DESC)
  WHERE command_id IS NOT NULL;
CREATE UNIQUE INDEX message_delivery_attempts_external_message_key
  ON crm.message_delivery_attempts (external_message_id)
  WHERE external_message_id IS NOT NULL;

ALTER TABLE crm.outbox_jobs
  DROP CONSTRAINT outbox_jobs_type_check,
  DROP CONSTRAINT outbox_jobs_target_check,
  ADD COLUMN n8n_command_id text
    REFERENCES crm.n8n_commands (command_id) ON DELETE RESTRICT,
  ADD CONSTRAINT outbox_jobs_type_check CHECK (
    job_type IN (
      'channel_event.process', 'media.delete', 'channel_message.send',
      'n8n.command.deliver'
    )
  ),
  ADD CONSTRAINT outbox_jobs_target_check CHECK (
    (
      job_type = 'channel_event.process'
      AND channel_event_id IS NOT NULL
      AND transient_media_id IS NULL
      AND message_id IS NULL
      AND n8n_command_id IS NULL
      AND deletion_reason IS NULL
    )
    OR (
      job_type = 'media.delete'
      AND channel_event_id IS NULL
      AND transient_media_id IS NOT NULL
      AND message_id IS NULL
      AND n8n_command_id IS NULL
      AND deletion_reason IN ('expired', 'journey_terminal')
    )
    OR (
      job_type = 'channel_message.send'
      AND channel_event_id IS NULL
      AND transient_media_id IS NULL
      AND message_id IS NOT NULL
      AND n8n_command_id IS NULL
      AND deletion_reason IS NULL
    )
    OR (
      job_type = 'n8n.command.deliver'
      AND channel_event_id IS NULL
      AND transient_media_id IS NULL
      AND n8n_command_id IS NOT NULL
      AND deletion_reason IS NULL
    )
  );

CREATE UNIQUE INDEX outbox_jobs_n8n_command_delivery_key
  ON crm.outbox_jobs (n8n_command_id)
  WHERE job_type = 'n8n.command.deliver';

CREATE FUNCTION crm.sync_n8n_command_outbox_outcome()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.job_type = 'n8n.command.deliver'
    AND NEW.n8n_command_id IS NOT NULL
    AND NEW.status = 'outcome_unknown'
    AND OLD.status IS DISTINCT FROM NEW.status
  THEN
    UPDATE crm.n8n_commands
    SET status = 'outcome_unknown', locked_by = NULL, locked_until = NULL,
        last_error_code = COALESCE(NEW.last_error_code, 'OUTCOME_UNKNOWN'),
        retryable = false, retry_safe = false, updated_at = NEW.updated_at,
        completed_at = NEW.completed_at
    WHERE command_id = NEW.n8n_command_id
      AND status IN ('pending', 'processing', 'failed');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_jobs_sync_n8n_command_outcome
AFTER UPDATE OF status ON crm.outbox_jobs
FOR EACH ROW EXECUTE FUNCTION crm.sync_n8n_command_outbox_outcome();

CREATE FUNCTION crm.reject_n8n_integration_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'n8n integration history is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER conversation_briefing_versions_immutable
BEFORE UPDATE OR DELETE ON crm.conversation_briefing_versions
FOR EACH ROW EXECUTE FUNCTION crm.reject_n8n_integration_history_mutation();
CREATE TRIGGER n8n_events_immutable
BEFORE UPDATE OR DELETE ON crm.n8n_events
FOR EACH ROW EXECUTE FUNCTION crm.reject_n8n_integration_history_mutation();
