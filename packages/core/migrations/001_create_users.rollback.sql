-- migrations/001_create_users.rollback.sql
-- Rollback: drop users table and associated objects.

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
DROP FUNCTION IF EXISTS street_set_updated_at();
DROP INDEX IF EXISTS users_email_unique;
DROP INDEX IF EXISTS users_created_at_idx;
DROP TABLE IF EXISTS users;
