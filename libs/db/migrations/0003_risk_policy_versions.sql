-- Signed RiskModule policy documents (ARCHITECTURE.md section 16.1). Append-only: one row per version, never changed
-- or removed. Two independent layers enforce it: the role grants in 0004_roles_and_grants.sql (only the operator
-- role may INSERT, the worker may only SELECT), and the trigger below, which rejects UPDATE, DELETE, and TRUNCATE for
-- every role, the table owner included. `libs/risk` verifies the signatures and the previousHash chain on load; the
-- database does not, because it holds no notion of the trusted signer.

CREATE TABLE risk_policy_versions (
  version      integer PRIMARY KEY CHECK (version > 0),
  -- The 16.1 document, encoded by @monadeum/db with bigints tagged so it round-trips exactly.
  document     jsonb NOT NULL,
  -- The 16.4 hash of the document, which the signature signs.
  policy_hash  text NOT NULL UNIQUE CHECK (policy_hash ~ '^0x[0-9a-f]{64}$'),
  signer       text NOT NULL CHECK (signer ~* '^0x[0-9a-f]{40}$'),
  signature    text NOT NULL CHECK (signature ~* '^0x[0-9a-f]+$'),
  inserted_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((document->>'version')::integer = version)
);

CREATE FUNCTION risk_policy_versions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'risk_policy_versions is append-only: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER risk_policy_versions_no_update_delete
  BEFORE UPDATE OR DELETE ON risk_policy_versions
  FOR EACH ROW EXECUTE FUNCTION risk_policy_versions_append_only();

CREATE TRIGGER risk_policy_versions_no_truncate
  BEFORE TRUNCATE ON risk_policy_versions
  FOR EACH STATEMENT EXECUTE FUNCTION risk_policy_versions_append_only();
