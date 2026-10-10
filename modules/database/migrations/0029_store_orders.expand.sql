-- ADRs 027 and 028: the site shop's paid order. The n8n checkout workflow
-- records it once InfinitePay confirms the Pix, and it is born confirmed by
-- the store actor, without a conversation or a contact (origin 'loja').
-- Every order before this one is an 'atendimento' order and keeps its
-- conversation; the old release keeps reading and writing them.
--
-- The customer's name and phone and the receipt link stay inside the
-- encrypted ficha_envelope. The gateway identifiers (transaction NSU,
-- invoice slug) and the shop's number are not personal data and stay in
-- columns, so a payment is reconciled without decrypting. The receipt keeps
-- the pedido_id (the natural key of a retry), an HMAC of the phone (the list
-- search, never the value) and the hash of the data a retry must repeat.

ALTER TABLE crm.orders
  ADD COLUMN origin text NOT NULL DEFAULT 'atendimento'
    CHECK (origin IN ('atendimento', 'loja')),
  ADD COLUMN is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN store_number text
    CHECK (store_number ~ '^LJ-[0-9A-F]{8}$'),
  ADD COLUMN lead_time_business_days integer
    CHECK (lead_time_business_days BETWEEN 0 AND 365),
  ADD COLUMN payment_source text
    CHECK (payment_source IN ('infinitepay')),
  ADD COLUMN payment_confirmed_at timestamptz,
  ADD COLUMN paid_amount_cents bigint CHECK (paid_amount_cents > 0),
  ADD COLUMN payment_transaction_nsu text
    CHECK (octet_length(payment_transaction_nsu) BETWEEN 1 AND 128),
  ADD COLUMN payment_invoice_slug text
    CHECK (octet_length(payment_invoice_slug) BETWEEN 1 AND 128),
  ALTER COLUMN conversation_id DROP NOT NULL;

-- A store order has no conversation and every other order has one; only a
-- store order is ever a test or carries the shop's fields; and a store order
-- is born confirmed, by Pix, paid in full as InfinitePay confirmed it, and
-- never goes back to pending (locked).
ALTER TABLE crm.orders
  ADD CONSTRAINT orders_origin_conversation
    CHECK ((origin = 'loja') = (conversation_id IS NULL)),
  ADD CONSTRAINT orders_test_only_in_store
    CHECK (origin = 'loja' OR NOT is_test),
  ADD CONSTRAINT orders_store_fields_only_in_store
    CHECK (
      origin = 'loja'
      OR (store_number IS NULL AND lead_time_business_days IS NULL
          AND payment_source IS NULL AND payment_confirmed_at IS NULL
          AND paid_amount_cents IS NULL AND payment_transaction_nsu IS NULL
          AND payment_invoice_slug IS NULL)
    ),
  ADD CONSTRAINT orders_store_paid_by_gateway
    CHECK (
      origin <> 'loja'
      OR (status = 'confirmado' AND payment_condition = 'pix'
          AND paid_on IS NOT NULL AND store_number IS NOT NULL
          AND lead_time_business_days IS NOT NULL
          AND payment_source IS NOT NULL
          AND payment_confirmed_at IS NOT NULL
          AND paid_amount_cents >= final_amount_cents
          AND payment_transaction_nsu IS NOT NULL
          AND payment_invoice_slug IS NOT NULL)
    );

CREATE INDEX orders_origin_updated
  ON crm.orders (origin, updated_at DESC, id DESC);
-- One gateway transaction pays one order. The shop's number is a label
-- (eight hex digits of the pedido_id) that the list search finds; two orders
-- may share it, so it is indexed, not unique.
CREATE UNIQUE INDEX orders_payment_transaction_nsu
  ON crm.orders (payment_source, payment_transaction_nsu)
  WHERE payment_transaction_nsu IS NOT NULL;
CREATE INDEX orders_store_number
  ON crm.orders (store_number)
  WHERE store_number IS NOT NULL;

CREATE TABLE crm.store_order_receipts (
  order_id text PRIMARY KEY REFERENCES crm.orders(id),
  request_id uuid NOT NULL UNIQUE,
  phone_digest text NOT NULL CHECK (phone_digest ~ '^[0-9a-f]{64}$'),
  record_sha256 text NOT NULL CHECK (record_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL
);

-- The order list finds a store order by the HMAC of the phone typed in the
-- search.
CREATE INDEX store_order_receipts_phone
  ON crm.store_order_receipts (phone_digest);
