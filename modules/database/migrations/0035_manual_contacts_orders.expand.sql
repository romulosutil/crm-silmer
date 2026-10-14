-- ADR 032: a seller may create a contact and an attendance order before any
-- channel identity or conversation exists. The request key is stored with the
-- entity so a retry after a process crash cannot create another one.
ALTER TABLE crm.contacts
  ADD COLUMN manual_create_key text UNIQUE,
  ADD COLUMN manually_created_by text REFERENCES crm.users(id);

ALTER TABLE crm.contacts
  ADD CONSTRAINT contacts_manual_creation CHECK (
    (manual_create_key IS NULL AND manually_created_by IS NULL)
    OR (manual_create_key IS NOT NULL AND manually_created_by IS NOT NULL
        AND display_name IS NOT NULL AND provisional = false)
  );

ALTER TABLE crm.orders
  ADD COLUMN contact_id text REFERENCES crm.contacts(id),
  ADD COLUMN manual_owner_id text REFERENCES crm.users(id),
  ADD COLUMN manual_create_key text UNIQUE;

UPDATE crm.orders AS orders
SET contact_id = identity.current_contact_id
FROM crm.conversations AS conversation
JOIN crm.contact_identities AS identity
  ON identity.id = conversation.contact_identity_id
WHERE orders.conversation_id = conversation.id
  AND orders.origin = 'atendimento';

ALTER TABLE crm.orders DROP CONSTRAINT orders_origin_conversation;
ALTER TABLE crm.orders ADD CONSTRAINT orders_origin_conversation CHECK (
  (origin = 'loja' AND conversation_id IS NULL AND contact_id IS NULL
    AND manual_owner_id IS NULL AND manual_create_key IS NULL)
  OR
  (origin = 'atendimento' AND conversation_id IS NOT NULL
    AND contact_id IS NOT NULL AND manual_owner_id IS NULL
    AND manual_create_key IS NULL)
  OR
  (origin = 'atendimento' AND conversation_id IS NULL
    AND contact_id IS NOT NULL AND manual_owner_id IS NOT NULL
    AND manual_create_key IS NOT NULL AND created_by_kind = 'user')
);

CREATE INDEX orders_contact_updated
  ON crm.orders (contact_id, updated_at DESC, id DESC)
  WHERE contact_id IS NOT NULL;
