-- T7 / MED-04/06/28: admission survives API crash, independently of media/job.
CREATE TABLE crm.chat_media_admissions (
  id uuid PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES crm.conversations(id) ON DELETE RESTRICT,
  uploaded_by text NOT NULL REFERENCES crm.users(id) ON DELETE RESTRICT,
  upload_command_id text NOT NULL,
  session_hash text NOT NULL CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  bucket_alias text NOT NULL REFERENCES crm.chat_media_quotas(bucket_alias),
  reservation_bytes bigint NOT NULL CHECK (reservation_bytes >= 0),
  state text NOT NULL DEFAULT 'receiving' CHECK (state IN ('receiving','consumed','cleaned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  media_id uuid REFERENCES crm.chat_media(id) ON DELETE RESTRICT,
  CONSTRAINT chat_media_admission_state_check CHECK (
    (state='receiving' AND media_id IS NULL) OR (state='consumed' AND media_id IS NOT NULL AND reservation_bytes=0)
    OR (state='cleaned' AND media_id IS NULL AND reservation_bytes=0)
  )
);
CREATE INDEX chat_media_admissions_session_idx ON crm.chat_media_admissions(session_hash,created_at);
CREATE UNIQUE INDEX chat_media_admissions_receiving_scope_key ON crm.chat_media_admissions(uploaded_by,conversation_id,upload_command_id) WHERE state='receiving';
CREATE INDEX chat_media_admissions_orphan_idx ON crm.chat_media_admissions(created_at,id) WHERE state='receiving';
