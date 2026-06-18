// street.config.ts
// Street framework configuration (SQLite — zero-config default).
// Environment variables are loaded automatically at runtime.

import type { StreetAppOptions } from 'streetjs';

export default {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  host: process.env['HOST'] ?? '0.0.0.0',
  // SQLite needs no server or credentials. ':memory:' is an ephemeral
  // in-process database (resets on restart) — perfect for first runs and tests.
  // Switch to PostgreSQL for production: recreate with `--database postgres`.
  dbDriver: process.env['DB_DRIVER'] ?? 'sqlite',
  sqlitePath: process.env['SQLITE_PATH'] ?? ':memory:',
  jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
  sessionKey: process.env['SESSION_KEY'] ?? 'change-me-session-key',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  uploadsDir: process.env['UPLOADS_DIR'] ?? './uploads',
  migrationsDir: process.env['MIGRATIONS_DIR'] ?? './migrations',
  requestTimeoutMs: 30_000,
  maxBodyBytes: 1_048_576,
} satisfies Partial<StreetAppOptions>;
