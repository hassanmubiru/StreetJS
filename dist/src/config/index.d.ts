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
    /** Load all config values from environment */
    load(kek?: string): this;
    get isProduction(): boolean;
    get isDevelopment(): boolean;
    get httpPort(): number;
    get pgPortNumber(): number;
}
//# sourceMappingURL=index.d.ts.map