-- ADR 023: a valid channel file is now attached to the order, kept in RustFS.
-- NOT VALID leaves older receipts as history; every new receipt needs rustfs.
ALTER TABLE crm.media_handoff_receipts
  DROP CONSTRAINT media_handoff_destination_check,
  ADD CONSTRAINT media_handoff_destination_check
    CHECK (destination = 'rustfs') NOT VALID;
