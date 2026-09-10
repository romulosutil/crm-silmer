ALTER TABLE crm.users ADD COLUMN name text;

UPDATE crm.users SET name = split_part(email, '@', 1) WHERE name IS NULL;

ALTER TABLE crm.users
  ALTER COLUMN name SET NOT NULL,
  ADD CONSTRAINT users_name_check CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 120
  );

UPDATE crm.user_functions
  SET function_name = 'Vendedor'
  WHERE function_name <> 'Vendedor';

ALTER TABLE crm.user_functions
  DROP CONSTRAINT user_functions_function_name_check,
  ADD CONSTRAINT user_functions_function_name_check
    CHECK (function_name = 'Vendedor');

UPDATE crm.handoffs
  SET target_role = 'Vendedor'
  WHERE target_role <> 'Vendedor';

ALTER TABLE crm.handoffs
  DROP CONSTRAINT handoffs_target_role_check,
  ADD CONSTRAINT handoffs_target_role_check CHECK (target_role = 'Vendedor');

DROP TRIGGER handoff_history_immutable ON crm.handoff_history;

UPDATE crm.handoff_history
  SET target_role = 'Vendedor'
  WHERE target_role <> 'Vendedor';

ALTER TABLE crm.handoff_history
  DROP CONSTRAINT handoff_history_target_role_check,
  ADD CONSTRAINT handoff_history_target_role_check
    CHECK (target_role = 'Vendedor');

CREATE TRIGGER handoff_history_immutable
BEFORE UPDATE OR DELETE ON crm.handoff_history
FOR EACH ROW EXECUTE FUNCTION crm.reject_deal_history_mutation();

DELETE FROM crm.user_capabilities
  WHERE capability IN ('PRIVACY_OFFICER', 'TECHNICAL_PRIVACY_EXECUTOR');

ALTER TABLE crm.user_capabilities
  DROP CONSTRAINT user_capabilities_capability_check,
  ADD CONSTRAINT user_capabilities_capability_check
    CHECK (capability = 'COMMERCIAL_ADMIN');
