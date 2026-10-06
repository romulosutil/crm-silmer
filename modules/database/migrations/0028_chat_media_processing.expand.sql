-- MED-14/19/26/28/29: preserve the declared MIME separately from detection,
-- and fence overlapping/recovered attempts without changing queue semantics.
ALTER TABLE crm.chat_media
  ADD COLUMN declared_mime_type text CHECK (
    declared_mime_type IS NULL OR octet_length(declared_mime_type) BETWEEN 1 AND 255
  ),
  ADD COLUMN processing_attempt_id text REFERENCES crm.processing_attempts (id) ON DELETE RESTRICT;

ALTER TABLE crm.outbox_jobs ADD CONSTRAINT outbox_jobs_chat_media_policy_check CHECK (
  job_type <> 'chat_media.process' OR (queue = 'chat_media' AND effect_policy = 'internal')
);
