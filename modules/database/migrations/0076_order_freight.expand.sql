-- OLC-T01 / ADR 080 (OLC-05a-j): the order's freight composes the final amount.
-- Expand only: every existing order keeps freight zero, its total, snapshot and
-- settlement; nothing is inferred from a shipping estimate or from a total.
-- Only integer cents, identifiers, an origin and instants are stored: no name,
-- phone, address or free text.
ALTER TABLE crm.orders
  ADD COLUMN freight_cents bigint NOT NULL DEFAULT 0
    CONSTRAINT orders_freight_cents_bounds
    CHECK (freight_cents >= 0 AND freight_cents <= 9007199254740991),
  ADD COLUMN freight_source text
    CONSTRAINT orders_freight_source CHECK (freight_source IN ('seller', 'quote')),
  ADD COLUMN freight_quote_id text,
  ADD COLUMN freight_quote_service_id integer
    CONSTRAINT orders_freight_quote_service CHECK (freight_quote_service_id > 0),
  ADD COLUMN freight_quoted_cents bigint
    CONSTRAINT orders_freight_quoted_bounds
    CHECK (freight_quoted_cents >= 0 AND freight_quoted_cents <= 9007199254740991),
  ADD COLUMN freight_set_by text REFERENCES crm.users(id),
  ADD COLUMN freight_set_at timestamptz,
  -- ADR 080 item 8: the calculation rule is identifiable per order, so history
  -- is never recalculated. 'pieces-v1' is the sum of the size subtotals;
  -- 'pieces-freight-v1' is that sum plus freight_cents.
  ADD COLUMN pricing_rule text NOT NULL DEFAULT 'pieces-v1'
    CONSTRAINT orders_pricing_rule
    CHECK (pricing_rule IN ('pieces-v1', 'pieces-freight-v1')),
  -- Moves with every write of commercially exportable content (ficha, size
  -- pricing, freight, confirmation, reopening, price breakdown, store
  -- correction); payment/delivery milestones, the first print and the
  -- cancellation marker leave it alone.
  ADD COLUMN commercial_revision integer NOT NULL DEFAULT 1
    CONSTRAINT orders_commercial_revision CHECK (commercial_revision > 0),
  ADD CONSTRAINT orders_freight_origin_coherent CHECK (
    (freight_source IS NULL AND freight_cents = 0
      AND freight_quote_id IS NULL AND freight_quote_service_id IS NULL
      AND freight_quoted_cents IS NULL
      AND freight_set_by IS NULL AND freight_set_at IS NULL)
    OR (freight_source = 'seller'
      AND freight_quote_id IS NULL AND freight_quote_service_id IS NULL
      AND freight_quoted_cents IS NULL
      AND freight_set_by IS NOT NULL AND freight_set_at IS NOT NULL)
    OR (freight_source = 'quote'
      AND freight_quote_id IS NOT NULL AND freight_quote_service_id IS NOT NULL
      AND freight_quoted_cents IS NOT NULL AND freight_quoted_cents = freight_cents
      AND freight_set_by IS NOT NULL AND freight_set_at IS NOT NULL)),
  ADD CONSTRAINT orders_freight_needs_rule
    CHECK (freight_cents = 0 OR pricing_rule = 'pieces-freight-v1'),
  -- ADR 080 item 9: the store order's total is the price paid, freight zero.
  ADD CONSTRAINT orders_store_without_freight
    CHECK (origin <> 'loja' OR (freight_cents = 0 AND freight_source IS NULL));

-- Append-only history. 'set' keeps what the seller informed next to what the
-- selected estimate quoted (P1); 'confirmed' freezes pieces, freight, origin
-- and total with author and instant (RULES 10).
CREATE TABLE crm.order_freight_events (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES crm.orders(id),
  order_version integer NOT NULL CHECK (order_version > 0),
  kind text NOT NULL CHECK (kind IN ('set', 'confirmed')),
  pieces_cents bigint CHECK (pieces_cents > 0),
  freight_cents bigint NOT NULL
    CHECK (freight_cents >= 0 AND freight_cents <= 9007199254740991),
  previous_freight_cents bigint CHECK (previous_freight_cents >= 0),
  total_cents bigint CHECK (total_cents > 0),
  source text CHECK (source IN ('seller', 'quote')),
  quote_id text,
  quote_service_id integer CHECK (quote_service_id > 0),
  quoted_cents bigint CHECK (quoted_cents >= 0),
  actor_id text NOT NULL REFERENCES crm.users(id),
  occurred_at timestamptz NOT NULL,
  CONSTRAINT order_freight_events_shape CHECK (
    (kind = 'set' AND source IS NOT NULL AND previous_freight_cents IS NOT NULL)
    OR (kind = 'confirmed' AND pieces_cents IS NOT NULL AND total_cents IS NOT NULL
      AND total_cents = pieces_cents + freight_cents)),
  UNIQUE (order_id, order_version, kind)
);
CREATE TRIGGER order_freight_events_immutable BEFORE UPDATE OR DELETE ON crm.order_freight_events
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

-- ADR 080 items 4 and 14.
-- 1. Freight only changes while the order is and stays pending: confirming,
--    reopening and every write of a confirmed order keep it.
-- 2. Rollback guard: a writer that does not declare the freight-aware rule in
--    its transaction (code from before this migration) cannot change the total,
--    the status or the freight of an order that has freight. It fails closed
--    instead of recalculating the total without freight or reconfirming it.
--    Milestones, billing, cancellation and the first print do not touch those
--    three columns and stay allowed.
CREATE FUNCTION crm.guard_order_freight_pricing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.freight_cents IS DISTINCT FROM OLD.freight_cents
     AND (OLD.status <> 'pendente' OR NEW.status <> 'pendente') THEN
    RAISE EXCEPTION 'ORDER_FREIGHT_FROZEN'
      USING ERRCODE = '23514', CONSTRAINT = 'order_freight_frozen';
  END IF;
  IF (OLD.freight_cents > 0 OR NEW.freight_cents > 0)
     AND (NEW.final_amount_cents, NEW.status, NEW.freight_cents)
       IS DISTINCT FROM (OLD.final_amount_cents, OLD.status, OLD.freight_cents)
     AND current_setting('crm.order_pricing_rule', true)
       IS DISTINCT FROM 'pieces-freight-v1' THEN
    RAISE EXCEPTION 'ORDER_FREIGHT_RULE_REQUIRED'
      USING ERRCODE = '23514', CONSTRAINT = 'order_freight_rule_required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_freight_pricing_guard BEFORE UPDATE ON crm.orders
FOR EACH ROW EXECUTE FUNCTION crm.guard_order_freight_pricing();
