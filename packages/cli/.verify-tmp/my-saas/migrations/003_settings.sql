-- Settings: typed key/value per org and per user. JSONB value keeps it flexible
-- without schema churn. One row per (scope, key).
-- PostgreSQL DDL; for SQLite see adjustments in SAAS.md.
CREATE TABLE IF NOT EXISTS org_settings (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

CREATE TABLE IF NOT EXISTS user_settings (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_org_settings  ON org_settings(org_id);
CREATE INDEX IF NOT EXISTS idx_user_settings ON user_settings(user_id);
