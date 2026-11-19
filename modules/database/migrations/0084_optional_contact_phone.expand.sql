-- Contact details can contain only an email. A manual phone still requires
-- both its lookup hash and encrypted details.
ALTER TABLE crm.contacts
  DROP CONSTRAINT contacts_phone_details_pair,
  ADD CONSTRAINT contacts_phone_details_pair CHECK (
    (contact_phone_hash IS NULL OR (
      contact_phone_hash ~ '^[0-9a-f]{64}$'
      AND (manual_create_key IS NULL OR contact_details_envelope IS NOT NULL)
    ))
    AND (contact_details_envelope IS NULL OR (
      jsonb_typeof(contact_details_envelope) = 'object'
      AND contact_details_envelope ->> 'algorithm' = 'AES-256-GCM'
      AND contact_details_envelope ->> 'version' = '1'
    ) IS TRUE)
  );
