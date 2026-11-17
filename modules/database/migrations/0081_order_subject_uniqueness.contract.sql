-- WAP-T02a-03: apply ONLY after every reader/writer is compatible, flags off.
-- Install both substitutes before removing the preparatory global constraint.
CREATE UNIQUE INDEX orders_one_pending_per_legacy_conversation
  ON crm.orders(conversation_id)
  WHERE status='pendente' AND cancelled_at IS NULL AND origin_subject_id IS NULL;
CREATE UNIQUE INDEX orders_one_pending_per_subject
  ON crm.orders(origin_subject_id)
  WHERE status='pendente' AND cancelled_at IS NULL AND origin_subject_id IS NOT NULL;
DROP INDEX crm.orders_one_pending_per_conversation;
