export declare class AppConfig {
    port: string;
    host: string;
    pgHost: string;
    pgPort: string;
    pgDatabase: string;
    pgUser: string;
    pgPassword: string;
    jwtSecret: string;
    sessionKey: string;
    nodeEnv: string;
    uploadsDir: string;
    migrationsDir: string;
    /**
     * Comma-separated list of allowed CORS origins.
     * In production, set this to your actual frontend domain(s).
     * Example: ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
     * Leave unset in development to allow all origins (wildcard).
     */
    allowedOrigins: string;
    /** Load all config values from environment */
    load(kek?: string): this;
    get isProduction(): boolean;
    get isDevelopment(): boolean;
    get httpPort(): number;
    get pgPortNumber(): number;
    /**
     * Returns the parsed CORS origins list.
     * Falls back to ['*'] in non-production environments so local development
     * works without configuration. In production, ALLOWED_ORIGINS must be set.
     */
    get corsOrigins(): string[];
}
//# sourceMappingURL=index.d.ts.map