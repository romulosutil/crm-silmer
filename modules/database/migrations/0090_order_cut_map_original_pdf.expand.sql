-- CAR-10: a durable copy of the issued document. Earlier maps retain their
-- membership and have no copy to download.
ALTER TABLE crm.order_cut_maps ADD COLUMN pdf_envelope jsonb
  CHECK (pdf_envelope IS NULL OR jsonb_typeof(pdf_envelope) = 'object');

CREATE INDEX order_cut_map_orders_map_idx ON crm.order_cut_map_orders (map_number);
