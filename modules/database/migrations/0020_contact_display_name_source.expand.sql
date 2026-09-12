-- A contact name can originate from the guided automation or be confirmed by
-- an operator. Manual edits always take precedence over later AI extraction.
ALTER TABLE crm.contacts
  ADD COLUMN display_name_source text NOT NULL DEFAULT 'manual';

ALTER TABLE crm.contacts
  ADD CONSTRAINT contacts_display_name_source_check CHECK (
    display_name_source IN ('automation', 'manual')
  );
