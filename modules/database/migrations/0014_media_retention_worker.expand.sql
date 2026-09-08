UPDATE crm.outbox_jobs
SET queue = 'media-retention', updated_at = now()
WHERE job_type = 'media.delete'
  AND status IN ('pending', 'retry');
