CREATE TABLE crm.users (
  id text PRIMARY KEY,
  email text NOT NULL CHECK (email = btrim(email) AND email LIKE '%@%'),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  CONSTRAINT users_password_hash_check
    CHECK (password_hash LIKE '$argon2id$%')
);

CREATE UNIQUE INDEX users_email_lower_unique ON crm.users (lower(email));

CREATE TABLE crm.user_functions (
  user_id text PRIMARY KEY REFERENCES crm.users (id) ON DELETE CASCADE,
  function_name text NOT NULL
    CHECK (function_name IN ('Atendimento', 'Vendedor')),
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm.user_capabilities (
  user_id text NOT NULL REFERENCES crm.users (id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (
    capability IN (
      'COMMERCIAL_ADMIN',
      'PRIVACY_OFFICER',
      'TECHNICAL_PRIVACY_EXECUTOR'
    )
  ),
  granted_by text REFERENCES crm.users (id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, capability),
  CONSTRAINT user_capabilities_grant_separation_check
    CHECK (granted_by IS NULL OR granted_by <> user_id)
);

CREATE TABLE crm.sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES crm.users (id) ON DELETE CASCADE,
  csrf_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  mfa_verified boolean NOT NULL DEFAULT false,
  CONSTRAINT sessions_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sessions_csrf_hash_check CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
  CHECK (absolute_expires_at > created_at),
  CHECK (last_seen_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX sessions_active_user_idx
  ON crm.sessions (user_id, absolute_expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE crm.invitations (
  id text PRIMARY KEY,
  email text NOT NULL CHECK (email = btrim(email) AND email LIKE '%@%'),
  function_name text NOT NULL
    CHECK (function_name IN ('Atendimento', 'Vendedor')),
  token_hash text NOT NULL,
  created_by text NOT NULL REFERENCES crm.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT invitations_token_hash_key UNIQUE (token_hash),
  CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE TABLE crm.mfa_factors (
  user_id text PRIMARY KEY REFERENCES crm.users (id) ON DELETE CASCADE,
  encrypted_secret text NOT NULL CHECK (encrypted_secret ~ '^v1\.'),
  last_counter bigint,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  CHECK (last_counter IS NULL OR last_counter >= 0)
);

CREATE TABLE crm.mfa_recovery_codes (
  user_id text NOT NULL REFERENCES crm.mfa_factors (user_id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  PRIMARY KEY (user_id, code_hash),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE TABLE crm.audit_events (
  id text PRIMARY KEY,
  actor_id text NOT NULL CHECK (actor_id <> ''),
  action text NOT NULL CHECK (action <> ''),
  target_type text NOT NULL CHECK (target_type <> ''),
  target_id text NOT NULL CHECK (target_id <> ''),
  version text NOT NULL CHECK (version <> ''),
  reason text NOT NULL CHECK (reason <> ''),
  correlation_id text NOT NULL CHECK (correlation_id <> ''),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_target_idx
  ON crm.audit_events (target_type, target_id, occurred_at);
CREATE INDEX audit_events_correlation_idx
  ON crm.audit_events (correlation_id, occurred_at);

CREATE TABLE crm.idempotency_records (
  scope text NOT NULL CHECK (scope <> ''),
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (actor_id <> ''),
  action text NOT NULL CHECK (action <> ''),
  target_type text NOT NULL CHECK (target_type <> ''),
  target_id text NOT NULL CHECK (target_id <> ''),
  version text NOT NULL CHECK (version <> ''),
  reason text NOT NULL CHECK (reason <> ''),
  correlation_id text NOT NULL CHECK (correlation_id <> ''),
  status text NOT NULL CHECK (status IN ('pending', 'completed')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (scope, idempotency_key),
  CHECK (
    (status = 'pending' AND response IS NULL AND completed_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idempotency_records_correlation_idx
  ON crm.idempotency_records (correlation_id);

CREATE TABLE crm.configuration_versions (
  id text PRIMARY KEY,
  version bigint NOT NULL UNIQUE CHECK (version > 0),
  created_by text NOT NULL REFERENCES crm.users (id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason <> ''),
  values jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuration_versions_values_check CHECK (
    jsonb_typeof(values) = 'object'
    AND values #>> '{pix,keyReference}' LIKE 'secret://%'
    AND values #>> '{pix,maskedKey}' LIKE '%*%'
    AND values #>> '{featureFlags,vendedor_silmer_autonomia_comercial}' = 'false'
  )
);

CREATE TABLE crm.catalog_versions (
  id text PRIMARY KEY,
  number bigint NOT NULL UNIQUE CHECK (number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by text NOT NULL REFERENCES crm.users (id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by text REFERENCES crm.users (id) ON DELETE RESTRICT,
  published_at timestamptz,
  CHECK (
    (status = 'draft' AND published_by IS NULL AND published_at IS NULL)
    OR (status = 'published' AND published_by IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE TABLE crm.catalog_products (
  catalog_version_id text NOT NULL
    REFERENCES crm.catalog_versions (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,32}$'),
  name text NOT NULL CHECK (name = btrim(name) AND name <> ''),
  PRIMARY KEY (catalog_version_id, code)
);

CREATE TABLE crm.catalog_models (
  catalog_version_id text NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,32}$'),
  name text NOT NULL CHECK (name = btrim(name) AND name <> ''),
  product_code text NOT NULL,
  PRIMARY KEY (catalog_version_id, code),
  FOREIGN KEY (catalog_version_id, product_code)
    REFERENCES crm.catalog_products (catalog_version_id, code)
    ON DELETE RESTRICT,
  FOREIGN KEY (catalog_version_id)
    REFERENCES crm.catalog_versions (id)
    ON DELETE CASCADE
);

CREATE TABLE crm.catalog_materials (
  catalog_version_id text NOT NULL
    REFERENCES crm.catalog_versions (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,32}$'),
  name text NOT NULL CHECK (name = btrim(name) AND name <> ''),
  PRIMARY KEY (catalog_version_id, code)
);

CREATE TABLE crm.catalog_techniques (
  catalog_version_id text NOT NULL
    REFERENCES crm.catalog_versions (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,32}$'),
  name text NOT NULL CHECK (name = btrim(name) AND name <> ''),
  PRIMARY KEY (catalog_version_id, code)
);

CREATE FUNCTION crm_meta.reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
  RETURN NULL;
END;
$$;

CREATE TRIGGER audit_events_immutable_rows
  BEFORE UPDATE OR DELETE ON crm.audit_events
  FOR EACH ROW EXECUTE FUNCTION crm_meta.reject_immutable_change();
CREATE TRIGGER audit_events_immutable_truncate
  BEFORE TRUNCATE ON crm.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION crm_meta.reject_immutable_change();
CREATE TRIGGER configuration_versions_immutable_rows
  BEFORE UPDATE OR DELETE ON crm.configuration_versions
  FOR EACH ROW EXECUTE FUNCTION crm_meta.reject_immutable_change();
CREATE TRIGGER configuration_versions_immutable_truncate
  BEFORE TRUNCATE ON crm.configuration_versions
  FOR EACH STATEMENT EXECUTE FUNCTION crm_meta.reject_immutable_change();

CREATE FUNCTION crm_meta.protect_idempotency_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'completed idempotency record is immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'completed idempotency record is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.scope <> OLD.scope
    OR NEW.idempotency_key <> OLD.idempotency_key
    OR NEW.fingerprint <> OLD.fingerprint
    OR NEW.actor_id <> OLD.actor_id
    OR NEW.action <> OLD.action
    OR NEW.target_type <> OLD.target_type
    OR NEW.target_id <> OLD.target_id
    OR NEW.version <> OLD.version
    OR NEW.reason <> OLD.reason
    OR NEW.correlation_id <> OLD.correlation_id
    OR NEW.created_at <> OLD.created_at
    OR NEW.status <> 'completed'
    OR NEW.response IS NULL
    OR NEW.completed_at IS NULL
  THEN
    RAISE EXCEPTION 'idempotency identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER idempotency_records_protect_rows
  BEFORE UPDATE OR DELETE ON crm.idempotency_records
  FOR EACH ROW EXECUTE FUNCTION crm_meta.protect_idempotency_record();
CREATE TRIGGER idempotency_records_immutable_truncate
  BEFORE TRUNCATE ON crm.idempotency_records
  FOR EACH STATEMENT EXECUTE FUNCTION crm_meta.reject_immutable_change();

CREATE FUNCTION crm_meta.protect_catalog_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'catalog versions must start as draft'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published catalog is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.status = 'published' AND (
    NOT EXISTS (
      SELECT 1 FROM crm.catalog_products
      WHERE catalog_version_id = NEW.id
    )
    OR NOT EXISTS (
      SELECT 1 FROM crm.catalog_models
      WHERE catalog_version_id = NEW.id
    )
    OR NOT EXISTS (
      SELECT 1 FROM crm.catalog_materials
      WHERE catalog_version_id = NEW.id
    )
    OR NOT EXISTS (
      SELECT 1 FROM crm.catalog_techniques
      WHERE catalog_version_id = NEW.id
    )
  ) THEN
    RAISE EXCEPTION 'catalog must contain every required group before publish'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER catalog_versions_protect_rows
  BEFORE INSERT OR UPDATE OR DELETE ON crm.catalog_versions
  FOR EACH ROW EXECUTE FUNCTION crm_meta.protect_catalog_version();

CREATE FUNCTION crm_meta.protect_catalog_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_id text;
  version_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    version_id := OLD.catalog_version_id;
  ELSE
    version_id := NEW.catalog_version_id;
  END IF;

  SELECT status INTO version_status
  FROM crm.catalog_versions
  WHERE id = version_id;

  IF version_status = 'published' THEN
    RAISE EXCEPTION 'published catalog is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalog_products_protect_rows
  BEFORE INSERT OR UPDATE OR DELETE ON crm.catalog_products
  FOR EACH ROW EXECUTE FUNCTION crm_meta.protect_catalog_entry();
CREATE TRIGGER catalog_models_protect_rows
  BEFORE INSERT OR UPDATE OR DELETE ON crm.catalog_models
  FOR EACH ROW EXECUTE FUNCTION crm_meta.protect_catalog_entry();
CREATE TRIGGER catalog_materials_protect_rows
  BEFORE INSERT OR UPDATE OR DELETE ON crm.catalog_materials
  FOR EACH ROW EXECUTE FUNCTION crm_meta.protect_catalog_entry();
CREATE TRIGGER catalog_techniques_protect_rows
  BEFORE INSERT OR UPDATE OR DELETE ON crm.catalog_techniques
  FOR EACH ROW EXECUTE FUNCTION crm_meta.protect_catalog_entry();

CREATE TRIGGER catalog_versions_immutable_truncate
  BEFORE TRUNCATE ON crm.catalog_versions
  FOR EACH STATEMENT EXECUTE FUNCTION crm_meta.reject_immutable_change();
CREATE TRIGGER catalog_products_immutable_truncate
  BEFORE TRUNCATE ON crm.catalog_products
  FOR EACH STATEMENT EXECUTE FUNCTION crm_meta.reject_immutable_change();
CREATE TRIGGER catalog_models_immutable_truncate
  BEFORE TRUNCATE ON crm.catalog_models
  FOR EACH STATEMENT EXECUTE FUNCTION crm_meta.reject_immutable_change();
CREATE TRIGGER catalog_materials_immutable_truncate
  BEFORE TRUNCATE ON crm.catalog_materials
  FOR EACH STATEMENT EXECUTE FUNCTION crm_meta.reject_immutable_change();
CREATE TRIGGER catalog_techniques_immutable_truncate
  BEFORE TRUNCATE ON crm.catalog_techniques
  FOR EACH STATEMENT EXECUTE FUNCTION crm_meta.reject_immutable_change();
