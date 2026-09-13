-- ADR 006: the Pedido has two statuses, pendente (unofficial draft) and
-- confirmado (official, human-confirmed). It is a new aggregate; nothing here
-- reuses the retired Negócio tables (ADR 004).
--
-- SPEC_DEVIATION: identifiers are text, not uuid as in design.md, because
-- crm.conversations.id and crm.users.id are text and the foreign key must
-- match their type.
--
-- Customer name, phone, address and every other ficha field live only inside
-- the encrypted ficha_envelope. total_pieces and missing_fields are derived
-- columns so the order list never has to decrypt.

-- The number is reserved at creation and never restarts (NN-CRM).
CREATE SEQUENCE crm.order_number_seq START 1;

CREATE TABLE crm.orders (
  id text PRIMARY KEY,
  number_sequence bigint NOT NULL UNIQUE,
  number text NOT NULL UNIQUE,
  conversation_id text NOT NULL REFERENCES crm.conversations(id),
  status text NOT NULL CHECK (status IN ('pendente', 'confirmado')),
  fab_code text NOT NULL,
  ficha_version integer NOT NULL DEFAULT 1 CHECK (ficha_version > 0),
  ficha_envelope jsonb NOT NULL CHECK (jsonb_typeof(ficha_envelope) = 'object'),
  total_pieces integer NOT NULL DEFAULT 0 CHECK (total_pieces >= 0),
  missing_fields text[] NOT NULL DEFAULT '{}',
  final_amount_cents bigint CHECK (final_amount_cents > 0),
  payment_condition text
    CHECK (payment_condition IN ('pix', 'cartao_credito', 'cartao_debito')),
  order_date date,
  confirmed_at timestamptz,
  confirmed_by text,
  reopened_at timestamptz,
  reopened_by text,
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('automation', 'user')),
  created_by text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT orders_number_format CHECK (
    number = lpad(number_sequence::text, 2, '0') || '-CRM'
  ),
  CONSTRAINT orders_confirmed_fields CHECK (
    status <> 'confirmado'
    OR (final_amount_cents IS NOT NULL AND payment_condition IS NOT NULL
        AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL
        AND order_date IS NOT NULL)
  )
);

CREATE UNIQUE INDEX orders_one_pending_per_conversation
  ON crm.orders (conversation_id) WHERE status = 'pendente';
CREATE INDEX orders_status_updated
  ON crm.orders (status, updated_at DESC, id DESC);
CREATE INDEX orders_updated
  ON crm.orders (updated_at DESC, id DESC);
CREATE INDEX orders_conversation
  ON crm.orders (conversation_id, number_sequence DESC);
