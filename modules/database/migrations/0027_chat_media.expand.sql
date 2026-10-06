-- MED-05/15/27/28: retained seller media is independent of transient_media.
ALTER TABLE crm.messages
  ADD CONSTRAINT messages_id_conversation_key UNIQUE (id, conversation_id);

CREATE TABLE crm.chat_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text NOT NULL REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  uploaded_by text NOT NULL REFERENCES crm.users (id) ON DELETE RESTRICT,
  upload_command_id text NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  message_id text UNIQUE,
  kind text NOT NULL CHECK (kind IN ('image', 'audio', 'video')),
  origin text NOT NULL CHECK (origin IN ('attachment', 'recording')),
  filename_envelope jsonb NOT NULL,
  key_version smallint NOT NULL DEFAULT 1 CHECK (key_version = 1),
  state text NOT NULL DEFAULT 'uploaded' CHECK (state IN (
    'uploaded', 'processing', 'ready', 'attached', 'rejected', 'unavailable', 'lost'
  )),
  validation_status text NOT NULL DEFAULT 'pending' CHECK (validation_status IN (
    'pending', 'clean', 'infected', 'invalid_type', 'invalid_format', 'stale_signatures', 'error'
  )),
  sanitized_reason text CHECK (sanitized_reason IN (
    'invalid_format', 'infected', 'stale_signatures', 'scanner_unavailable',
    'storage_unavailable', 'object_missing', 'processing_failed', 'quota_exceeded'
  )),
  original_sha256 text CHECK (original_sha256 IS NULL OR original_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$'),
  object_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  spool_key uuid,
  storage_backend text NOT NULL DEFAULT 'rustfs' CHECK (storage_backend = 'rustfs'),
  storage_bucket_alias text NOT NULL CHECK (storage_bucket_alias IN ('chat-dev', 'chat-operational')),
  input_size_bytes bigint NOT NULL,
  size_bytes bigint,
  reservation_bytes bigint NOT NULL,
  detected_mime_type text,
  container text,
  audio_codec text,
  video_codec text,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attached_at timestamptz,
  retention_class text NOT NULL DEFAULT 'chat_retained' CHECK (retention_class = 'chat_retained'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT chat_media_upload_scope_key UNIQUE (uploaded_by, conversation_id, upload_command_id),
  CONSTRAINT chat_media_command_check CHECK (octet_length(upload_command_id) BETWEEN 1 AND 512),
  CONSTRAINT chat_media_message_conversation_fk FOREIGN KEY (message_id, conversation_id)
    REFERENCES crm.messages (id, conversation_id) ON DELETE RESTRICT,
  CONSTRAINT chat_media_filename_envelope_check CHECK (
    (jsonb_typeof(filename_envelope) = 'object'
    AND filename_envelope ->> 'algorithm' = 'AES-256-GCM'
    AND filename_envelope ->> 'keyVersion' = key_version::text
    AND filename_envelope ->> 'version' = '1'
    AND filename_envelope ->> 'iv' ~ '^[A-Za-z0-9_-]{16}$'
    AND filename_envelope ->> 'tag' ~ '^[A-Za-z0-9_-]{22}$'
    AND filename_envelope ->> 'ciphertext' ~ '^[A-Za-z0-9_-]+$') IS TRUE
  ),
  CONSTRAINT chat_media_recording_origin_check CHECK (origin <> 'recording' OR kind = 'audio'),
  CONSTRAINT chat_media_size_check CHECK (
    input_size_bytes BETWEEN 1 AND 16777216
    AND (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 16777216)
    AND reservation_bytes >= 0
  ),
  CONSTRAINT chat_media_binding_check CHECK (
    (message_id IS NULL AND attached_at IS NULL AND state <> 'attached')
    OR (message_id IS NOT NULL AND attached_at IS NOT NULL AND state IN ('attached', 'unavailable', 'lost'))
  ),
  CONSTRAINT chat_media_ready_metadata_check CHECK (
    state NOT IN ('ready', 'attached') OR (
      validation_status = 'clean' AND size_bytes IS NOT NULL
      AND original_sha256 IS NOT NULL AND content_sha256 IS NOT NULL
      AND detected_mime_type IS NOT NULL AND processed_at IS NOT NULL
    )
  ),
  CONSTRAINT chat_media_rejection_check CHECK (
    state NOT IN ('rejected', 'unavailable', 'lost') OR sanitized_reason IS NOT NULL
  )
);

CREATE INDEX chat_media_conversation_idx ON crm.chat_media (conversation_id, created_at, id);
CREATE INDEX chat_media_drafts_idx ON crm.chat_media (created_at, id)
  WHERE message_id IS NULL;

-- Counters are locked and updated atomically with media transitions by API/worker.
-- Attached bytes remain used; only pending bytes move out of reserved.
CREATE TABLE crm.chat_media_quotas (
  bucket_alias text PRIMARY KEY CHECK (bucket_alias IN ('chat-dev', 'chat-operational')),
  limit_bytes bigint NOT NULL CHECK (limit_bytes > 0),
  used_bytes bigint NOT NULL DEFAULT 0,
  reserved_bytes bigint NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_media_quotas_nonnegative_check CHECK (used_bytes >= 0 AND reserved_bytes >= 0),
  CONSTRAINT chat_media_quotas_capacity_check CHECK (used_bytes + reserved_bytes <= limit_bytes)
);

ALTER TABLE crm.outbox_jobs
  DROP CONSTRAINT outbox_jobs_type_check,
  DROP CONSTRAINT outbox_jobs_target_check,
  ADD COLUMN chat_media_id uuid REFERENCES crm.chat_media (id) ON DELETE RESTRICT,
  ADD CONSTRAINT outbox_jobs_type_check CHECK (job_type IN (
    'channel_event.process', 'media.delete', 'channel_message.send',
    'n8n.command.deliver', 'chat_media.process'
  )),
  ADD CONSTRAINT outbox_jobs_target_check CHECK (
    (job_type = 'channel_event.process' AND channel_event_id IS NOT NULL
      AND transient_media_id IS NULL AND message_id IS NULL
      AND n8n_command_id IS NULL AND chat_media_id IS NULL AND deletion_reason IS NULL)
    OR (job_type = 'media.delete' AND channel_event_id IS NULL
      AND transient_media_id IS NOT NULL AND message_id IS NULL
      AND n8n_command_id IS NULL AND chat_media_id IS NULL
      AND deletion_reason IN ('expired', 'journey_terminal'))
    OR (job_type = 'channel_message.send' AND channel_event_id IS NULL
      AND transient_media_id IS NULL AND message_id IS NOT NULL
      AND n8n_command_id IS NULL AND chat_media_id IS NULL AND deletion_reason IS NULL)
    OR (job_type = 'n8n.command.deliver' AND channel_event_id IS NULL
      AND transient_media_id IS NULL AND n8n_command_id IS NOT NULL
      AND chat_media_id IS NULL AND deletion_reason IS NULL)
    OR (job_type = 'chat_media.process' AND channel_event_id IS NULL
      AND transient_media_id IS NULL AND message_id IS NULL
      AND n8n_command_id IS NULL AND chat_media_id IS NOT NULL AND deletion_reason IS NULL)
  );

CREATE UNIQUE INDEX outbox_jobs_chat_media_process_key ON crm.outbox_jobs (chat_media_id)
  WHERE job_type = 'chat_media.process';
