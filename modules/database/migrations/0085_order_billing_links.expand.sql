-- LPC-01..08 (RFC 074 / ADR 098): CRM payment link. Nothing exists at the
-- provider before the client clicks Pagar; each click is a new charge attempt
-- through the existing outbox/n8n path. Open links reserve their amount.
CREATE TABLE crm.order_billing_links (
  id uuid PRIMARY KEY,
  created_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  order_id text NOT NULL REFERENCES crm.order_billing_plans(order_id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  token_envelope jsonb NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 100 AND 9007199254740991),
  kind text NOT NULL CHECK (kind IN ('signal','balance','full','installment')),
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open','checkout_requested','checkout_open','unknown','paid','cancelled')),
  origin text NOT NULL CHECK (origin IN ('sent','generated')),
  cancel_reason text CHECK (cancel_reason IN ('seller','order_changed','order_cancelled','external_receipt','reconcile')),
  confirmed_at timestamptz NOT NULL,
  order_amount_cents bigint NOT NULL CHECK (order_amount_cents >= 100),
  payment_condition text NOT NULL,
  created_by text NOT NULL REFERENCES crm.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  page_opened_at timestamptz,
  clicked_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text REFERENCES crm.users(id) ON DELETE RESTRICT,
  paid_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL,
  UNIQUE (id, order_id),
  CHECK ((state = 'cancelled') = (cancel_reason IS NOT NULL)),
  CHECK ((state = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((state = 'paid') = (paid_at IS NOT NULL)),
  CHECK (cancel_reason IS DISTINCT FROM 'seller' OR cancelled_by IS NOT NULL)
);
CREATE INDEX order_billing_links_order ON crm.order_billing_links(order_id, created_sequence);

-- Identity is immutable and the state machine only moves forward: a cancelled
-- or paid link never reopens, so a lost cancel/click race cannot be undone.
CREATE FUNCTION crm.guard_billing_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BILLING_LINK_HISTORY_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  IF (NEW.id, NEW.order_id, NEW.token_hash, NEW.token_envelope, NEW.amount_cents, NEW.kind, NEW.origin,
      NEW.confirmed_at, NEW.order_amount_cents, NEW.payment_condition, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.order_id, OLD.token_hash, OLD.token_envelope, OLD.amount_cents, OLD.kind, OLD.origin,
      OLD.confirmed_at, OLD.order_amount_cents, OLD.payment_condition, OLD.created_by, OLD.created_at)
     OR NEW.version <> OLD.version + 1
     OR (OLD.page_opened_at IS NOT NULL AND NEW.page_opened_at IS DISTINCT FROM OLD.page_opened_at) THEN
    RAISE EXCEPTION 'BILLING_LINK_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'open' AND NEW.state IN ('checkout_requested','cancelled','paid'))
    OR (OLD.state = 'checkout_requested' AND NEW.state IN ('checkout_open','unknown','open','paid'))
    OR (OLD.state = 'checkout_open' AND NEW.state IN ('open','paid'))
    OR (OLD.state = 'unknown' AND NEW.state IN ('checkout_open','open','paid'))
  ) THEN
    RAISE EXCEPTION 'BILLING_LINK_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF OLD.state IN ('paid','cancelled') AND (NEW.state, NEW.cancelled_at, NEW.cancelled_by, NEW.cancel_reason, NEW.paid_at)
     IS DISTINCT FROM (OLD.state, OLD.cancelled_at, OLD.cancelled_by, OLD.cancel_reason, OLD.paid_at) THEN
    RAISE EXCEPTION 'BILLING_LINK_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_billing_links_guard BEFORE UPDATE OR DELETE ON crm.order_billing_links
FOR EACH ROW EXECUTE FUNCTION crm.guard_billing_link();

-- History without PII: identifiers, kind, actor reference and instant only.
CREATE TABLE crm.order_billing_link_events (
  id uuid PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES crm.order_billing_links(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('created','page_opened','clicked','checkout_opened','checkout_unknown',
    'checkout_failed','checkout_expired','paid','cancelled','refund','applied','review')),
  charge_id uuid REFERENCES crm.order_billing_charges(id) ON DELETE RESTRICT,
  actor_id text REFERENCES crm.users(id) ON DELETE RESTRICT,
  reason text CHECK (reason IN ('seller','order_changed','order_cancelled','external_receipt','reconcile')),
  occurred_at timestamptz NOT NULL
);
CREATE INDEX order_billing_link_events_link ON crm.order_billing_link_events(link_id, occurred_at, id);
CREATE TRIGGER order_billing_link_events_immutable BEFORE UPDATE OR DELETE ON crm.order_billing_link_events
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

-- A click is a charge attempt of its link. The single unresolved charge per
-- order (ADR 058) now holds only for legacy charges without a link; a link
-- has at most one unresolved attempt.
ALTER TABLE crm.order_billing_charges
  ADD COLUMN link_id uuid,
  ADD CONSTRAINT billing_charge_link FOREIGN KEY (link_id, order_id)
    REFERENCES crm.order_billing_links(id, order_id) ON DELETE RESTRICT,
  DROP CONSTRAINT order_billing_charges_kind_check,
  ADD CONSTRAINT order_billing_charges_kind_check CHECK (kind IN ('signal','balance','full','installment'));
DROP INDEX crm.order_billing_one_active_charge;
CREATE UNIQUE INDEX order_billing_one_active_charge ON crm.order_billing_charges(order_id)
  WHERE status IN ('queued','creating','waiting','unknown') AND link_id IS NULL;
CREATE UNIQUE INDEX order_billing_one_active_link_charge ON crm.order_billing_charges(link_id)
  WHERE status IN ('queued','creating','waiting','unknown') AND link_id IS NOT NULL;
CREATE INDEX order_billing_charges_link ON crm.order_billing_charges(link_id, created_sequence)
  WHERE link_id IS NOT NULL;
-- Old rows stay valid: a link_id, once written, never changes.
CREATE FUNCTION crm.guard_billing_charge_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.link_id IS DISTINCT FROM OLD.link_id THEN
    RAISE EXCEPTION 'BILLING_CHARGE_LINK_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_billing_charges_link_guard BEFORE UPDATE OF link_id ON crm.order_billing_charges
FOR EACH ROW EXECUTE FUNCTION crm.guard_billing_charge_link();

-- review.reason exposed by the API (RFC 074 point 9). Nullable: rows written
-- before this release derive the reason in the runtime.
ALTER TABLE crm.order_billing_plans
  ADD COLUMN review_reason text CHECK (review_reason IN ('order_changed','refund','outside_agreement','late_payment'));

-- Send a CRM link through the conversation: the intent targets the link, never
-- a provider checkout, so it is composed immediately.
ALTER TABLE crm.order_billing_send_intents
  ADD COLUMN link_id uuid,
  ALTER COLUMN charge_id DROP NOT NULL,
  ADD CONSTRAINT billing_send_link FOREIGN KEY (link_id, order_id)
    REFERENCES crm.order_billing_links(id, order_id) ON DELETE RESTRICT,
  ADD CONSTRAINT billing_send_one_target CHECK ((charge_id IS NULL) <> (link_id IS NULL)),
  DROP CONSTRAINT order_billing_send_intents_action_check,
  ADD CONSTRAINT order_billing_send_intents_action_check
    CHECK (action IN ('issue','send_existing','balance','correct','retry','send_link','issue_link')),
  DROP CONSTRAINT order_billing_send_intents_blocked_reason_check,
  ADD CONSTRAINT order_billing_send_intents_blocked_reason_check
    CHECK (blocked_reason IN ('OWNER_CHANGED','ACTOR_DISABLED','CONVERSATION_CLOSED','AGREEMENT_CHANGED',
      'CHARGE_EXPIRED','PAYMENT_CONFIRMED','INBOUND_CHANGED','SENDING_DISABLED','LINK_CANCELLED'));
CREATE INDEX billing_send_link_target ON crm.order_billing_send_intents(link_id, created_at, id)
  WHERE link_id IS NOT NULL;

CREATE OR REPLACE FUNCTION crm.guard_billing_send_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'BILLING_SEND_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['version','state','blocked_reason','failure_stage','message_id','command_id','updated_at','queued_source_revision'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['version','state','blocked_reason','failure_stage','message_id','command_id','updated_at','queued_source_revision'])
        OR NEW.version <> OLD.version+1
        OR (OLD.queued_source_revision IS NOT NULL AND NEW.queued_source_revision IS DISTINCT FROM OLD.queued_source_revision)
        OR (OLD.message_id IS NOT NULL AND NEW.message_id IS DISTINCT FROM OLD.message_id)
        OR (OLD.command_id IS NOT NULL AND NEW.command_id IS DISTINCT FROM OLD.command_id) THEN
      RAISE EXCEPTION 'BILLING_SEND_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.link_id IS NOT NULL THEN
      SELECT order_id,amount_cents,confirmed_at,order_amount_cents,payment_condition INTO c
        FROM crm.order_billing_links WHERE id=NEW.link_id;
    ELSE
      SELECT order_id,amount_cents,confirmed_at,order_amount_cents,payment_condition INTO c
        FROM crm.order_billing_charges WHERE id=NEW.charge_id;
    END IF;
    IF c.order_id IS DISTINCT FROM NEW.order_id OR c.amount_cents IS DISTINCT FROM NEW.amount_cents
       OR c.confirmed_at IS DISTINCT FROM NEW.confirmed_at OR c.order_amount_cents IS DISTINCT FROM NEW.order_amount_cents
       OR c.payment_condition IS DISTINCT FROM NEW.payment_condition THEN
      RAISE EXCEPTION 'BILLING_SEND_CHARGE_MISMATCH' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- LPC (decision 5): an agreement change cancels links nobody clicked, with
-- history and audit; clicked links keep today's review path.
CREATE OR REPLACE FUNCTION crm.guard_managed_billing_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan crm.order_billing_plans%ROWTYPE; covered bigint; canonical_day date; cancelled record;
BEGIN
  SELECT * INTO plan FROM crm.order_billing_plans WHERE order_id=NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- A cancelled order (ADR 068) keeps no link nobody clicked; clicked attempts
  -- follow the cancelled-order rules (payment kept as unapplied evidence).
  IF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL THEN
    FOR cancelled IN
      UPDATE crm.order_billing_links SET state='cancelled',cancel_reason='order_cancelled',cancelled_at=NEW.cancelled_at,
        version=version+1,updated_at=NEW.updated_at
      WHERE order_id=NEW.id AND state='open' RETURNING id,version
    LOOP
      INSERT INTO crm.order_billing_link_events(id,link_id,kind,reason,occurred_at)
        VALUES(gen_random_uuid(),cancelled.id,'cancelled','order_cancelled',NEW.cancelled_at);
      INSERT INTO crm.audit_events(id,actor_id,action,target_type,target_id,version,reason,correlation_id,occurred_at)
        VALUES(gen_random_uuid()::text,'system:billing','billing.link.cancelled','billing-link',cancelled.id::text,
          cancelled.version::text,'BILLING_LINK_ORDER_CANCELLED','billing-link:'||cancelled.id::text||':'||cancelled.version,NEW.cancelled_at);
    END LOOP;
  END IF;
  IF (NEW.status,NEW.final_amount_cents,NEW.confirmed_at,NEW.payment_condition)
       IS DISTINCT FROM (OLD.status,OLD.final_amount_cents,OLD.confirmed_at,OLD.payment_condition) THEN
    UPDATE crm.order_billing_plans SET review_required=true,review_reason='order_changed',version=version+1,updated_at=NEW.updated_at WHERE order_id=NEW.id;
    UPDATE crm.order_billing_payments p SET application_valid=false
      FROM crm.order_billing_charges c WHERE p.charge_id=c.id AND c.order_id=NEW.id;
    UPDATE crm.order_billing_external_receipts SET application_valid=false WHERE order_id=NEW.id;
    FOR cancelled IN
      UPDATE crm.order_billing_links SET state='cancelled',cancel_reason='order_changed',cancelled_at=NEW.updated_at,
        version=version+1,updated_at=NEW.updated_at
      WHERE order_id=NEW.id AND state='open' RETURNING id,version
    LOOP
      INSERT INTO crm.order_billing_link_events(id,link_id,kind,reason,occurred_at)
        VALUES(gen_random_uuid(),cancelled.id,'cancelled','order_changed',NEW.updated_at);
      INSERT INTO crm.audit_events(id,actor_id,action,target_type,target_id,version,reason,correlation_id,occurred_at)
        VALUES(gen_random_uuid()::text,'system:billing','billing.link.cancelled','billing-link',cancelled.id::text,
          cancelled.version::text,'BILLING_LINK_ORDER_CHANGED','billing-link:'||cancelled.id::text||':'||cancelled.version,NEW.updated_at);
    END LOOP;
    UPDATE crm.order_billing_charges SET status='review',updated_at=NEW.updated_at WHERE order_id=NEW.id AND status <> 'closed';
    NEW.paid_on := NULL; NEW.finance_payment_review_required := true;
    PERFORM crm.invalidate_billing_finance(NEW.id,NEW.version,NEW.updated_at,'BILLING_AGREEMENT_CHANGED');
    RETURN NEW;
  END IF;
  SELECT coalesce(sum(greatest(0,p.applied_amount_cents-p.refunded_amount_cents)),0),max(p.received_on)
  INTO covered,canonical_day FROM crm.order_billing_receipt_ledger p
  WHERE p.order_id=NEW.id AND p.application_valid AND p.applied_amount_cents>p.refunded_amount_cents;
  IF plan.review_required OR NEW.status <> 'confirmado' OR covered < NEW.final_amount_cents THEN canonical_day := NULL; END IF;
  IF NEW.paid_on IS DISTINCT FROM OLD.paid_on AND NEW.paid_on IS DISTINCT FROM canonical_day THEN
    RAISE EXCEPTION 'BILLING_PAYMENT_MANAGED' USING ERRCODE='23514',CONSTRAINT='billing_payment_managed';
  END IF;
  NEW.paid_on := canonical_day; NEW.finance_payment_review_required := plan.review_required;
  IF canonical_day IS NULL AND OLD.paid_on IS NOT NULL THEN
    PERFORM crm.invalidate_billing_finance(NEW.id,NEW.version,NEW.updated_at,'BILLING_SETTLEMENT_INVALIDATED');
  END IF;
  RETURN NEW;
END $$;
