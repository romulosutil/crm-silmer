-- ADR 032 / CP-11..14: explicit topics within a channel cycle. A topic can
-- point to one attendance order, while messages may refer to many topics.
-- No free-text topic title is persisted: the UI derives it from the order
-- number or the ordinal for an unrelated topic.
CREATE TABLE crm.conversation_subjects (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES crm.conversations(id),
  contact_id text NOT NULL REFERENCES crm.contacts(id),
  order_id text REFERENCES crm.orders(id),
  kind text NOT NULL CHECK (kind IN ('pedido', 'geral')),
  position integer NOT NULL CHECK (position > 0),
  is_current boolean NOT NULL DEFAULT false,
  selected_source text CHECK (selected_source IN ('human', 'agent')),
  selected_by text,
  selected_at timestamptz,
  created_by text NOT NULL,
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('human', 'agent')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT conversation_subject_kind_order CHECK (
    (kind = 'pedido' AND order_id IS NOT NULL)
    OR (kind = 'geral' AND order_id IS NULL)
  ),
  CONSTRAINT conversation_subject_selection CHECK (
    (is_current AND selected_source IS NOT NULL AND selected_at IS NOT NULL)
    OR (NOT is_current)
  ),
  UNIQUE (conversation_id, position),
  UNIQUE (id, conversation_id)
);

CREATE UNIQUE INDEX conversation_subject_one_current
  ON crm.conversation_subjects(conversation_id) WHERE is_current;
CREATE UNIQUE INDEX conversation_subject_one_per_order
  ON crm.conversation_subjects(conversation_id, order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX conversation_subject_contact_order
  ON crm.conversation_subjects(contact_id, order_id);

ALTER TABLE crm.messages ADD CONSTRAINT messages_id_conversation_unique
  UNIQUE (id, conversation_id);

CREATE TABLE crm.message_subject_links (
  message_id text NOT NULL,
  subject_id text NOT NULL,
  conversation_id text NOT NULL,
  assigned_by text NOT NULL,
  assigned_by_kind text NOT NULL CHECK (assigned_by_kind IN ('human', 'agent')),
  assigned_at timestamptz NOT NULL,
  PRIMARY KEY (message_id, subject_id),
  FOREIGN KEY (message_id, conversation_id)
    REFERENCES crm.messages(id, conversation_id),
  FOREIGN KEY (subject_id, conversation_id)
    REFERENCES crm.conversation_subjects(id, conversation_id)
);
CREATE INDEX message_subject_links_subject
  ON crm.message_subject_links(subject_id, message_id);

CREATE TABLE crm.subject_commands (
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  actor_id text NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (operation, idempotency_key)
);
