ALTER TABLE crm.sessions DROP COLUMN IF EXISTS mfa_verified;
DROP TABLE IF EXISTS crm.mfa_recovery_codes;
DROP TABLE IF EXISTS crm.mfa_factors;
