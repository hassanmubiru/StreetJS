-- migrations/001_create_users.sql
-- Create users table with UUID primary key, email unique constraint, indexes.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(320)  NOT NULL,
  name          VARCHAR(100)  NOT NULL,
  password_hash TEXT          NOT NULL,
  roles         JSONB         NOT NULL DEFAULT '["user"]'::jsonb,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
  ON users (LOWER(email));

CREATE INDEX IF NOT EXISTS users_created_at_idx
  ON users (created_at DESC);

-- Trigger: auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION street_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'users_set_updated_at'
  ) THEN
    CREATE TRIGGER users_set_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION street_set_updated_at();
  END IF;
END
$$;
