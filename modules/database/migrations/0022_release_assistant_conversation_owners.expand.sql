-- UI-1 / AGT-03: conversations returned to the assistant cannot retain a
-- human owner. This corrects records written before the invariant was enforced
-- by the conversation mutation.
UPDATE crm.conversations
SET assigned_user_id = NULL,
    version = version + 1
WHERE automation_state = 'assistant'
  AND assigned_user_id IS NOT NULL
  AND terminal_at IS NULL;
