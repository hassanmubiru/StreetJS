// Example: how a downstream StreetJS package (here, a `runtime-http`-style
// server module) consumes @streetjs/config.
//
// The pattern: each package OWNS its configuration schema and exposes a small
// typed accessor. @streetjs/config provides the loading, validation, secrets,
// and immutability. This file is runnable: `node dist/examples/integration.js`.

import { createConfig, s, type Infer, type Config } from '../index.js';

// ── 1. The package declares its configuration contract as a schema ──────────────

export const httpConfigSchema = {
  http: {
    host: s.hostname().default('0.0.0.0'),
    port: s.number({ integer: true, min: 1, max: 65535 }).default(3000),
    requestTimeout: s.duration().default('30s'), // → milliseconds
    corsOrigins: s.array(s.url({ protocols: ['http', 'https'] })).default([]),
  },
  security: {
    jwtSecret: s.string({ minLength: 16 }).secret(),
    sessionKey: s.string({ minLength: 16 }).secret(),
  },
  logLevel: s.enum(['debug', 'info', 'warn', 'error'] as const).default('info'),
} as const;

/** The strongly-typed shape other code in the package can rely on. */
export type HttpConfig = Infer<typeof httpConfigSchema>;

// ── 2. A typed loader the package exports ───────────────────────────────────────

export async function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): Promise<Config<HttpConfig>> {
  return createConfig({ env })
    .schema(httpConfigSchema)
    .env({ prefix: 'STREET_' }) // STREET_HTTP__PORT, STREET_SECURITY__JWT_SECRET, ...
    .load();
}

// ── 3. Demonstration (runs standalone with an inline environment) ───────────────

async function main(): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    STREET_HTTP__PORT: '8080',
    STREET_HTTP__CORS_ORIGINS: 'https://app.example.com,https://admin.example.com',
    STREET_SECURITY__JWT_SECRET: 'a-very-long-development-secret',
    STREET_SECURITY__SESSION_KEY: 'another-very-long-secret-value',
    STREET_LOG_LEVEL: 'warn',
  };

  const config = await loadHttpConfig(env);

  // Typed, immutable reads.
  const port: number = config.get('http').port;
  const timeoutMs: number = config.namespace('http').get('requestTimeout') as number;
  const cors = config.namespace('http').get('corsOrigins') as string[];

  console.log(`[example] environment      : ${config.environment}`);
  console.log(`[example] http.port        : ${port}`);
  console.log(`[example] http.timeout(ms) : ${timeoutMs}`);
  console.log(`[example] cors origins     : ${cors.join(', ')}`);
  console.log(`[example] log level        : ${config.get('logLevel')}`);

  // Secrets are masked in any serialized/inspected form.
  console.log('[example] serialized config (secrets masked):');
  console.log(config.serialize({ format: 'flat' }));

  // Provenance metadata for auditing where each value came from.
  const portMeta = config.metadata('http.port');
  console.log(`[example] http.port source : ${portMeta?.source?.provider}:${portMeta?.source?.location}`);
}

// Run only when executed directly.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
