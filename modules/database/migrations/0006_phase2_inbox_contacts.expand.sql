CREATE TABLE crm.contacts (
  id text PRIMARY KEY,
  provisional boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at)
);

CREATE TABLE crm.contact_identities (
  id text PRIMARY KEY,
  current_contact_id text NOT NULL
    REFERENCES crm.contacts (id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  channel text NOT NULL,
  external_identity_lookup_hash text NOT NULL,
  identity_kind text NOT NULL,
  phone_status text NOT NULL,
  identity_envelope jsonb NOT NULL,
  key_version smallint NOT NULL DEFAULT 1,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT contact_identities_external_scope_key
    UNIQUE (
      provider,
      provider_account_id,
      channel,
      external_identity_lookup_hash
    ),
  CONSTRAINT contact_identities_provider_check CHECK (
    provider = lower(provider)
    AND octet_length(provider) BETWEEN 1 AND 64
  ),
  CONSTRAINT contact_identities_account_check CHECK (
    octet_length(provider_account_id) BETWEEN 1 AND 512
  ),
  CONSTRAINT contact_identities_channel_check
    CHECK (channel IN ('instagram', 'whatsapp')),
  CONSTRAINT contact_identities_lookup_hash_check
    CHECK (external_identity_lookup_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT contact_identities_kind_check
    CHECK (identity_kind IN ('handle', 'phone')),
  CONSTRAINT contact_identities_phone_status_check
    CHECK (phone_status IN ('pending', 'confirmed')),
  CONSTRAINT contact_identities_channel_identity_check CHECK (
    (channel = 'instagram' AND identity_kind = 'handle' AND phone_status = 'pending')
    OR
    (channel = 'whatsapp' AND identity_kind = 'phone' AND phone_status = 'confirmed')
  ),
  CONSTRAINT contact_identities_envelope_check CHECK (
    jsonb_typeof(identity_envelope) = 'object'
    AND identity_envelope ->> 'algorithm' = 'AES-256-GCM'
    AND identity_envelope ->> 'keyVersion' = key_version::text
    AND identity_envelope ->> 'version' = '1'
  ),
  CONSTRAINT contact_identities_key_version_check CHECK (key_version = 1),
  CONSTRAINT contact_identities_version_check CHECK (version > 0),
  CONSTRAINT contact_identities_time_check CHECK (updated_at >= created_at)
);

CREATE INDEX contact_identities_current_contact_idx
  ON crm.contact_identities (current_contact_id, id);

CREATE TABLE crm.identity_links (
  id text PRIMARY KEY,
  contact_identity_id text NOT NULL
    REFERENCES crm.contact_identities (id) ON DELETE RESTRICT,
  source_contact_id text NOT NULL
    REFERENCES crm.contacts (id) ON DELETE RESTRICT,
  target_contact_id text NOT NULL
    REFERENCES crm.contacts (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  merged_by text NOT NULL,
  merge_reason text NOT NULL,
  merge_correlation_id text NOT NULL,
  merge_idempotency_key text NOT NULL,
  merge_fingerprint text NOT NULL,
  merged_at timestamptz NOT NULL,
  reverted_by text,
  revert_reason text,
  revert_correlation_id text,
  revert_idempotency_key text,
  revert_fingerprint text,
  reverted_at timestamptz,
  CONSTRAINT identity_links_merge_idempotency_key
    UNIQUE (merge_idempotency_key),
  CONSTRAINT identity_links_revert_idempotency_key
    UNIQUE (revert_idempotency_key),
  CONSTRAINT identity_links_contacts_check
    CHECK (source_contact_id <> target_contact_id),
  CONSTRAINT identity_links_status_check
    CHECK (status IN ('active', 'reverted')),
  CONSTRAINT identity_links_merge_metadata_check CHECK (
    octet_length(merged_by) BETWEEN 1 AND 128
    AND octet_length(merge_reason) BETWEEN 1 AND 2048
    AND octet_length(merge_correlation_id) BETWEEN 1 AND 128
    AND octet_length(merge_idempotency_key) BETWEEN 1 AND 512
    AND merge_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT identity_links_revert_metadata_check CHECK (
    (
      status = 'active'
      AND reverted_by IS NULL
      AND revert_reason IS NULL
      AND revert_correlation_id IS NULL
      AND revert_idempotency_key IS NULL
      AND revert_fingerprint IS NULL
      AND reverted_at IS NULL
    )
    OR
    (
      status = 'reverted'
      AND octet_length(reverted_by) BETWEEN 1 AND 128
      AND octet_length(revert_reason) BETWEEN 1 AND 2048
      AND octet_length(revert_correlation_id) BETWEEN 1 AND 128
      AND octet_length(revert_idempotency_key) BETWEEN 1 AND 512
      AND revert_fingerprint ~ '^[0-9a-f]{64}$'
      AND reverted_at >= merged_at
    )
  )
);

CREATE FUNCTION crm.reject_identity_link_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'reverted' THEN
    RAISE EXCEPTION 'identity link history is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF ROW(
    OLD.id,
    OLD.contact_identity_id,
    OLD.source_contact_id,
    OLD.target_contact_id,
    OLD.merged_by,
    OLD.merge_reason,
    OLD.merge_correlation_id,
    OLD.merge_idempotency_key,
    OLD.merge_fingerprint,
    OLD.merged_at
  ) IS DISTINCT FROM ROW(
    NEW.id,
    NEW.contact_identity_id,
    NEW.source_contact_id,
    NEW.target_contact_id,
    NEW.merged_by,
    NEW.merge_reason,
    NEW.merge_correlation_id,
    NEW.merge_idempotency_key,
    NEW.merge_fingerprint,
    NEW.merged_at
  ) THEN
    RAISE EXCEPTION 'identity link history is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER identity_links_history_immutable
BEFORE UPDATE ON crm.identity_links
FOR EACH ROW EXECUTE FUNCTION crm.reject_identity_link_history_mutation();

CREATE UNIQUE INDEX identity_links_one_active_per_identity
  ON crm.identity_links (contact_identity_id)
  WHERE status = 'active';

CREATE TABLE crm.conversations (
  id text PRIMARY KEY,
  contact_identity_id text NOT NULL
    REFERENCES crm.contact_identities (id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  external_conversation_id text NOT NULL,
  cycle_number integer NOT NULL,
  previous_conversation_id text
    REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'nova',
  automation_state text NOT NULL DEFAULT 'assistant',
  automation_epoch bigint NOT NULL DEFAULT 0,
  assigned_user_id text,
  version bigint NOT NULL DEFAULT 1,
  opened_at timestamptz NOT NULL,
  last_message_at timestamptz NOT NULL,
  terminal_at timestamptz,
  CONSTRAINT conversations_cycle_key UNIQUE (
    provider,
    provider_account_id,
    external_conversation_id,
    cycle_number
  ),
  CONSTRAINT conversations_provider_check CHECK (
    provider = lower(provider)
    AND octet_length(provider) BETWEEN 1 AND 64
  ),
  CONSTRAINT conversations_account_check CHECK (
    octet_length(provider_account_id) BETWEEN 1 AND 512
  ),
  CONSTRAINT conversations_external_id_check CHECK (
    octet_length(external_conversation_id) BETWEEN 1 AND 512
  ),
  CONSTRAINT conversations_cycle_number_check CHECK (cycle_number > 0),
  CONSTRAINT conversations_previous_cycle_check CHECK (
    (cycle_number = 1 AND previous_conversation_id IS NULL)
    OR (cycle_number > 1 AND previous_conversation_id IS NOT NULL)
  ),
  CONSTRAINT conversations_state_check CHECK (state IN (
    'nova',
    'em_analise',
    'em_atendimento',
    'requer_atencao',
    'convertida_em_lead',
    'sem_lead'
  )),
  CONSTRAINT conversations_automation_state_check
    CHECK (automation_state IN ('assistant', 'human')),
  CONSTRAINT conversations_automation_epoch_check CHECK (automation_epoch >= 0),
  CONSTRAINT conversations_version_check CHECK (version > 0),
  CONSTRAINT conversations_time_check CHECK (
    last_message_at >= opened_at
    AND (terminal_at IS NULL OR terminal_at >= opened_at)
  ),
  CONSTRAINT conversations_terminal_state_check CHECK (
    (state IN ('convertida_em_lead', 'sem_lead') AND terminal_at IS NOT NULL)
    OR (state NOT IN ('convertida_em_lead', 'sem_lead') AND terminal_at IS NULL)
  )
);

CREATE UNIQUE INDEX conversations_one_active_cycle_key
  ON crm.conversations (
    provider,
    provider_account_id,
    external_conversation_id
  )
  WHERE terminal_at IS NULL;

CREATE INDEX conversations_identity_idx
  ON crm.conversations (contact_identity_id, opened_at DESC, id);

CREATE TABLE crm.messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL
    REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  channel_event_id text
    REFERENCES crm.channel_events (id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  external_message_id text,
  command_id text,
  direction text NOT NULL,
  author_kind text NOT NULL,
  author_id text NOT NULL,
  message_type text NOT NULL,
  content_envelope jsonb NOT NULL,
  key_version smallint NOT NULL DEFAULT 1,
  status text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT messages_provider_check CHECK (
    provider = lower(provider)
    AND octet_length(provider) BETWEEN 1 AND 64
  ),
  CONSTRAINT messages_account_check CHECK (
    octet_length(provider_account_id) BETWEEN 1 AND 512
  ),
  CONSTRAINT messages_external_id_check CHECK (
    external_message_id IS NULL
    OR octet_length(external_message_id) BETWEEN 1 AND 512
  ),
  CONSTRAINT messages_command_id_check CHECK (
    command_id IS NULL OR octet_length(command_id) BETWEEN 1 AND 512
  ),
  CONSTRAINT messages_direction_check CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT messages_author_kind_check
    CHECK (author_kind IN ('contact', 'human', 'assistant', 'system')),
  CONSTRAINT messages_author_id_check
    CHECK (octet_length(author_id) BETWEEN 1 AND 512),
  CONSTRAINT messages_type_check CHECK (message_type IN (
    'audio', 'document', 'image', 'template', 'text', 'video'
  )),
  CONSTRAINT messages_content_envelope_check CHECK (
    jsonb_typeof(content_envelope) = 'object'
    AND content_envelope ->> 'algorithm' = 'AES-256-GCM'
    AND content_envelope ->> 'keyVersion' = key_version::text
    AND content_envelope ->> 'version' = '1'
  ),
  CONSTRAINT messages_key_version_check CHECK (key_version = 1),
  CONSTRAINT messages_status_check CHECK (status IN (
    'received', 'queued', 'sending', 'sent', 'failed', 'outcome_unknown'
  )),
  CONSTRAINT messages_direction_identity_check CHECK (
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
      AND command_id IS NOT NULL
      AND author_kind IN ('human', 'assistant', 'system')
      AND status IN ('queued', 'sending', 'sent', 'failed', 'outcome_unknown')
    )
  ),
  CONSTRAINT messages_time_check CHECK (created_at >= occurred_at)
);

CREATE UNIQUE INDEX messages_external_identity_key
  ON crm.messages (provider, provider_account_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE UNIQUE INDEX messages_channel_event_key
  ON crm.messages (channel_event_id)
  WHERE channel_event_id IS NOT NULL;

CREATE UNIQUE INDEX messages_command_key
  ON crm.messages (command_id)
  WHERE command_id IS NOT NULL;

CREATE INDEX messages_conversation_timeline_idx
  ON crm.messages (conversation_id, occurred_at, id);

CREATE TABLE crm.attachments (
  message_id text NOT NULL REFERENCES crm.messages (id) ON DELETE RESTRICT,
  transient_media_id text NOT NULL
    REFERENCES crm.transient_media (id) ON DELETE RESTRICT,
  caption_envelope jsonb,
  key_version smallint NOT NULL DEFAULT 1,
  PRIMARY KEY (message_id, transient_media_id),
  CONSTRAINT attachments_caption_envelope_check CHECK (
    caption_envelope IS NULL
    OR (
      jsonb_typeof(caption_envelope) = 'object'
      AND caption_envelope ->> 'algorithm' = 'AES-256-GCM'
      AND caption_envelope ->> 'keyVersion' = key_version::text
      AND caption_envelope ->> 'version' = '1'
    )
  ),
  CONSTRAINT attachments_key_version_check CHECK (key_version = 1)
);

CREATE TABLE crm.ai_suggestions (
  id text PRIMARY KEY,
  conversation_id text NOT NULL
    REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  source_message_id text NOT NULL
    REFERENCES crm.messages (id) ON DELETE RESTRICT,
  automation_epoch bigint NOT NULL,
  proposed_stage text NOT NULL,
  question_envelope jsonb NOT NULL,
  key_version smallint NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CONSTRAINT ai_suggestions_source_stage_key
    UNIQUE (source_message_id, proposed_stage),
  CONSTRAINT ai_suggestions_epoch_check CHECK (automation_epoch >= 0),
  CONSTRAINT ai_suggestions_stage_check CHECK (
    octet_length(proposed_stage) BETWEEN 1 AND 128
  ),
  CONSTRAINT ai_suggestions_question_envelope_check CHECK (
    jsonb_typeof(question_envelope) = 'object'
    AND question_envelope ->> 'algorithm' = 'AES-256-GCM'
    AND question_envelope ->> 'keyVersion' = key_version::text
    AND question_envelope ->> 'version' = '1'
  ),
  CONSTRAINT ai_suggestions_key_version_check CHECK (key_version = 1),
  CONSTRAINT ai_suggestions_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected', 'obsolete')),
  CONSTRAINT ai_suggestions_resolution_check CHECK (
    (status = 'pending' AND resolved_at IS NULL)
    OR (status <> 'pending' AND resolved_at IS NOT NULL)
  )
);

CREATE TABLE crm.inbox_commands (
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (operation, idempotency_key),
  CONSTRAINT inbox_commands_operation_check
    CHECK (octet_length(operation) BETWEEN 1 AND 128),
  CONSTRAINT inbox_commands_idempotency_key_check
    CHECK (octet_length(idempotency_key) BETWEEN 1 AND 512),
  CONSTRAINT inbox_commands_fingerprint_check
    CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT inbox_commands_result_check CHECK (jsonb_typeof(result) = 'object'),
  CONSTRAINT inbox_commands_time_check CHECK (completed_at >= created_at)
);

ALTER TABLE crm.outbox_jobs
  DROP CONSTRAINT outbox_jobs_type_check,
  DROP CONSTRAINT outbox_jobs_target_check,
  ADD COLUMN message_id text REFERENCES crm.messages (id) ON DELETE RESTRICT;

ALTER TABLE crm.outbox_jobs
  ADD CONSTRAINT outbox_jobs_type_check CHECK (
    job_type IN ('channel_event.process', 'media.delete', 'channel_message.send')
  ),
  ADD CONSTRAINT outbox_jobs_target_check CHECK (
    (
      job_type = 'channel_event.process'
      AND channel_event_id IS NOT NULL
      AND transient_media_id IS NULL
      AND message_id IS NULL
      AND deletion_reason IS NULL
    )
    OR
    (
      job_type = 'media.delete'
      AND channel_event_id IS NULL
      AND transient_media_id IS NOT NULL
      AND message_id IS NULL
      AND deletion_reason IN ('expired', 'journey_terminal')
    )
    OR
    (
      job_type = 'channel_message.send'
      AND channel_event_id IS NULL
      AND transient_media_id IS NULL
      AND message_id IS NOT NULL
      AND deletion_reason IS NULL
    )
  );

CREATE UNIQUE INDEX outbox_jobs_message_send_key
  ON crm.outbox_jobs (message_id)
  WHERE job_type = 'channel_message.send';
