-- WAP-E02 / WAP-T01-02: additive, default-off control metadata. No challenge bytes.
CREATE TABLE crm.seller_whatsapp_lines (
  id uuid PRIMARY KEY,
  seller_id text NOT NULL UNIQUE REFERENCES crm.users(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL UNIQUE,
  instance_name text NOT NULL UNIQUE CHECK(instance_name ~ '^wap_[a-f0-9]{32}$'),
  number_digest text NOT NULL UNIQUE CHECK(number_digest ~ '^[a-f0-9]{64}$'),
  number_envelope jsonb NOT NULL CHECK(jsonb_typeof(number_envelope)='object'
    AND number_envelope->>'algorithm'='AES-256-GCM' AND number_envelope->>'version'='1'),
  confirmed_number_envelope jsonb CHECK(confirmed_number_envelope IS NULL OR
    (jsonb_typeof(confirmed_number_envelope)='object' AND confirmed_number_envelope->>'algorithm'='AES-256-GCM')),
  state text NOT NULL CHECK(state IN ('preparing','awaiting_pairing','validating','connected','disconnected','disconnecting','blocked','unknown')),
  generation bigint NOT NULL CHECK(generation > 0),
  version bigint NOT NULL CHECK(version > 0),
  verified_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(id,generation),
  UNIQUE(id,number_digest),
  UNIQUE(id,seller_id),
  UNIQUE(id,account_id,instance_name),
  CHECK(state<>'connected' OR (confirmed_number_envelope IS NOT NULL AND verified_at IS NOT NULL))
);

-- A disconnected personal line retains this reservation; general and personal
-- reservations share one unique key. No delete/succession in stage one.
CREATE TABLE crm.whatsapp_number_reservations (
  number_digest text PRIMARY KEY CHECK(number_digest ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK(kind IN ('general','personal')),
  line_id uuid UNIQUE REFERENCES crm.seller_whatsapp_lines(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  CHECK((kind='general' AND line_id IS NULL) OR (kind='personal' AND line_id IS NOT NULL)),
  UNIQUE(line_id,number_digest),
  FOREIGN KEY(line_id,number_digest) REFERENCES crm.seller_whatsapp_lines(id,number_digest)
    DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE crm.seller_whatsapp_lines ADD CONSTRAINT seller_whatsapp_number_reserved
  FOREIGN KEY(id,number_digest) REFERENCES crm.whatsapp_number_reservations(line_id,number_digest)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE crm.seller_whatsapp_bindings (
  id uuid PRIMARY KEY,
  line_id uuid NOT NULL REFERENCES crm.seller_whatsapp_lines(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  instance_name text NOT NULL,
  generation bigint NOT NULL CHECK(generation > 0),
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  token_envelope jsonb NOT NULL CHECK(jsonb_typeof(token_envelope)='object'
    AND token_envelope->>'algorithm'='AES-256-GCM'),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE(line_id,generation),
  FOREIGN KEY(line_id,account_id,instance_name) REFERENCES crm.seller_whatsapp_lines(id,account_id,instance_name)
);

CREATE TABLE crm.seller_whatsapp_operations (
  id uuid PRIMARY KEY,
  line_id uuid NOT NULL REFERENCES crm.seller_whatsapp_lines(id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK(generation > 0),
  action text NOT NULL CHECK(action IN ('connect','disconnect')),
  actor_id text NOT NULL REFERENCES crm.users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK(octet_length(idempotency_key) BETWEEN 1 AND 255),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  reference uuid NOT NULL UNIQUE,
  correlation_id text NOT NULL CHECK(octet_length(correlation_id) BETWEEN 1 AND 128),
  state text NOT NULL CHECK(state IN ('pending','dispatching','succeeded','failed_before_effect','unknown','reconciled')),
  reconcile_sequence bigint NOT NULL DEFAULT 0 CHECK(reconcile_sequence >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(actor_id,idempotency_key),
  UNIQUE(id,line_id,generation,actor_id),
  FOREIGN KEY(line_id,actor_id) REFERENCES crm.seller_whatsapp_lines(id,seller_id)
);
CREATE UNIQUE INDEX seller_whatsapp_one_unresolved_operation
  ON crm.seller_whatsapp_operations(line_id) WHERE state IN ('pending','dispatching','unknown');

-- Local revocation is immediate even when an older mutating effect is in
-- flight. A second external mutation waits for a read of that effect.
CREATE TABLE crm.seller_whatsapp_revocations (
  id uuid PRIMARY KEY,
  line_id uuid NOT NULL REFERENCES crm.seller_whatsapp_lines(id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK(generation > 0),
  previous_operation_id uuid NOT NULL REFERENCES crm.seller_whatsapp_operations(id) ON DELETE RESTRICT,
  current_operation_id uuid REFERENCES crm.seller_whatsapp_operations(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES crm.users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK(octet_length(idempotency_key) BETWEEN 1 AND 255),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  correlation_id text NOT NULL CHECK(octet_length(correlation_id) BETWEEN 1 AND 128),
  state text NOT NULL CHECK(state IN ('waiting_reconciliation','queued','completed','superseded')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(actor_id,idempotency_key),
  FOREIGN KEY(line_id,actor_id) REFERENCES crm.seller_whatsapp_lines(id,seller_id)
);
CREATE UNIQUE INDEX seller_whatsapp_one_pending_revocation ON crm.seller_whatsapp_revocations(line_id)
  WHERE state IN ('waiting_reconciliation','queued');

CREATE TABLE crm.seller_whatsapp_challenges (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  operation_id uuid NOT NULL REFERENCES crm.seller_whatsapp_operations(id) ON DELETE RESTRICT,
  line_id uuid NOT NULL REFERENCES crm.seller_whatsapp_lines(id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK(generation > 0),
  actor_id text NOT NULL REFERENCES crm.users(id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK(mode IN ('qr','code')),
  idempotency_key text NOT NULL CHECK(octet_length(idempotency_key) BETWEEN 1 AND 255),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  reference uuid NOT NULL UNIQUE,
  state text NOT NULL CHECK(state IN ('reserved','dispatching','delivered','unknown','resolved','revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(actor_id,idempotency_key),
  CHECK(expires_at > created_at),
  FOREIGN KEY(operation_id,line_id,generation,actor_id)
    REFERENCES crm.seller_whatsapp_operations(id,line_id,generation,actor_id)
);
CREATE UNIQUE INDEX seller_whatsapp_one_live_challenge
  ON crm.seller_whatsapp_challenges(line_id) WHERE state IN ('reserved','dispatching','delivered','unknown');

CREATE TABLE crm.seller_whatsapp_results (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES crm.seller_whatsapp_operations(id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK(generation > 0),
  effect text NOT NULL CHECK(effect IN ('connect','disconnect','reconcile')),
  outcome text NOT NULL CHECK(outcome IN ('succeeded','failed_before_effect','unknown','reconciled')),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  stale boolean NOT NULL,
  occurred_at timestamptz NOT NULL
);

-- Each technical result is tied to a single server-issued dispatch receipt.
CREATE TABLE crm.seller_whatsapp_dispatches (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  operation_id uuid NOT NULL REFERENCES crm.seller_whatsapp_operations(id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK(generation > 0),
  action text NOT NULL CHECK(action IN ('connect','disconnect','reconcile')),
  execution_id text NOT NULL CHECK(octet_length(execution_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL
);
ALTER TABLE crm.seller_whatsapp_results ADD CONSTRAINT seller_whatsapp_result_dispatch
  FOREIGN KEY(id) REFERENCES crm.seller_whatsapp_dispatches(id) ON DELETE RESTRICT;

CREATE FUNCTION crm.guard_seller_whatsapp_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'WHATSAPP_IDENTITY_DURABLE' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='seller_whatsapp_lines' THEN
    IF (NEW.id,NEW.seller_id,NEW.account_id,NEW.instance_name,NEW.number_digest,NEW.number_envelope,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.seller_id,OLD.account_id,OLD.instance_name,OLD.number_digest,OLD.number_envelope,OLD.created_at)
      OR NEW.generation < OLD.generation OR NEW.version <> OLD.version+1 THEN
      RAISE EXCEPTION 'WHATSAPP_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='seller_whatsapp_bindings' THEN
    IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION 'WHATSAPP_BINDING_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='seller_whatsapp_operations' THEN
    IF (to_jsonb(NEW)-ARRAY['state','reconcile_sequence','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','reconcile_sequence','updated_at'])
      OR NEW.reconcile_sequence < OLD.reconcile_sequence THEN
      RAISE EXCEPTION 'WHATSAPP_OPERATION_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='seller_whatsapp_challenges' THEN
    IF (to_jsonb(NEW)-ARRAY['state','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','updated_at']) THEN
      RAISE EXCEPTION 'WHATSAPP_CHALLENGE_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='seller_whatsapp_revocations' THEN
    IF (to_jsonb(NEW)-ARRAY['state','current_operation_id','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','current_operation_id','updated_at'])
      OR (OLD.current_operation_id IS NOT NULL AND NEW.current_operation_id IS DISTINCT FROM OLD.current_operation_id) THEN
      RAISE EXCEPTION 'WHATSAPP_REVOCATION_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER seller_whatsapp_lines_identity BEFORE UPDATE OR DELETE ON crm.seller_whatsapp_lines
  FOR EACH ROW EXECUTE FUNCTION crm.guard_seller_whatsapp_identity();
CREATE TRIGGER seller_whatsapp_bindings_identity BEFORE UPDATE OR DELETE ON crm.seller_whatsapp_bindings
  FOR EACH ROW EXECUTE FUNCTION crm.guard_seller_whatsapp_identity();
CREATE TRIGGER seller_whatsapp_operations_identity BEFORE UPDATE OR DELETE ON crm.seller_whatsapp_operations
  FOR EACH ROW EXECUTE FUNCTION crm.guard_seller_whatsapp_identity();
CREATE TRIGGER seller_whatsapp_challenges_identity BEFORE UPDATE OR DELETE ON crm.seller_whatsapp_challenges
  FOR EACH ROW EXECUTE FUNCTION crm.guard_seller_whatsapp_identity();
CREATE TRIGGER seller_whatsapp_revocations_identity BEFORE UPDATE OR DELETE ON crm.seller_whatsapp_revocations
  FOR EACH ROW EXECUTE FUNCTION crm.guard_seller_whatsapp_identity();
CREATE TRIGGER whatsapp_number_reservations_durable BEFORE UPDATE OR DELETE ON crm.whatsapp_number_reservations
  FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();
CREATE TRIGGER seller_whatsapp_results_durable BEFORE UPDATE OR DELETE ON crm.seller_whatsapp_results
  FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();
CREATE TRIGGER seller_whatsapp_dispatches_durable BEFORE UPDATE OR DELETE ON crm.seller_whatsapp_dispatches
  FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

-- Revocation serializes with dispatch through the user/line locks. A callback
-- can still be recorded, but never restores a revoked generation.
CREATE FUNCTION crm.revoke_seller_whatsapp_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_user text; active_operation uuid;
BEGIN
  IF TG_TABLE_NAME='users' THEN
    IF NEW.disabled_at IS NULL OR NEW.disabled_at IS NOT DISTINCT FROM OLD.disabled_at THEN RETURN NEW; END IF;
    affected_user := NEW.id;
  ELSE
    IF NEW.function_name='Vendedor' OR NEW.function_name IS NOT DISTINCT FROM OLD.function_name THEN RETURN NEW; END IF;
    affected_user := NEW.user_id;
  END IF;
  SELECT o.id INTO active_operation FROM crm.seller_whatsapp_lines l
    JOIN crm.seller_whatsapp_operations o ON o.line_id=l.id AND o.generation=l.generation
    WHERE l.seller_id=affected_user AND l.state IN ('connected','awaiting_pairing','validating')
      AND o.action='connect' AND o.state IN ('succeeded','reconciled')
    ORDER BY o.generation DESC,o.created_at DESC LIMIT 1;
  UPDATE crm.seller_whatsapp_lines SET state='blocked',generation=generation+1,
    version=version+1,updated_at=clock_timestamp() WHERE seller_id=affected_user;
  UPDATE crm.seller_whatsapp_bindings b SET revoked_at=clock_timestamp()
    FROM crm.seller_whatsapp_lines l WHERE l.id=b.line_id AND l.seller_id=affected_user AND b.revoked_at IS NULL;
  UPDATE crm.seller_whatsapp_challenges c SET state='revoked',updated_at=clock_timestamp()
    FROM crm.seller_whatsapp_lines l WHERE l.id=c.line_id AND l.seller_id=affected_user AND c.state<>'revoked';
  UPDATE crm.seller_whatsapp_operations o SET state='failed_before_effect',updated_at=clock_timestamp()
    FROM crm.seller_whatsapp_lines l WHERE l.id=o.line_id AND l.seller_id=affected_user AND o.state='pending'
    AND NOT EXISTS(SELECT 1 FROM crm.seller_whatsapp_revocations r WHERE r.current_operation_id=o.id AND r.state='queued');
  UPDATE crm.seller_whatsapp_operations o SET state='unknown',updated_at=clock_timestamp()
    FROM crm.seller_whatsapp_lines l WHERE l.id=o.line_id AND l.seller_id=affected_user AND o.state IN ('pending','dispatching');
  UPDATE crm.seller_whatsapp_operations SET state='unknown',updated_at=clock_timestamp() WHERE id=active_operation;
  UPDATE crm.seller_whatsapp_revocations r SET state='superseded',updated_at=clock_timestamp()
    FROM crm.seller_whatsapp_lines l WHERE l.id=r.line_id AND l.seller_id=affected_user AND r.state IN ('waiting_reconciliation','queued');
  INSERT INTO crm.seller_whatsapp_revocations(id,line_id,generation,previous_operation_id,actor_id,idempotency_key,fingerprint,correlation_id,state,created_at,updated_at)
    SELECT gen_random_uuid(),l.id,l.generation,o.id,l.seller_id,gen_random_uuid()::text,repeat('0',64),
      gen_random_uuid()::text,'waiting_reconciliation',clock_timestamp(),clock_timestamp()
    FROM crm.seller_whatsapp_lines l JOIN crm.seller_whatsapp_operations o ON o.line_id=l.id
    WHERE l.seller_id=affected_user AND o.state='unknown';
  RETURN NEW;
END $$;
CREATE TRIGGER seller_whatsapp_user_disabled AFTER UPDATE OF disabled_at ON crm.users
  FOR EACH ROW EXECUTE FUNCTION crm.revoke_seller_whatsapp_user();
CREATE TRIGGER seller_whatsapp_user_function AFTER UPDATE OF function_name ON crm.user_functions
  FOR EACH ROW EXECUTE FUNCTION crm.revoke_seller_whatsapp_user();

ALTER TABLE crm.outbox_jobs
  ADD COLUMN whatsapp_operation_id uuid REFERENCES crm.seller_whatsapp_operations(id) ON DELETE RESTRICT,
  ADD COLUMN whatsapp_action text CHECK(whatsapp_action IN ('connect','disconnect','reconcile'));
DO $wap_outbox$
DECLARE previous_type text; previous_target text;
BEGIN
  SELECT pg_get_expr(conbin,conrelid) INTO STRICT previous_type FROM pg_constraint
    WHERE conrelid='crm.outbox_jobs'::regclass AND conname='outbox_jobs_type_check' AND contype='c';
  SELECT pg_get_expr(conbin,conrelid) INTO STRICT previous_target FROM pg_constraint
    WHERE conrelid='crm.outbox_jobs'::regclass AND conname='outbox_jobs_target_check' AND contype='c';
  EXECUTE format($checks$
    ALTER TABLE crm.outbox_jobs DROP CONSTRAINT outbox_jobs_type_check,DROP CONSTRAINT outbox_jobs_target_check,
      ADD CONSTRAINT outbox_jobs_type_check CHECK ((%s) OR job_type IN ('whatsapp.control.deliver','whatsapp.control.reconcile')),
      ADD CONSTRAINT outbox_jobs_target_check CHECK ((whatsapp_operation_id IS NULL AND whatsapp_action IS NULL AND (%s))
        OR (job_type IN ('whatsapp.control.deliver','whatsapp.control.reconcile') AND whatsapp_operation_id IS NOT NULL
          AND channel_event_id IS NULL AND transient_media_id IS NULL AND message_id IS NULL AND n8n_command_id IS NULL
          AND chat_media_id IS NULL AND olist_export_id IS NULL AND deletion_reason IS NULL AND queue='whatsapp_control'
          AND ((job_type='whatsapp.control.deliver' AND whatsapp_action IN ('connect','disconnect') AND effect_policy='manual' AND max_attempts=1)
            OR (job_type='whatsapp.control.reconcile' AND whatsapp_action='reconcile' AND effect_policy='queryable'))))
  $checks$,previous_type,previous_target);
END $wap_outbox$;
