CREATE TABLE crm.deals (
  id text PRIMARY KEY,
  contact_id text NOT NULL
    REFERENCES crm.contacts (id) ON DELETE RESTRICT,
  source_conversation_id text NOT NULL
    REFERENCES crm.conversations (id) ON DELETE RESTRICT,
  stage text NOT NULL DEFAULT 'produto',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT deals_source_conversation_key UNIQUE (source_conversation_id),
  CONSTRAINT deals_initial_stage_check CHECK (stage = 'produto'),
  CONSTRAINT deals_version_check CHECK (version > 0),
  CONSTRAINT deals_time_check CHECK (updated_at >= created_at)
);

CREATE INDEX deals_contact_timeline_idx
  ON crm.deals (contact_id, created_at DESC, id);
