-- migrations/002_create_sessions_webhooks.sql
-- Sessions and webhook_logs tables.

CREATE TABLE IF NOT EXISTS sessions (
  id          VARCHAR(64)   PRIMARY KEY,
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data        TEXT          NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ   NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id          BIGSERIAL     PRIMARY KEY,
  event       VARCHAR(128)  NOT NULL,
  url         TEXT          NOT NULL,
  status_code INTEGER,
  attempts    INTEGER       NOT NULL DEFAULT 1,
  success     BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_logs_event_idx ON webhook_logs (event);
CREATE INDEX IF NOT EXISTS webhook_logs_created_at_idx ON webhook_logs (created_at DESC);
