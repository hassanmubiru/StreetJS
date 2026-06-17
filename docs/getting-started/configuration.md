---
layout:    default
title:     "Configuration"
parent:    "Getting Started"
nav_order: 4
permalink: /getting-started/configuration/
description: "Configure StreetJS — environment variables, database connection and runtime options for your TypeScript backend."
---

# Configuration

street uses a typed, decorator-driven configuration system. Every config value maps to an environment variable. Sensitive values can be stored encrypted using Vault Mode.

---

## The AppConfig class

`src/config/index.ts` contains the central configuration class. Each property is decorated with `@Config(ENV_VAR_NAME)`:

```typescript
import { Injectable } from '../core/container.js';
import { Config } from '../core/decorators.js';
import { loadConfig } from '../security/vault.js';

@Injectable()
export class AppConfig {
  @Config('PORT', { required: false })
  port: string = '3000';

  @Config('PG_HOST', { required: true })
  pgHost: string = '';

  @Config('JWT_SECRET', { required: true })
  jwtSecret: string = '';

  @Config('SESSION_KEY', { required: true })
  sessionKey: string = '';

  // Encrypted field — decrypted at runtime using the KEK
  @Config('DB_PASSWORD', { encrypted: true, required: true })
  dbPassword: string = '';

  load(kek?: string): this {
    return loadConfig(this, kek);
  }

  get httpPort(): number {
    return parseInt(this.port, 10) || 3000;
  }
}
```

In `main.ts`:

```typescript
const config = new AppConfig();
config.load(process.env['KEK']);     // KEK only needed if you use encrypted fields
container.register(AppConfig, config);
```

---

## All environment variables

### Server

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `3000` | No | HTTP listen port |
| `HOST` | `0.0.0.0` | No | Bind address |
| `NODE_ENV` | `development` | No | `production` enables cluster mode |
| `WORKERS` | CPU count | No | Number of cluster workers |

### Database

| Variable | Default | Required | Description |
|---|---|---|---|
| `PG_HOST` | — | Yes | PostgreSQL host |
| `PG_PORT` | `5432` | No | PostgreSQL port |
| `PG_DATABASE` | — | Yes | Database name |
| `PG_USER` | — | Yes | PostgreSQL user |
| `PG_PASSWORD` | — | Yes | PostgreSQL password |

### Security

| Variable | Default | Required | Description |
|---|---|---|---|
| `JWT_SECRET` | — | Yes | HMAC-SHA256 signing key, min 32 chars |
| `SESSION_KEY` | — | Yes | 64-char hex string (32 bytes) for AES-256-GCM |
| `KEK` | — | Only for Vault Mode | Key-encryption key for secret decryption |

### Directories

| Variable | Default | Required | Description |
|---|---|---|---|
| `UPLOADS_DIR` | `./uploads` | No | Multipart upload destination |
| `MIGRATIONS_DIR` | `./migrations` | No | SQL migration files directory |

---

## Adding your own config fields

To add a config field, annotate a property with `@Config`:

```typescript
@Config('REDIS_URL', { required: false })
redisUrl: string = '';

@Config('SMTP_PASSWORD', { encrypted: true, required: true })
smtpPassword: string = '';

@Config('MAX_UPLOAD_MB', { required: false })
maxUploadMb: string = '10';

get maxUploadBytes(): number {
  return parseInt(this.maxUploadMb, 10) * 1024 * 1024;
}
```

`loadConfig` reads `process.env[envKey]` for each `@Config` field. If `required: true` and the variable is missing, it throws at startup — fail fast, never silently misconfigured.

---

## Environment files

### Development (`.env`)

```bash
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=myapp_dev
PG_USER=myapp
PG_PASSWORD=devpassword

JWT_SECRET=dev-jwt-secret-not-for-production-at-all!!
SESSION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

UPLOADS_DIR=./uploads
MIGRATIONS_DIR=./migrations
```

Load with Node 20's built-in `--env-file`:

```bash
node --env-file=.env dist/main.js
```

### Production

In production, set variables via your deployment platform:

```bash
# systemd
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=PG_HOST=db.internal

# Kubernetes
env:
  - name: JWT_SECRET
    valueFrom:
      secretKeyRef:
        name: myapp-secrets
        key: jwt-secret

# Docker Compose
environment:
  - NODE_ENV=production
  - PG_HOST=postgres
  - JWT_SECRET=${JWT_SECRET}
```

---

## Vault Mode (encrypted config)

For high-security deployments, sensitive config values can be stored encrypted. Only the KEK (Key Encryption Key) needs to be provided at runtime — the actual secrets are decrypted in memory and never written to disk.

### Encrypt a secret

```bash
node -e "
import('./dist/src/security/vault.js').then(({ encryptSecret }) => {
  const encrypted = encryptSecret('my-database-password', process.env.KEK);
  console.log('Encrypted:', encrypted);
});
"
```

Or use a one-liner helper:

```bash
KEK=my-secret-kek node -e "
const { encryptSecret } = await import('./dist/src/security/vault.js');
console.log(encryptSecret(process.argv[2], process.env.KEK));
" 'my-plaintext-secret'
```

### Store the encrypted value

```bash
# .env (safe to commit the encrypted value)
DB_PASSWORD=base64encodedEncryptedBlob...
KEK=                                    # NEVER commit the KEK itself
```

### Mark the field as encrypted

```typescript
@Config('DB_PASSWORD', { encrypted: true, required: true })
dbPassword: string = '';
```

### Provide the KEK at runtime

```bash
KEK=my-kek-from-secret-manager node dist/src/main.js
```

### How it works internally

Vault Mode uses:
1. **scrypt** to derive a 32-byte key from the KEK + a random salt
2. **AES-256-GCM** to encrypt the plaintext value
3. The encrypted blob format is: `[32-byte salt][12-byte IV][16-byte auth tag][ciphertext]`

The auth tag provides tamper detection — if the blob is modified in transit or storage, decryption throws immediately. The salt ensures two encryptions of the same secret produce different blobs.

See [Vault Mode documentation](../security/index.md) for full details.

---

## Configuration validation at startup

If any required environment variable is missing, `config.load()` throws before the server starts:

```
Error: Missing required environment variable: PG_HOST
    at loadConfig (dist/security/vault.js:...)
```

This is intentional. A misconfigured server that starts silently is worse than one that refuses to start. Fail fast.

---

## Accessing config in services

Inject `AppConfig` into any service via the constructor:

```typescript
@Injectable()
export class EmailService {
  constructor(private readonly config: AppConfig) {}

  async send(to: string, subject: string): Promise<void> {
    // this.config.smtpPassword is available (decrypted if Vault Mode)
    console.log(`Sending email to ${to} via SMTP`);
  }
}
```

The container resolves `AppConfig` as a singleton — it is constructed and populated once, then shared across all services.

---

## Runtime configuration introspection

```typescript
// Check environment at runtime
if (config.isProduction) {
  // Enable stricter security headers, disable debug endpoints
}

if (config.isDevelopment) {
  // Enable verbose logging
}

// Typed helpers prevent parseInt() everywhere
const port: number = config.httpPort;     // parseInt(this.port, 10)
const pgPort: number = config.pgPortNumber;
```
