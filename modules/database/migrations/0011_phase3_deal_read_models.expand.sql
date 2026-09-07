ALTER TABLE crm.domain_events ADD COLUMN stream_cursor bigint;

CREATE SEQUENCE crm.domain_event_stream_cursor_seq AS bigint;

WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY occurred_at, id)::bigint AS cursor
  FROM crm.domain_events
)
UPDATE crm.domain_events event
SET stream_cursor = ordered.cursor
FROM ordered
WHERE event.id = ordered.id;

SELECT setval(
  'crm.domain_event_stream_cursor_seq',
  COALESCE((SELECT max(stream_cursor) FROM crm.domain_events), 0) + 1,
  false
);

CREATE FUNCTION crm.assign_domain_event_stream_cursor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- The lock is acquired before nextval and remains held until commit. This
  -- prevents a later cursor from becoming visible before an earlier cursor.
  PERFORM pg_advisory_xact_lock(1935202609);
  NEW.stream_cursor := nextval('crm.domain_event_stream_cursor_seq');
  RETURN NEW;
END;
$$;

CREATE TRIGGER domain_events_assign_stream_cursor
BEFORE INSERT ON crm.domain_events
FOR EACH ROW EXECUTE FUNCTION crm.assign_domain_event_stream_cursor();

ALTER TABLE crm.domain_events
  ALTER COLUMN stream_cursor SET NOT NULL;

ALTER TABLE crm.domain_events
  ADD CONSTRAINT domain_events_stream_cursor_key UNIQUE (stream_cursor);

CREATE INDEX deals_kanban_page_idx
  ON crm.deals (stage, status, updated_at DESC, id DESC);

CREATE INDEX deals_kanban_assignee_page_idx
  ON crm.deals (assigned_user_id, stage, status, updated_at DESC, id DESC);
