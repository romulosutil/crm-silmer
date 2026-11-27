-- CAR-02: production progress is independent of commercial status and payment.
-- Null deliberately preserves an unknown stage on existing orders.
ALTER TABLE crm.orders ADD COLUMN production_stage text;

ALTER TABLE crm.orders ADD CONSTRAINT orders_production_stage_check
  CHECK (production_stage IS NULL OR (
    production_stage IN ('arte', 'producao', 'pronto') AND origin = 'atendimento'
  ));
