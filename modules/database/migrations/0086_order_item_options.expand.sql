-- RFC 076 / ADR 100. Shared labels explicitly added in the attendance editor.
CREATE TABLE crm.order_item_options (
  kind text NOT NULL CHECK (kind IN ('color', 'fabric', 'size')),
  option_key text NOT NULL CHECK (char_length(option_key) BETWEEN 1 AND 80),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  PRIMARY KEY (kind, option_key)
);
