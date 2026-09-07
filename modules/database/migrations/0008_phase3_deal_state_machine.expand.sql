ALTER TABLE crm.deals
  DROP CONSTRAINT deals_initial_stage_check,
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN lost_at timestamptz,
  ADD COLUMN loss_reason_envelope jsonb,
  ADD CONSTRAINT deals_stage_check CHECK (
    stage IN ('produto', 'especificacao', 'estampa', 'logistica', 'fechamento')
  ),
  ADD CONSTRAINT deals_status_check CHECK (status IN ('active', 'lost')),
  ADD CONSTRAINT deals_loss_state_check CHECK (
    (status = 'active' AND lost_at IS NULL AND loss_reason_envelope IS NULL)
    OR
    (status = 'lost' AND lost_at IS NOT NULL AND loss_reason_envelope IS NOT NULL)
  );

CREATE TABLE crm.deal_gates (
  deal_id text NOT NULL REFERENCES crm.deals (id) ON DELETE RESTRICT,
  source_version bigint NOT NULL,
  from_stage text NOT NULL,
  blockers jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL,
  PRIMARY KEY (deal_id, source_version),
  CONSTRAINT deal_gates_version_check CHECK (source_version > 0),
  CONSTRAINT deal_gates_stage_check CHECK (
    from_stage IN ('produto', 'especificacao', 'estampa', 'logistica')
  ),
  CONSTRAINT deal_gates_blockers_check CHECK (jsonb_typeof(blockers) = 'array')
);

CREATE TABLE crm.deal_stage_history (
  deal_id text NOT NULL REFERENCES crm.deals (id) ON DELETE RESTRICT,
  resulting_version bigint NOT NULL,
  event_kind text NOT NULL,
  from_stage text,
  to_stage text,
  actor_id text,
  reason text,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (deal_id, resulting_version),
  CONSTRAINT deal_stage_history_version_check CHECK (resulting_version > 0),
  CONSTRAINT deal_stage_history_kind_check CHECK (
    event_kind IN ('created', 'advanced', 'retreated', 'lost')
  )
);

INSERT INTO crm.deal_stage_history
  (deal_id, resulting_version, event_kind, from_stage, to_stage,
   actor_id, reason, occurred_at)
SELECT id, version, 'created', NULL, stage, NULL, NULL, created_at
FROM crm.deals;

CREATE TABLE crm.domain_events (
  id text PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_version bigint NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT domain_events_version_check CHECK (aggregate_version > 0),
  CONSTRAINT domain_events_payload_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT domain_events_aggregate_version_key UNIQUE (
    aggregate_type, aggregate_id, aggregate_version, event_type
  )
);

INSERT INTO crm.domain_events
  (id, aggregate_type, aggregate_id, aggregate_version, event_type,
   payload, correlation_id, occurred_at)
SELECT
  'migration-0008-' || id,
  'deal',
  id,
  version,
  'deal.created',
  jsonb_build_object('stage', stage, 'version', version),
  'migration-0008',
  created_at
FROM crm.deals;

CREATE INDEX domain_events_stream_idx
  ON crm.domain_events (aggregate_type, aggregate_id, aggregate_version);
CREATE INDEX domain_events_delivery_idx
  ON crm.domain_events (occurred_at, id);

CREATE FUNCTION crm.reject_deal_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'deal history is immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER deal_gates_immutable
BEFORE UPDATE OR DELETE ON crm.deal_gates
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TRIGGER deal_stage_history_immutable
BEFORE UPDATE OR DELETE ON crm.deal_stage_history
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TRIGGER domain_events_immutable
BEFORE UPDATE OR DELETE ON crm.domain_events
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TRIGGER deal_gates_no_truncate
BEFORE TRUNCATE ON crm.deal_gates
FOR EACH STATEMENT EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TRIGGER deal_stage_history_no_truncate
BEFORE TRUNCATE ON crm.deal_stage_history
FOR EACH STATEMENT EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TRIGGER domain_events_no_truncate
BEFORE TRUNCATE ON crm.domain_events
FOR EACH STATEMENT EXECUTE FUNCTION crm.reject_deal_history_mutation();
