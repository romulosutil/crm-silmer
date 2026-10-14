-- The operator-entered phone is private contact data. It is not proof of a
-- WhatsApp identity and cannot by itself merge two contacts.
ALTER TABLE crm.contacts
  ADD COLUMN contact_phone_hash text,
  ADD COLUMN contact_details_envelope jsonb,
  ADD COLUMN contact_details_key text UNIQUE,
  ADD COLUMN contact_details_actor_id text REFERENCES crm.users(id);

ALTER TABLE crm.contacts
  ADD CONSTRAINT contacts_phone_details_pair CHECK (
    (contact_phone_hash IS NULL AND contact_details_envelope IS NULL)
    OR (contact_phone_hash ~ '^[0-9a-f]{64}$'
        AND (manual_create_key IS NULL OR contact_details_envelope IS NOT NULL)
        AND (contact_details_envelope IS NULL OR (
        jsonb_typeof(contact_details_envelope) = 'object'
        AND contact_details_envelope ->> 'algorithm' = 'AES-256-GCM'
        AND contact_details_envelope ->> 'version' = '1')))
  );

-- Avoid duplicate manually entered contacts without merging them. A channel
-- identity may still need explicit correlation with a manual contact.
CREATE UNIQUE INDEX contacts_manual_phone_unique ON crm.contacts (contact_phone_hash)
  WHERE manual_create_key IS NOT NULL AND contact_phone_hash IS NOT NULL;

-- A contact can have more than one confirmed WhatsApp number. The lookup
-- returns candidates and never joins contacts automatically by this hash.
CREATE TABLE crm.contact_phone_lookup (
  contact_id text NOT NULL REFERENCES crm.contacts(id) ON DELETE RESTRICT,
  identity_id text REFERENCES crm.contact_identities(id) ON DELETE RESTRICT,
  phone_hash text NOT NULL CHECK (phone_hash ~ '^[0-9a-f]{64}$'),
  source text NOT NULL CHECK (source IN ('manual', 'whatsapp')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_phone_lookup_source_identity CHECK (
    (source = 'manual' AND identity_id IS NULL)
    OR (source = 'whatsapp' AND identity_id IS NOT NULL)
  )
);

CREATE INDEX contact_phone_lookup_hash_idx
  ON crm.contact_phone_lookup (phone_hash, contact_id);

CREATE UNIQUE INDEX contact_phone_lookup_manual_key
  ON crm.contact_phone_lookup (contact_id, phone_hash)
  WHERE source = 'manual';

CREATE UNIQUE INDEX contact_phone_lookup_identity_key
  ON crm.contact_phone_lookup (identity_id, phone_hash)
  WHERE source = 'whatsapp';

ALTER TABLE crm.contacts
  ADD CONSTRAINT contacts_details_command_pair CHECK (
    (contact_details_key IS NULL AND contact_details_actor_id IS NULL)
    OR (contact_details_key IS NOT NULL AND contact_details_actor_id IS NOT NULL)
  );
