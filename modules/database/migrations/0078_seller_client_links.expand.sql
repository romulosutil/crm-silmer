-- WAP-E03 / WAP-T02-01: a portfolio is independent of the channel and its
-- generation. No historical contacts are assigned by this expansion.
-- WAP-07/21/24: preserve the legacy common universe without publishing a new
-- private portfolio contact after its last link is revoked. No inferred backfill.
ALTER TABLE crm.contacts ADD COLUMN wallet_created boolean NOT NULL DEFAULT false;

CREATE TABLE crm.contact_change_reviews (
  contact_id text NOT NULL REFERENCES crm.contacts(id) ON DELETE RESTRICT,
  contact_version bigint NOT NULL CHECK(contact_version > 0),
  actor_id text NOT NULL REFERENCES crm.users(id) ON DELETE RESTRICT,
  reason_envelope jsonb NOT NULL CHECK(jsonb_typeof(reason_envelope)='object'
    AND reason_envelope->>'algorithm'='AES-256-GCM'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(contact_id,contact_version)
);
CREATE TRIGGER contact_change_reviews_immutable BEFORE UPDATE OR DELETE
  ON crm.contact_change_reviews FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TABLE crm.seller_client_links (
  id uuid PRIMARY KEY,
  seller_id text NOT NULL REFERENCES crm.users(id) ON DELETE RESTRICT,
  contact_id text NOT NULL REFERENCES crm.contacts(id) ON DELETE RESTRICT,
  provenance text NOT NULL CHECK(provenance IN
    ('manual_create','explicit_link','commercial_order','personal_inbound','personal_outbound')),
  source_id text CHECK(source_id IS NULL OR octet_length(source_id) BETWEEN 1 AND 128),
  status text NOT NULL CHECK(status IN ('active','revoked')),
  version bigint NOT NULL CHECK(version > 0),
  created_by text NOT NULL REFERENCES crm.users(id) ON DELETE RESTRICT,
  updated_by text NOT NULL REFERENCES crm.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK(updated_at >= created_at),
  revoked_at timestamptz,
  UNIQUE(seller_id,contact_id),
  CHECK((status='active' AND revoked_at IS NULL) OR
        (status='revoked' AND revoked_at IS NOT NULL)),
  CHECK(provenance NOT IN ('commercial_order','personal_inbound','personal_outbound') OR source_id IS NOT NULL)
);
CREATE INDEX seller_client_links_contact_active
  ON crm.seller_client_links(contact_id,seller_id) WHERE status='active';
CREATE INDEX seller_client_links_seller_active
  ON crm.seller_client_links(seller_id,contact_id) WHERE status='active';

CREATE TABLE crm.seller_client_scope_versions (
  seller_id text PRIMARY KEY REFERENCES crm.users(id) ON DELETE RESTRICT,
  version bigint NOT NULL CHECK(version > 0)
);

CREATE TABLE crm.seller_client_link_history (
  link_id uuid NOT NULL REFERENCES crm.seller_client_links(id) ON DELETE RESTRICT,
  version bigint NOT NULL CHECK(version > 0),
  status text NOT NULL CHECK(status IN ('active','revoked')),
  actor_id text NOT NULL REFERENCES crm.users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY(link_id,version)
);

-- Even a future SQL writer serializes sharing with the existing Contact
-- editors. Service lock order is user/capability -> Contact -> link -> event.
CREATE FUNCTION crm.guard_seller_client_link()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'seller client links are retained' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM crm.contacts WHERE id=NEW.contact_id FOR UPDATE;
  IF TG_OP='INSERT' THEN
    IF NEW.version<>1 OR NEW.status<>'active' THEN
      RAISE EXCEPTION 'invalid initial seller client link' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.id<>OLD.id OR NEW.seller_id<>OLD.seller_id OR NEW.contact_id<>OLD.contact_id
      OR NEW.provenance<>OLD.provenance OR NEW.source_id IS DISTINCT FROM OLD.source_id
      OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
      OR NEW.version<>OLD.version+1 OR NEW.status=OLD.status THEN
      RAISE EXCEPTION 'invalid seller client link transition' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER seller_client_link_guard BEFORE INSERT OR UPDATE OR DELETE
  ON crm.seller_client_links FOR EACH ROW EXECUTE FUNCTION crm.guard_seller_client_link();

CREATE FUNCTION crm.record_seller_client_link()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO crm.seller_client_link_history(link_id,version,status,actor_id,occurred_at)
    VALUES(NEW.id,NEW.version,NEW.status,NEW.updated_by,NEW.updated_at);
  INSERT INTO crm.seller_client_scope_versions(seller_id,version)
    VALUES(NEW.seller_id,1)
    ON CONFLICT(seller_id) DO UPDATE SET version=crm.seller_client_scope_versions.version+1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER seller_client_link_record AFTER INSERT OR UPDATE
  ON crm.seller_client_links FOR EACH ROW EXECUTE FUNCTION crm.record_seller_client_link();
CREATE TRIGGER seller_client_link_history_immutable BEFORE UPDATE OR DELETE
  ON crm.seller_client_link_history FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();
