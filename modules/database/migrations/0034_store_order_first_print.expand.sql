-- ADR 031: the first print of a site shop order's ficha. A paid store order
-- shows in the Dashboard notice "pedidos novos do site" until someone prints
-- or downloads its ficha for the first time; the print route records who and
-- when, once. Later prints change nothing.
--
-- Both columns are null on every existing row and on every order of the
-- conversation (origin 'atendimento'), so the release before this one keeps
-- reading and writing orders as it did: it names its columns and never
-- touches these. Only a person signs a print, so the author is a user and the
-- account keeps its history (ON DELETE RESTRICT, like the other authors).

ALTER TABLE crm.orders
  ADD COLUMN ficha_first_printed_at timestamptz,
  ADD COLUMN ficha_first_printed_by text
    REFERENCES crm.users (id) ON DELETE RESTRICT;

-- Who and when travel together, and only a store order records them.
ALTER TABLE crm.orders
  ADD CONSTRAINT orders_ficha_first_print_pair
    CHECK ((ficha_first_printed_at IS NULL) = (ficha_first_printed_by IS NULL)),
  ADD CONSTRAINT orders_ficha_first_print_only_in_store
    CHECK (origin = 'loja' OR ficha_first_printed_at IS NULL);
