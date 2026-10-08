-- ADR 027: the site shop's "Já pagou?" notice becomes an order born
-- confirmed by the store actor, without a conversation or a contact
-- (origin 'loja'). Every order before this one is an 'atendimento' order and
-- keeps its conversation; the old release keeps reading and writing them.
--
-- The customer's name and phone stay inside the encrypted ficha_envelope.
-- The receipt keeps only what limits and audits the public route: the
-- request id, the Origin, HMACs of the IP and the phone (never the values)
-- and the hash of the body.

ALTER TABLE crm.orders
  ADD COLUMN origin text NOT NULL DEFAULT 'atendimento'
    CHECK (origin IN ('atendimento', 'loja')),
  ADD COLUMN is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN payment_declared_at timestamptz,
  ALTER COLUMN conversation_id DROP NOT NULL;

-- A store order has no conversation and every other order has one; only a
-- store order is ever a test; and a store order is born confirmed, paid as
-- the customer declared, and never goes back to pending (locked).
ALTER TABLE crm.orders
  ADD CONSTRAINT orders_origin_conversation
    CHECK ((origin = 'loja') = (conversation_id IS NULL)),
  ADD CONSTRAINT orders_test_only_in_store
    CHECK (origin = 'loja' OR NOT is_test),
  ADD CONSTRAINT orders_store_confirmed_and_paid
    CHECK (
      origin <> 'loja'
      OR (status = 'confirmado' AND paid_on IS NOT NULL
          AND payment_declared_at IS NOT NULL)
    );

CREATE INDEX orders_origin_updated
  ON crm.orders (origin, updated_at DESC, id DESC);

CREATE TABLE crm.store_order_receipts (
  order_id text PRIMARY KEY REFERENCES crm.orders(id),
  request_id uuid NOT NULL UNIQUE,
  request_origin text NOT NULL
    CHECK (octet_length(request_origin) BETWEEN 1 AND 255),
  ip_digest text NOT NULL CHECK (ip_digest ~ '^[0-9a-f]{64}$'),
  phone_digest text NOT NULL CHECK (phone_digest ~ '^[0-9a-f]{64}$'),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL
);

-- The per-IP and per-phone limits count receipts in a recent window; the
-- order list finds a store order by the HMAC of the phone typed in search.
CREATE INDEX store_order_receipts_ip
  ON crm.store_order_receipts (ip_digest, received_at);
CREATE INDEX store_order_receipts_phone
  ON crm.store_order_receipts (phone_digest, received_at);
