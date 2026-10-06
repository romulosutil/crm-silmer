-- ADR 021: the art files of an order live in RustFS; this table is the
-- catalog the API reads to list, download and remove them. Up to five
-- reference files plus one final art per order. The original file name may
-- carry customer data, so it lives only inside name_envelope; object keys are
-- opaque and never derived from it.

CREATE TABLE crm.order_files (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES crm.orders(id),
  slot text NOT NULL CHECK (slot IN ('reference', 'final')),
  object_key text NOT NULL UNIQUE,
  thumbnail_key text UNIQUE,
  name_envelope jsonb NOT NULL CHECK (jsonb_typeof(name_envelope) = 'object'),
  extension text NOT NULL CHECK (extension ~ '^[a-z0-9]{2,4}$'),
  content_type text NOT NULL
    CHECK (octet_length(content_type) BETWEEN 3 AND 127),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by text NOT NULL,
  uploaded_at timestamptz NOT NULL
);

-- The final art is one per order; replacing it deletes the previous row in
-- the same transaction. The reference limit is checked under the order lock.
CREATE UNIQUE INDEX order_files_one_final
  ON crm.order_files (order_id) WHERE slot = 'final';
CREATE INDEX order_files_by_order
  ON crm.order_files (order_id, uploaded_at, id);
