// street.config.ts
// Street framework configuration (PostgreSQL).
// Environment variables are loaded automatically at runtime.
//
// PG_USER / PG_PASSWORD / PG_DATABASE have NO defaults on purpose — set them in
// your .env (see .env.example). The app validates these on startup and refuses
// to connect with guessed credentials.

import type { StreetAppOptions } from 'streetjs';

export default {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  host: process.env['HOST'] ?? '0.0.0.0',
  dbDriver: process.env['DB_DRIVER'] ?? 'postgres',
  pgHost: process.env['PG_HOST'] ?? 'localhost',
  pgPort: parseInt(process.env['PG_PORT'] ?? '5432', 10),
  pgDatabase: process.env['PG_DATABASE'],
  pgUser: process.env['PG_USER'],
  pgPassword: process.env['PG_PASSWORD'],
  jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
  sessionKey: process.env['SESSION_KEY'] ?? 'change-me-session-key',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  uploadsDir: process.env['UPLOADS_DIR'] ?? './uploads',
  migrationsDir: process.env['MIGRATIONS_DIR'] ?? './migrations',
  requestTimeoutMs: 30_000,
  maxBodyBytes: 1_048_576,
} satisfies Partial<StreetAppOptions>;
