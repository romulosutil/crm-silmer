CREATE TABLE crm.authentication_throttles (
  scope text NOT NULL,
  subject_hash text NOT NULL,
  failure_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject_hash),
  CONSTRAINT authentication_throttles_scope_check
    CHECK (scope IN ('account', 'network')),
  CONSTRAINT authentication_throttles_subject_hash_check
    CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT authentication_throttles_failure_count_check
    CHECK (failure_count >= 0),
  CONSTRAINT authentication_throttles_time_order_check
    CHECK (
      updated_at >= window_started_at
      AND (blocked_until IS NULL OR blocked_until > window_started_at)
    ),
  CONSTRAINT authentication_throttles_block_requires_failure_check
    CHECK (blocked_until IS NULL OR failure_count > 0)
);

CREATE INDEX authentication_throttles_blocked_until_idx
  ON crm.authentication_throttles (blocked_until)
  WHERE blocked_until IS NOT NULL;

ALTER TABLE crm.idempotency_records
  ADD CONSTRAINT idempotency_records_completed_response_check
  CHECK (status <> 'completed' OR response IS NOT NULL);
