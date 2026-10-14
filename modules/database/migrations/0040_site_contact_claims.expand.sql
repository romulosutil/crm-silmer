-- CP-21/22: site_chat uses a synthetic identity. A visitor-entered number is
-- a private declaration, never a confirmed WhatsApp identity or merge proof.
ALTER TABLE crm.contact_identities
  DROP CONSTRAINT contact_identities_channel_check;
ALTER TABLE crm.contact_identities
  ADD CONSTRAINT contact_identities_channel_check
    CHECK (channel IN ('instagram', 'whatsapp', 'site_chat'));

ALTER TABLE crm.contact_identities
  DROP CONSTRAINT contact_identities_channel_identity_check;
ALTER TABLE crm.contact_identities
  ADD CONSTRAINT contact_identities_channel_identity_check CHECK (
    (channel = 'instagram' AND identity_kind = 'handle' AND phone_status = 'pending')
    OR (channel = 'whatsapp' AND identity_kind = 'phone' AND phone_status = 'confirmed')
    OR (channel = 'site_chat' AND provider = 'site'
        AND identity_kind = 'handle' AND phone_status = 'pending')
  );

CREATE TABLE crm.site_contact_claims (
  id text PRIMARY KEY,
  conversation_id text NOT NULL UNIQUE
    REFERENCES crm.conversations(id) ON DELETE RESTRICT,
  contact_id text NOT NULL REFERENCES crm.contacts(id) ON DELETE RESTRICT,
  phone_hash text NOT NULL CHECK (phone_hash ~ '^[0-9a-f]{64}$'),
  details_envelope jsonb NOT NULL,
  source text NOT NULL DEFAULT 'site_chat' CHECK (source = 'site_chat'),
  source_event_id text NOT NULL CHECK (octet_length(source_event_id) BETWEEN 1 AND 512),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  CONSTRAINT site_contact_claims_envelope_check CHECK (
    jsonb_typeof(details_envelope) = 'object'
    AND details_envelope ->> 'algorithm' = 'AES-256-GCM'
    AND details_envelope ->> 'keyVersion' = '1'
    AND details_envelope ->> 'version' = '1'
  )
);

CREATE INDEX site_contact_claims_phone_idx
  ON crm.site_contact_claims (phone_hash, contact_id);
CREATE INDEX site_contact_claims_contact_updated_idx
  ON crm.site_contact_claims (contact_id, updated_at DESC, id DESC);

CREATE FUNCTION crm.validate_site_contact_claim()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM crm.conversations conversation
    JOIN crm.contact_identities identity
      ON identity.id = conversation.contact_identity_id
    WHERE conversation.id = NEW.conversation_id
      AND identity.current_contact_id = NEW.contact_id
      AND identity.channel = 'site_chat'
      AND identity.provider = 'site'
  ) THEN
    RAISE EXCEPTION 'site contact claim target mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER site_contact_claims_target_guard
BEFORE INSERT OR UPDATE OF conversation_id, contact_id
ON crm.site_contact_claims
FOR EACH ROW EXECUTE FUNCTION crm.validate_site_contact_claim();
