ALTER TABLE crm.deal_stage_history
  DROP CONSTRAINT deal_stage_history_kind_check,
  ADD CONSTRAINT deal_stage_history_kind_check CHECK (
    event_kind IN ('created', 'advanced', 'retreated', 'returned', 'lost')
  );

ALTER TABLE crm.catalog_versions
  ADD CONSTRAINT catalog_versions_id_number_key UNIQUE (id, number);

CREATE TABLE crm.deal_qualification (
  deal_id text PRIMARY KEY REFERENCES crm.deals (id) ON DELETE RESTRICT,
  customer_envelope jsonb,
  order_name_envelope jsonb,
  commercial_intent boolean,
  updated_at timestamptz NOT NULL
);

CREATE TABLE crm.deal_items (
  id text PRIMARY KEY,
  deal_id text NOT NULL REFERENCES crm.deals (id) ON DELETE RESTRICT,
  catalog_version_id text REFERENCES crm.catalog_versions (id) ON DELETE RESTRICT,
  catalog_version_number bigint,
  product_code text,
  product_snapshot jsonb,
  model_code text,
  model_snapshot jsonb,
  estimated_quantity integer CHECK (estimated_quantity > 0),
  position integer NOT NULL CHECK (position >= 0),
  UNIQUE (deal_id, position),
  UNIQUE (deal_id, id),
  FOREIGN KEY (catalog_version_id, catalog_version_number)
    REFERENCES crm.catalog_versions (id, number) ON DELETE RESTRICT,
  FOREIGN KEY (catalog_version_id, product_code)
    REFERENCES crm.catalog_products (catalog_version_id, code) ON DELETE RESTRICT,
  FOREIGN KEY (catalog_version_id, model_code)
    REFERENCES crm.catalog_models (catalog_version_id, code) ON DELETE RESTRICT,
  CHECK (
    (catalog_version_id IS NULL AND catalog_version_number IS NULL
      AND product_code IS NULL AND product_snapshot IS NULL
      AND model_code IS NULL AND model_snapshot IS NULL)
    OR
    (catalog_version_id IS NOT NULL AND catalog_version_number IS NOT NULL
      AND product_code IS NOT NULL AND jsonb_typeof(product_snapshot) = 'object'
      AND model_code IS NOT NULL AND jsonb_typeof(model_snapshot) = 'object')
  ),
  CHECK (product_snapshot IS NULL OR product_snapshot ->> 'code' = product_code),
  CHECK (model_snapshot IS NULL OR model_snapshot ->> 'code' = model_code),
  CHECK (model_snapshot IS NULL OR model_snapshot ->> 'productCode' = product_code)
);

CREATE TABLE crm.item_fabrics (
  item_id text NOT NULL REFERENCES crm.deal_items (id) ON DELETE CASCADE,
  material_code text NOT NULL,
  material_snapshot jsonb NOT NULL CHECK (jsonb_typeof(material_snapshot) = 'object'),
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (item_id, position)
);

CREATE TABLE crm.item_piece_colors (
  item_id text NOT NULL REFERENCES crm.deal_items (id) ON DELETE CASCADE,
  field_key text NOT NULL,
  value_envelope jsonb NOT NULL,
  PRIMARY KEY (item_id, field_key)
);

CREATE TABLE crm.grade_lines (
  item_id text NOT NULL REFERENCES crm.deal_items (id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  size_lookup text NOT NULL,
  size_envelope jsonb NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  duplicate_reason_envelope jsonb,
  PRIMARY KEY (item_id, position)
);

CREATE TABLE crm.artwork (
  deal_id text PRIMARY KEY REFERENCES crm.deals (id) ON DELETE RESTRICT,
  status text CHECK (status IN ('ready', 'customer_will_send', 'silmer_will_create', 'not_applicable')),
  responsibility_envelope jsonb,
  catalog_version_id text REFERENCES crm.catalog_versions (id) ON DELETE RESTRICT,
  catalog_version_number bigint,
  technique_code text,
  technique_snapshot jsonb,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (catalog_version_id, catalog_version_number)
    REFERENCES crm.catalog_versions (id, number) ON DELETE RESTRICT,
  CHECK (
    (catalog_version_id IS NULL AND catalog_version_number IS NULL
      AND technique_code IS NULL AND technique_snapshot IS NULL)
    OR
    (catalog_version_id IS NOT NULL AND catalog_version_number IS NOT NULL
      AND technique_code IS NOT NULL AND jsonb_typeof(technique_snapshot) = 'object')
  ),
  CHECK (technique_snapshot IS NULL OR technique_snapshot ->> 'code' = technique_code)
);

CREATE TABLE crm.artwork_locations (
  deal_id text NOT NULL REFERENCES crm.artwork (deal_id) ON DELETE CASCADE,
  id text NOT NULL,
  name_envelope jsonb NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (deal_id, id)
);

CREATE TABLE crm.artwork_files (
  deal_id text NOT NULL REFERENCES crm.artwork (deal_id) ON DELETE CASCADE,
  item_id text NOT NULL,
  location_id text NOT NULL,
  attachment_message_id text NOT NULL,
  attachment_media_id text NOT NULL,
  PRIMARY KEY (deal_id, attachment_message_id, attachment_media_id),
  FOREIGN KEY (deal_id, location_id) REFERENCES crm.artwork_locations (deal_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (deal_id, item_id) REFERENCES crm.deal_items (deal_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (attachment_message_id, attachment_media_id)
    REFERENCES crm.attachments (message_id, transient_media_id) ON DELETE RESTRICT
);

CREATE TABLE crm.artwork_colors (
  deal_id text NOT NULL REFERENCES crm.artwork (deal_id) ON DELETE CASCADE,
  location_id text NOT NULL,
  values_envelope jsonb NOT NULL,
  PRIMARY KEY (deal_id, location_id),
  FOREIGN KEY (deal_id, location_id) REFERENCES crm.artwork_locations (deal_id, id) ON DELETE RESTRICT
);

CREATE TABLE crm.logistics (
  deal_id text PRIMARY KEY REFERENCES crm.deals (id) ON DELETE RESTRICT,
  desired_date date,
  mode text CHECK (mode IN ('delivery', 'pickup')),
  purpose_envelope jsonb,
  purchase_profile_envelope jsonb,
  city_envelope jsonb,
  address_envelope jsonb,
  pickup_location_envelope jsonb,
  updated_at timestamptz NOT NULL
);

CREATE TABLE crm.deal_observations (
  deal_id text NOT NULL REFERENCES crm.deals (id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  value_envelope jsonb NOT NULL,
  PRIMARY KEY (deal_id, position)
);

CREATE TABLE crm.field_assessments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deal_id text NOT NULL REFERENCES crm.deals (id) ON DELETE RESTRICT,
  field_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('preenchido', 'nao_aplicavel', 'pendente', 'divergente')),
  reason_envelope jsonb,
  actor_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('human', 'automation')),
  correlation_id text NOT NULL,
  resulting_version bigint NOT NULL CHECK (resulting_version > 0),
  occurred_at timestamptz NOT NULL,
  CHECK (status <> 'nao_aplicavel' OR reason_envelope IS NOT NULL)
);

CREATE TABLE crm.qualification_changes (
  deal_id text NOT NULL REFERENCES crm.deals (id) ON DELETE RESTRICT,
  resulting_version bigint NOT NULL CHECK (resulting_version > 1),
  reason_code text NOT NULL CHECK (reason_code IN (
    'customer_update', 'correction', 'qualification_review', 'automation_extraction'
  )),
  reason_detail_envelope jsonb,
  fields_fingerprint text NOT NULL CHECK (fields_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (deal_id, resulting_version)
);

CREATE INDEX deal_items_deal_idx ON crm.deal_items (deal_id, position);
CREATE INDEX field_assessments_latest_idx ON crm.field_assessments (deal_id, field_key, id DESC);

CREATE TRIGGER field_assessments_immutable
BEFORE UPDATE OR DELETE ON crm.field_assessments
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TRIGGER field_assessments_no_truncate
BEFORE TRUNCATE ON crm.field_assessments
FOR EACH STATEMENT EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TRIGGER qualification_changes_immutable
BEFORE UPDATE OR DELETE ON crm.qualification_changes
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TRIGGER qualification_changes_no_truncate
BEFORE TRUNCATE ON crm.qualification_changes
FOR EACH STATEMENT EXECUTE FUNCTION crm.reject_deal_history_mutation();
