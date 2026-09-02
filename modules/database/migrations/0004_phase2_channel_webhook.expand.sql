CREATE TABLE crm.webhook_receipts (
  id text PRIMARY KEY,
  provider text NOT NULL,
  payload_sha256 text NOT NULL,
  payload_envelope jsonb,
  key_version smallint NOT NULL,
  received_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  purged_at timestamptz,
  correlation_id text NOT NULL,
  CONSTRAINT webhook_receipts_external_payload_key
    UNIQUE (provider, payload_sha256),
  CONSTRAINT webhook_receipts_provider_check
    CHECK (
      provider = lower(provider)
      AND octet_length(provider) BETWEEN 1 AND 64
    ),
  CONSTRAINT webhook_receipts_payload_sha256_check
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT webhook_receipts_key_version_check CHECK (key_version = 1),
  CONSTRAINT webhook_receipts_payload_envelope_check
    CHECK (
      (
        payload_envelope IS NOT NULL
        AND purged_at IS NULL
        AND jsonb_typeof(payload_envelope) = 'object'
        AND payload_envelope ->> 'algorithm' = 'AES-256-GCM'
        AND payload_envelope ->> 'keyVersion' = key_version::text
        AND payload_envelope ->> 'version' = '1'
      )
      OR (
        payload_envelope IS NULL
        AND purged_at IS NOT NULL
        AND purged_at >= received_at
      )
    ),
  CONSTRAINT webhook_receipts_expiry_check
    CHECK (
      expires_at > received_at
      AND expires_at <= received_at + interval '30 days'
    ),
  CONSTRAINT webhook_receipts_correlation_check
    CHECK (octet_length(correlation_id) BETWEEN 1 AND 128)
);

CREATE INDEX webhook_receipts_expiry_idx
  ON crm.webhook_receipts (expires_at)
  WHERE payload_envelope IS NOT NULL;

CREATE TABLE crm.channel_events (
  id text PRIMARY KEY,
  webhook_receipt_id text NOT NULL
    REFERENCES crm.webhook_receipts (id) ON DELETE RESTRICT,
  provider text NOT NULL,
  channel text NOT NULL,
  provider_account_id text NOT NULL,
  external_event_id text NOT NULL,
  external_message_id text NOT NULL,
  message_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  fingerprint text NOT NULL,
  event_envelope jsonb NOT NULL,
  event_key_version smallint NOT NULL,
  received_at timestamptz NOT NULL,
  disposition text NOT NULL,
  processing_status text NOT NULL,
  correlation_id text NOT NULL,
  CONSTRAINT channel_events_external_identity_key
    UNIQUE (provider, provider_account_id, external_event_id),
  CONSTRAINT channel_events_provider_check
    CHECK (
      provider = lower(provider)
      AND octet_length(provider) BETWEEN 1 AND 64
    ),
  CONSTRAINT channel_events_channel_check
    CHECK (channel IN ('instagram', 'whatsapp')),
  CONSTRAINT channel_events_provider_account_check
    CHECK (octet_length(provider_account_id) BETWEEN 1 AND 512),
  CONSTRAINT channel_events_external_event_check
    CHECK (octet_length(external_event_id) BETWEEN 1 AND 512),
  CONSTRAINT channel_events_external_message_check
    CHECK (octet_length(external_message_id) BETWEEN 1 AND 512),
  CONSTRAINT channel_events_message_type_check
    CHECK (
      message_type IN (
        'audio',
        'document',
        'image',
        'text',
        'unsupported',
        'video'
      )
    ),
  CONSTRAINT channel_events_fingerprint_check
    CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT channel_events_event_key_version_check
    CHECK (event_key_version = 1),
  CONSTRAINT channel_events_event_envelope_check
    CHECK (
      jsonb_typeof(event_envelope) = 'object'
      AND event_envelope ->> 'algorithm' = 'AES-256-GCM'
      AND event_envelope ->> 'keyVersion' = event_key_version::text
      AND event_envelope ->> 'version' = '1'
    ),
  CONSTRAINT channel_events_disposition_check
    CHECK (disposition IN ('process', 'reconciliation')),
  CONSTRAINT channel_events_processing_status_check
    CHECK (
      (disposition = 'process' AND processing_status = 'pending')
      OR (
        disposition = 'reconciliation'
        AND processing_status = 'reconciliation'
      )
    ),
  CONSTRAINT channel_events_correlation_check
    CHECK (octet_length(correlation_id) BETWEEN 1 AND 128)
);

CREATE INDEX channel_events_pending_idx
  ON crm.channel_events (received_at, id)
  WHERE processing_status = 'pending';

CREATE TABLE crm.transient_media (
  id text PRIMARY KEY,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  external_media_id text NOT NULL,
  media_type text NOT NULL,
  declared_mime_type text,
  provider_sha256 text,
  metadata_fingerprint text NOT NULL,
  first_received_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  availability_status text NOT NULL DEFAULT 'metadata_only',
  CONSTRAINT transient_media_external_identity_key
    UNIQUE (provider, provider_account_id, external_media_id),
  CONSTRAINT transient_media_provider_check
    CHECK (
      provider = lower(provider)
      AND octet_length(provider) BETWEEN 1 AND 64
    ),
  CONSTRAINT transient_media_provider_account_check
    CHECK (octet_length(provider_account_id) BETWEEN 1 AND 512),
  CONSTRAINT transient_media_external_id_check
    CHECK (octet_length(external_media_id) BETWEEN 1 AND 512),
  CONSTRAINT transient_media_type_check
    CHECK (media_type IN ('audio', 'document', 'image', 'video')),
  CONSTRAINT transient_media_mime_check
    CHECK (
      declared_mime_type IS NULL
      OR octet_length(declared_mime_type) BETWEEN 1 AND 255
    ),
  CONSTRAINT transient_media_provider_sha256_check
    CHECK (
      provider_sha256 IS NULL
      OR octet_length(provider_sha256) BETWEEN 1 AND 128
    ),
  CONSTRAINT transient_media_metadata_fingerprint_check
    CHECK (metadata_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT transient_media_expiry_check
    CHECK (expires_at <= first_received_at + interval '7 days'),
  CONSTRAINT transient_media_metadata_only_check
    CHECK (availability_status = 'metadata_only')
);

CREATE INDEX transient_media_expiry_idx
  ON crm.transient_media (expires_at, id);

CREATE TABLE crm.channel_event_media (
  channel_event_id text NOT NULL
    REFERENCES crm.channel_events (id) ON DELETE RESTRICT,
  transient_media_id text NOT NULL
    REFERENCES crm.transient_media (id) ON DELETE RESTRICT,
  PRIMARY KEY (channel_event_id, transient_media_id)
);

CREATE TABLE crm.outbox_jobs (
  id text PRIMARY KEY,
  job_type text NOT NULL,
  idempotency_key text NOT NULL,
  channel_event_id text NOT NULL
    REFERENCES crm.channel_events (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 100,
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT outbox_jobs_idempotency_key UNIQUE (job_type, idempotency_key),
  CONSTRAINT outbox_jobs_channel_event_key UNIQUE (channel_event_id),
  CONSTRAINT outbox_jobs_type_check CHECK (job_type = 'channel_event.process'),
  CONSTRAINT outbox_jobs_status_check CHECK (status = 'pending'),
  CONSTRAINT outbox_jobs_idempotency_value_check
    CHECK (octet_length(idempotency_key) BETWEEN 1 AND 2048),
  CONSTRAINT outbox_jobs_priority_check CHECK (priority >= 0)
);

CREATE INDEX outbox_jobs_pending_idx
  ON crm.outbox_jobs (priority, available_at, id)
  WHERE status = 'pending';
