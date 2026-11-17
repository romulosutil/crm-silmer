-- WAP-E04/T02-05: immutable, non-secret origin; content retains message policy.
ALTER TABLE crm.seller_whatsapp_bindings ADD CONSTRAINT seller_whatsapp_binding_generation UNIQUE(id,generation);
CREATE TABLE crm.personal_whatsapp_inbound (
  message_id text PRIMARY KEY REFERENCES crm.messages(id) ON DELETE RESTRICT,
  binding_id uuid NOT NULL,
  generation bigint NOT NULL CHECK(generation>0),
  administrative_pending boolean NOT NULL DEFAULT false,
  FOREIGN KEY(binding_id,generation) REFERENCES crm.seller_whatsapp_bindings(id,generation) ON DELETE RESTRICT
);
CREATE TRIGGER personal_whatsapp_inbound_immutable BEFORE UPDATE OR DELETE
  ON crm.personal_whatsapp_inbound FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();
