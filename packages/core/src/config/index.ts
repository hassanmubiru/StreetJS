// src/config/index.ts
// Application configuration loaded from environment variables.

import { Injectable } from '../core/container.js';
import { Config } from '../core/decorators.js';
import { loadConfig } from '../security/vault.js';

@Injectable()
export class AppConfig {
  @Config('PORT', { required: false })
  port: string = '3000';

  @Config('HOST', { required: false })
  host: string = '0.0.0.0';

  @Config('PG_HOST', { required: true })
  pgHost: string = '';

  @Config('PG_PORT', { required: false })
  pgPort: string = '5432';

  @Config('PG_DATABASE', { required: true })
  pgDatabase: string = '';

  @Config('PG_USER', { required: true })
  pgUser: string = '';

  @Config('PG_PASSWORD', { required: true })
  pgPassword: string = '';

  @Config('JWT_SECRET', { required: true })
  jwtSecret: string = '';

  @Config('SESSION_KEY', { required: true })
  sessionKey: string = '';

  @Config('NODE_ENV', { required: false })
  nodeEnv: string = 'development';

  @Config('UPLOADS_DIR', { required: false })
  uploadsDir: string = './uploads';

  @Config('MIGRATIONS_DIR', { required: false })
  migrationsDir: string = './migrations';

  /**
   * Comma-separated list of allowed CORS origins.
   * In production, set this to your actual frontend domain(s).
   * Example: ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
   * Leave unset in development to allow all origins (wildcard).
   */
  @Config('ALLOWED_ORIGINS', { required: false })
  allowedOrigins: string = '';

  /** Load all config values from environment */
  load(kek?: string): this {
    return loadConfig(this, kek);
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get httpPort(): number {
    return parseInt(this.port, 10) || 3000;
  }

  get pgPortNumber(): number {
    return parseInt(this.pgPort, 10) || 5432;
  }

  /**
   * Returns the parsed CORS origins list.
   * Falls back to ['*'] in non-production environments so local development
   * works without configuration. In production, ALLOWED_ORIGINS must be set.
   */
  get corsOrigins(): string[] {
    if (this.allowedOrigins.trim()) {
      return this.allowedOrigins.split(',').map((o) => o.trim()).filter(Boolean);
    }
    if (this.isProduction) {
      // Fail loudly in production rather than silently allowing all origins
      throw new Error(
        'ALLOWED_ORIGINS must be set in production. ' +
        'Example: ALLOWED_ORIGINS=https://app.example.com'
      );
    }
    // Development / test: allow all origins
    return ['*'];
  }
}
