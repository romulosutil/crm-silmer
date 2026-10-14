-- CP-15..18: one encrypted agent briefing per subject. The conversation
-- briefing columns remain for the old workflow until its retirement.
CREATE TABLE crm.subject_briefings (
  subject_id text PRIMARY KEY REFERENCES crm.conversation_subjects(id),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  envelope jsonb,
  legacy_conversation_id text,
  updated_at timestamptz,
  CONSTRAINT subject_briefings_envelope_version CHECK (
    (version = 0 AND envelope IS NULL AND updated_at IS NULL)
    OR (version > 0 AND envelope IS NOT NULL AND updated_at IS NOT NULL)
  )
);

-- A ciphertext copied from the conversation still uses its original AAD.
-- The reader uses legacy_conversation_id until the next subject write
-- re-encrypts it under the subject AAD; SQL never decrypts PII.
INSERT INTO crm.subject_briefings
  (subject_id, version, envelope, legacy_conversation_id, updated_at)
SELECT subject.id, conversation.briefing_version,
       conversation.briefing_envelope, conversation.id,
       conversation.briefing_updated_at
FROM crm.conversation_subjects AS subject
JOIN crm.conversations AS conversation ON conversation.id = subject.conversation_id
JOIN crm.orders AS orders ON orders.id = subject.order_id
WHERE (subject.is_current OR NOT EXISTS (
    SELECT 1 FROM crm.conversation_subjects AS selected
    WHERE selected.conversation_id = subject.conversation_id
      AND selected.is_current
  )) AND orders.status = 'pendente'
  AND orders.conversation_id = conversation.id
  AND conversation.briefing_envelope IS NOT NULL;

CREATE TABLE crm.agent_briefing_projections (
  event_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES crm.orders(id),
  subject_id text NOT NULL REFERENCES crm.conversation_subjects(id),
  projected_at timestamptz NOT NULL
);
