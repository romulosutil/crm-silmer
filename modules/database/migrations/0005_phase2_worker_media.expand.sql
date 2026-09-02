ALTER TABLE crm.channel_events
  DROP CONSTRAINT channel_events_processing_status_check;

ALTER TABLE crm.channel_events
  ADD CONSTRAINT channel_events_processing_status_check
  CHECK (
    (disposition = 'process' AND processing_status IN (
      'pending', 'processing', 'processed', 'reconciliation'
    ))
    OR (
      disposition = 'reconciliation'
      AND processing_status = 'reconciliation'
    )
  );

ALTER TABLE crm.transient_media
  DROP CONSTRAINT transient_media_metadata_only_check;

ALTER TABLE crm.transient_media
  ADD COLUMN storage_key text,
  ADD COLUMN size_bytes bigint,
  ADD COLUMN content_sha256 text,
  ADD COLUMN detected_mime_type text,
  ADD COLUMN validation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN stored_at timestamptz,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN unavailable_reason text;

ALTER TABLE crm.transient_media
  ADD CONSTRAINT transient_media_availability_check
    CHECK (availability_status IN (
      'metadata_only', 'quarantined', 'available', 'rejected',
      'lost', 'unavailable', 'deleted'
    )),
  ADD CONSTRAINT transient_media_validation_check
    CHECK (validation_status IN (
      'pending', 'clean', 'infected', 'invalid_type',
      'stale_signatures', 'error'
    )),
  ADD CONSTRAINT transient_media_storage_key_check
    CHECK (
      storage_key IS NULL
      OR (
        storage_key ~ '^[0-9a-f-]{36}$'
        AND octet_length(storage_key) = 36
      )
    ),
  ADD CONSTRAINT transient_media_size_check
    CHECK (size_bytes IS NULL OR size_bytes >= 0),
  ADD CONSTRAINT transient_media_content_hash_check
    CHECK (
      content_sha256 IS NULL
      OR content_sha256 ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT transient_media_detected_mime_check
    CHECK (
      detected_mime_type IS NULL
      OR octet_length(detected_mime_type) BETWEEN 1 AND 255
    ),
  ADD CONSTRAINT transient_media_storage_state_check
    CHECK (
      availability_status = 'metadata_only'
      OR availability_status IN ('rejected', 'unavailable', 'deleted')
      OR (
        storage_key IS NOT NULL
        AND size_bytes IS NOT NULL
        AND content_sha256 IS NOT NULL
        AND detected_mime_type IS NOT NULL
        AND stored_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT transient_media_unavailable_reason_check
    CHECK (
      (availability_status IN ('lost', 'unavailable') AND unavailable_reason IS NOT NULL)
      OR (availability_status NOT IN ('lost', 'unavailable'))
    ),
  ADD CONSTRAINT transient_media_deleted_at_check
    CHECK (
      (availability_status = 'deleted' AND deleted_at IS NOT NULL)
      OR (availability_status <> 'deleted' AND deleted_at IS NULL)
    );

CREATE OR REPLACE FUNCTION crm.reject_transient_media_expiry_extension()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'transient media expiry is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transient_media_expiry_immutable
BEFORE UPDATE OF expires_at ON crm.transient_media
FOR EACH ROW EXECUTE FUNCTION crm.reject_transient_media_expiry_extension();

DROP INDEX crm.outbox_jobs_pending_idx;

ALTER TABLE crm.outbox_jobs
  DROP CONSTRAINT outbox_jobs_channel_event_key,
  DROP CONSTRAINT outbox_jobs_type_check,
  DROP CONSTRAINT outbox_jobs_status_check,
  ALTER COLUMN channel_event_id DROP NOT NULL,
  ADD COLUMN transient_media_id text
    REFERENCES crm.transient_media (id) ON DELETE RESTRICT,
  ADD COLUMN queue text NOT NULL DEFAULT 'default',
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 8,
  ADD COLUMN locked_by text,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN effect_policy text NOT NULL DEFAULT 'internal',
  ADD COLUMN last_error_code text,
  ADD COLUMN deletion_reason text;

UPDATE crm.outbox_jobs SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE crm.outbox_jobs
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ADD CONSTRAINT outbox_jobs_type_check
    CHECK (job_type IN ('channel_event.process', 'media.delete')),
  ADD CONSTRAINT outbox_jobs_status_check
    CHECK (status IN (
      'pending', 'processing', 'retry', 'completed',
      'dead_letter', 'outcome_unknown'
    )),
  ADD CONSTRAINT outbox_jobs_target_check
    CHECK (
      (
        job_type = 'channel_event.process'
        AND channel_event_id IS NOT NULL
        AND transient_media_id IS NULL
        AND deletion_reason IS NULL
      )
      OR (
        job_type = 'media.delete'
        AND channel_event_id IS NULL
        AND transient_media_id IS NOT NULL
        AND deletion_reason IN ('expired', 'journey_terminal')
      )
    ),
  ADD CONSTRAINT outbox_jobs_queue_check
    CHECK (octet_length(queue) BETWEEN 1 AND 64),
  ADD CONSTRAINT outbox_jobs_attempts_check
    CHECK (
      attempt_count >= 0
      AND max_attempts BETWEEN 1 AND 100
      AND attempt_count <= max_attempts
    ),
  ADD CONSTRAINT outbox_jobs_effect_policy_check
    CHECK (effect_policy IN ('internal', 'idempotency_key', 'queryable', 'manual')),
  ADD CONSTRAINT outbox_jobs_lock_check
    CHECK (
      (
        status = 'processing'
        AND locked_by IS NOT NULL
        AND locked_until IS NOT NULL
        AND heartbeat_at IS NOT NULL
        AND completed_at IS NULL
      )
      OR (
        status <> 'processing'
        AND locked_by IS NULL
        AND locked_until IS NULL
        AND heartbeat_at IS NULL
      )
    ),
  ADD CONSTRAINT outbox_jobs_completion_check
    CHECK (
      (status IN ('completed', 'dead_letter', 'outcome_unknown') AND completed_at IS NOT NULL)
      OR (status NOT IN ('completed', 'dead_letter', 'outcome_unknown') AND completed_at IS NULL)
    );

CREATE UNIQUE INDEX outbox_jobs_channel_event_process_key
  ON crm.outbox_jobs (channel_event_id)
  WHERE job_type = 'channel_event.process';

CREATE UNIQUE INDEX outbox_jobs_media_delete_key
  ON crm.outbox_jobs (transient_media_id)
  WHERE job_type = 'media.delete';

CREATE INDEX outbox_jobs_claim_idx
  ON crm.outbox_jobs (queue, priority, available_at, id)
  WHERE status IN ('pending', 'retry');

CREATE INDEX outbox_jobs_expired_lease_idx
  ON crm.outbox_jobs (locked_until, id)
  WHERE status = 'processing';

CREATE TABLE crm.processing_attempts (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES crm.outbox_jobs (id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL,
  worker_id text NOT NULL,
  state text NOT NULL,
  provider text,
  started_at timestamptz NOT NULL,
  effect_started_at timestamptz,
  heartbeat_at timestamptz NOT NULL,
  finished_at timestamptz,
  provider_external_id text,
  error_code text,
  retry_safe boolean,
  CONSTRAINT processing_attempts_job_number_key UNIQUE (job_id, attempt_no),
  CONSTRAINT processing_attempts_number_check CHECK (attempt_no > 0),
  CONSTRAINT processing_attempts_worker_check
    CHECK (octet_length(worker_id) BETWEEN 1 AND 128),
  CONSTRAINT processing_attempts_state_check
    CHECK (state IN ('claimed', 'sending', 'sent', 'failed', 'outcome_unknown')),
  CONSTRAINT processing_attempts_time_check
    CHECK (
      effect_started_at IS NULL OR effect_started_at >= started_at
    ),
  CONSTRAINT processing_attempts_terminal_check
    CHECK (
      (state IN ('sent', 'failed', 'outcome_unknown') AND finished_at IS NOT NULL)
      OR (state IN ('claimed', 'sending') AND finished_at IS NULL)
    )
);

CREATE INDEX processing_attempts_job_idx
  ON crm.processing_attempts (job_id, attempt_no DESC);

CREATE TABLE crm.reconciliation_items (
  id text PRIMARY KEY,
  job_id text NOT NULL UNIQUE
    REFERENCES crm.outbox_jobs (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open',
  reason text NOT NULL,
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CONSTRAINT reconciliation_items_status_check
    CHECK (status IN ('open', 'resolved')),
  CONSTRAINT reconciliation_items_reason_check
    CHECK (octet_length(reason) BETWEEN 1 AND 128),
  CONSTRAINT reconciliation_items_resolution_check
    CHECK (
      (status = 'open' AND resolved_at IS NULL)
      OR (status = 'resolved' AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX reconciliation_items_open_idx
  ON crm.reconciliation_items (created_at, id)
  WHERE status = 'open';

CREATE TABLE crm.media_handoff_receipts (
  id text PRIMARY KEY,
  transient_media_id text NOT NULL
    REFERENCES crm.transient_media (id) ON DELETE RESTRICT,
  destination text NOT NULL,
  content_sha256 text NOT NULL,
  operator_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  result text NOT NULL,
  CONSTRAINT media_handoff_destination_check CHECK (destination = 'dropbox'),
  CONSTRAINT media_handoff_hash_check
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT media_handoff_operator_check
    CHECK (octet_length(operator_id) BETWEEN 1 AND 128),
  CONSTRAINT media_handoff_result_check CHECK (result IN (
    'success', 'failure', 'limitation', 'archive_missed'
  )),
  CONSTRAINT media_handoff_once_key
    UNIQUE (transient_media_id, destination, occurred_at)
);
