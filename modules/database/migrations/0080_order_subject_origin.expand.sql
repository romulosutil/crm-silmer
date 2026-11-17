-- WAP-T02a-01: additive preparation; the global pending index stays in place.
ALTER TABLE crm.orders ADD COLUMN origin_subject_id text,
  ADD CONSTRAINT orders_origin_requires_conversation CHECK
    (origin_subject_id IS NULL OR conversation_id IS NOT NULL),
  ADD CONSTRAINT orders_origin_subject_conversation_fk
    FOREIGN KEY (origin_subject_id, conversation_id)
    REFERENCES crm.conversation_subjects(id, conversation_id);
CREATE INDEX orders_origin_subject ON crm.orders(origin_subject_id)
  WHERE origin_subject_id IS NOT NULL;

-- Only an active draft with exactly one proven, same-contact origin qualifies.
-- Confirmed/cancelled history and links in other cycles are never inferred.
UPDATE crm.orders orders SET origin_subject_id=subject.id
FROM crm.conversation_subjects subject
WHERE orders.status='pendente' AND orders.cancelled_at IS NULL
  AND subject.order_id=orders.id
  AND subject.conversation_id=orders.conversation_id
  AND subject.contact_id=orders.contact_id
  AND (SELECT count(*) FROM crm.conversation_subjects linked
       WHERE linked.order_id=orders.id)=1;

CREATE FUNCTION crm.check_order_subject_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origin_subject_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.conversation_subjects subject
    WHERE subject.id=NEW.origin_subject_id AND subject.contact_id=NEW.contact_id
  ) THEN
    RAISE EXCEPTION 'order subject contact mismatch' USING ERRCODE='23503';
  END IF;
  IF TG_OP='UPDATE' AND OLD.origin_subject_id IS NOT NULL
     AND NEW.origin_subject_id IS DISTINCT FROM OLD.origin_subject_id THEN
    RAISE EXCEPTION 'order subject origin is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_subject_contact BEFORE INSERT OR UPDATE ON crm.orders
FOR EACH ROW EXECUTE FUNCTION crm.check_order_subject_contact();

CREATE FUNCTION crm.check_subject_origin_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM crm.orders orders WHERE orders.origin_subject_id=OLD.id
    AND (orders.contact_id IS DISTINCT FROM NEW.contact_id
      OR NEW.order_id IS DISTINCT FROM orders.id)) THEN
    RAISE EXCEPTION 'subject preserves order origin' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER subjects_preserve_order_origin BEFORE UPDATE ON crm.conversation_subjects
FOR EACH ROW EXECUTE FUNCTION crm.check_subject_origin_contact();
