ALTER TABLE crm.deals
  ADD COLUMN assigned_user_id text REFERENCES crm.users (id) ON DELETE RESTRICT;

ALTER TABLE crm.conversations
  ADD CONSTRAINT conversations_assigned_user_fk
  FOREIGN KEY (assigned_user_id) REFERENCES crm.users (id) ON DELETE RESTRICT
  NOT VALID;

CREATE TABLE crm.deal_assignment_history (
  deal_id text NOT NULL REFERENCES crm.deals (id) ON DELETE RESTRICT,
  resulting_version bigint NOT NULL CHECK (resulting_version > 0),
  previous_user_id text REFERENCES crm.users (id) ON DELETE RESTRICT,
  assigned_user_id text NOT NULL REFERENCES crm.users (id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN (
    'manual_assignment', 'handoff_assignment', 'manual_transfer',
    'customer_requested_human', 'price_before_quote',
    'unresolved_blocker', 'low_confidence'
  )),
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (deal_id, resulting_version)
);

CREATE TABLE crm.handoffs (
  id text PRIMARY KEY,
  deal_id text NOT NULL REFERENCES crm.deals (id) ON DELETE RESTRICT,
  conversation_id text NOT NULL REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  assigned_user_id text NOT NULL REFERENCES crm.users (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'resolved')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  reason_code text NOT NULL CHECK (reason_code IN (
    'customer_requested_human', 'price_before_quote',
    'unresolved_blocker', 'low_confidence'
  )),
  summary_envelope jsonb NOT NULL CHECK (
    jsonb_typeof(summary_envelope) = 'object'
    AND summary_envelope ->> 'algorithm' = 'AES-256-GCM'
    AND summary_envelope ->> 'version' = '1'
  ),
  due_at timestamptz NOT NULL,
  sla_minutes integer NOT NULL CHECK (sla_minutes BETWEEN 5 AND 10080),
  sla_policy_version text NOT NULL,
  automation_workflow_key text,
  automation_workflow_version text,
  automation_execution_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK (due_at > created_at),
  CHECK (updated_at >= created_at),
  CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL)
    OR (status <> 'resolved' AND resolved_at IS NULL)
  ),
  CHECK (
    (automation_workflow_key IS NULL
      AND automation_workflow_version IS NULL
      AND automation_execution_id IS NULL)
    OR
    (automation_workflow_key IS NOT NULL
      AND automation_workflow_version IS NOT NULL
      AND automation_execution_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX handoffs_one_active_per_deal
  ON crm.handoffs (deal_id) WHERE status IN ('pending', 'accepted');
CREATE UNIQUE INDEX handoffs_one_active_per_conversation
  ON crm.handoffs (conversation_id) WHERE status IN ('pending', 'accepted');

CREATE TABLE crm.tasks (
  id text PRIMARY KEY,
  deal_id text NOT NULL REFERENCES crm.deals (id) ON DELETE RESTRICT,
  conversation_id text REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  handoff_id text REFERENCES crm.handoffs (id) ON DELETE RESTRICT,
  assigned_user_id text NOT NULL REFERENCES crm.users (id) ON DELETE RESTRICT,
  task_type text NOT NULL CHECK (task_type IN ('follow_up', 'human_handoff')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  due_at timestamptz NOT NULL,
  text_envelope jsonb NOT NULL CHECK (
    jsonb_typeof(text_envelope) = 'object'
    AND text_envelope ->> 'algorithm' = 'AES-256-GCM'
    AND text_envelope ->> 'version' = '1'
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (due_at > created_at),
  CHECK (updated_at >= created_at),
  CHECK (
    (task_type = 'follow_up' AND handoff_id IS NULL)
    OR
    (task_type = 'human_handoff' AND handoff_id IS NOT NULL AND conversation_id IS NOT NULL)
  ),
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE UNIQUE INDEX tasks_exactly_one_per_handoff
  ON crm.tasks (handoff_id) WHERE handoff_id IS NOT NULL;
CREATE INDEX tasks_active_due_idx
  ON crm.tasks (due_at, id) WHERE status IN ('pending', 'in_progress');

CREATE TABLE crm.task_history (
  task_id text NOT NULL REFERENCES crm.tasks (id) ON DELETE RESTRICT,
  resulting_version bigint NOT NULL CHECK (resulting_version > 0),
  from_status text,
  to_status text NOT NULL CHECK (
    to_status IN ('pending', 'in_progress', 'completed', 'cancelled')
  ),
  actor_id text NOT NULL,
  reason_code text NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (task_id, resulting_version)
);

CREATE TABLE crm.handoff_history (
  handoff_id text NOT NULL REFERENCES crm.handoffs (id) ON DELETE RESTRICT,
  resulting_version bigint NOT NULL CHECK (resulting_version > 0),
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('pending', 'accepted', 'resolved')),
  assigned_user_id text NOT NULL REFERENCES crm.users (id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  reason_code text NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (handoff_id, resulting_version)
);

CREATE TRIGGER deal_assignment_history_immutable
BEFORE UPDATE OR DELETE ON crm.deal_assignment_history
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();
CREATE TRIGGER deal_assignment_history_no_truncate
BEFORE TRUNCATE ON crm.deal_assignment_history
FOR EACH STATEMENT EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TRIGGER task_history_immutable
BEFORE UPDATE OR DELETE ON crm.task_history
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();
CREATE TRIGGER task_history_no_truncate
BEFORE TRUNCATE ON crm.task_history
FOR EACH STATEMENT EXECUTE FUNCTION crm.reject_deal_history_mutation();

CREATE TRIGGER handoff_history_immutable
BEFORE UPDATE OR DELETE ON crm.handoff_history
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();
CREATE TRIGGER handoff_history_no_truncate
BEFORE TRUNCATE ON crm.handoff_history
FOR EACH STATEMENT EXECUTE FUNCTION crm.reject_deal_history_mutation();
