-- API keys: per-organization, hashed at rest. The plaintext key is shown ONCE
-- on creation and never stored. `prefix` allows safe display/lookup.
-- PostgreSQL DDL; for SQLite see adjustments in SAAS.md.
CREATE TABLE IF NOT EXISTS api_keys (
  id           BIGSERIAL PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by   BIGINT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,                 -- e.g. "sk_live_AB12" (display only)
  key_hash     TEXT NOT NULL,                 -- SHA-256 of the full secret
  scopes       JSONB NOT NULL DEFAULT '[]',   -- ["billing:read","members:write"]
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org    ON api_keys(org_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
