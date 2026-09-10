-- Human-editable contact name. Distinct from contact_identities.display_handle,
-- which is the channel-owned handle (e.g. an Instagram "@handle") and must keep
-- mirroring the provider. Sellers rename the contact here; readers prefer this
-- value and fall back to the channel handle, then the external id.
ALTER TABLE crm.contacts ADD COLUMN display_name text;

ALTER TABLE crm.contacts
  ADD CONSTRAINT contacts_display_name_check CHECK (
    display_name IS NULL
    OR (display_name = btrim(display_name)
        AND char_length(display_name) BETWEEN 1 AND 120)
  );
