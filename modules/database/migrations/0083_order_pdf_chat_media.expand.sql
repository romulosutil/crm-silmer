-- WAP-T02-09: only the internal order renderer may admit an outbound PDF.
ALTER TABLE crm.chat_media
  DROP CONSTRAINT chat_media_kind_check,
  DROP CONSTRAINT chat_media_origin_check,
  ADD CONSTRAINT chat_media_kind_origin_check CHECK (
    (kind IN ('image','audio','video') AND origin IN ('attachment','recording')) OR
    (kind='document' AND origin='order_pdf' AND declared_mime_type IS NOT DISTINCT FROM 'application/pdf'
      AND detected_mime_type IS NOT DISTINCT FROM 'application/pdf')
  );
