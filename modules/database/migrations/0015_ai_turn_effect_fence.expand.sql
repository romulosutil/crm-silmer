ALTER TABLE crm.ai_turns
  ADD COLUMN workflow_key text,
  ADD COLUMN workflow_version text,
  ADD COLUMN effect_state text NOT NULL DEFAULT 'not_started',
  ADD COLUMN effect_command_id text;

UPDATE crm.ai_turns
SET workflow_key = COALESCE(workflow_key, 'legacy-unknown'),
    workflow_version = COALESCE(workflow_version, 'legacy-unknown');

ALTER TABLE crm.ai_turns
  ALTER COLUMN workflow_key SET NOT NULL,
  ALTER COLUMN workflow_version SET NOT NULL,
  ADD CONSTRAINT ai_turns_workflow_check CHECK (
    octet_length(workflow_key) BETWEEN 1 AND 128
    AND octet_length(workflow_version) BETWEEN 1 AND 128
  ),
  ADD CONSTRAINT ai_turns_effect_state_check CHECK (
    effect_state IN (
      'not_started', 'reserved', 'confirmed', 'not_applicable',
      'outcome_unknown'
    )
  ),
  ADD CONSTRAINT ai_turns_effect_command_check CHECK (
    effect_command_id IS NULL
    OR octet_length(effect_command_id) BETWEEN 1 AND 512
  );

CREATE INDEX ai_turns_effect_command_idx
  ON crm.ai_turns (effect_command_id)
  WHERE effect_command_id IS NOT NULL;
