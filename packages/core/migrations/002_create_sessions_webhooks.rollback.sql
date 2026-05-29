-- migrations/002_create_sessions_webhooks.rollback.sql
DROP INDEX IF EXISTS webhook_logs_created_at_idx;
DROP INDEX IF EXISTS webhook_logs_event_idx;
DROP TABLE IF EXISTS webhook_logs;
DROP INDEX IF EXISTS sessions_expires_at_idx;
DROP INDEX IF EXISTS sessions_user_id_idx;
DROP TABLE IF EXISTS sessions;
