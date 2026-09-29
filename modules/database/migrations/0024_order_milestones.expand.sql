-- ADR 008: the order keeps a trail of its days. Two of them already exist
-- (order_date, set on confirmation, and the confirmed delivery inside the
-- encrypted ficha); this adds the other three.
--
-- first_contact_at is copied from the conversation at creation, so the order
-- keeps it even if the conversation changes later. paid_on and delivered_on
-- are typed by a person and never move the status (ADR 006, PCL-08).
--
-- Every column is nullable: an API still running the previous release keeps
-- creating orders during the rollout, and those simply show no first contact.

ALTER TABLE crm.orders
  ADD COLUMN first_contact_at timestamptz,
  ADD COLUMN paid_on date,
  ADD COLUMN delivered_on date;

-- Orders created before this migration take the same value new orders copy.
UPDATE crm.orders AS orders
SET first_contact_at = conversation.opened_at
FROM crm.conversations AS conversation
WHERE conversation.id = orders.conversation_id
  AND orders.first_contact_at IS NULL;
