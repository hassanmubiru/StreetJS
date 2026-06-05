export declare const BACKUPS_MIGRATION_SQL = "CREATE TABLE IF NOT EXISTS street_backups (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  size_bytes BIGINT,\n  duration_ms INT,\n  checksum TEXT,\n  storage_key TEXT,\n  created_at TIMESTAMPTZ DEFAULT NOW()\n);";
export interface StorageAdapter {
    write(key: string, stream: NodeJS.ReadableStream): Promise<void>;
    read(key: string): Promise<NodeJS.ReadableStream>;
    list(): Promise<string[]>;
}
export declare class LocalStorageAdapter implements StorageAdapter {
    private readonly basePath;
    constructor(basePath: string);
    write(key: string, stream: NodeJS.ReadableStream): Promise<void>;
    read(key: string): Promise<NodeJS.ReadableStream>;
    list(): Promise<string[]>;
}
export interface BackupRecord {
    id: string;
    sizeBytes: number;
    durationMs: number;
    checksum: string;
    storageKey: string;
    createdAt: Date;
}
export interface GenericPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
    }>;
}
export declare class BackupService {
    private readonly pool;
    private readonly storage;
    constructor(pool: GenericPool, storage: StorageAdapter);
    /**
     * Creates a backup of all data accessible through the pool.
     * Returns the backup ID.
     */
    backup(): Promise<string>;
    /**
     * Restores from a backup, verifying SHA-256 checksum before applying.
     */
    restore(backupId: string, targetPool?: GenericPool): Promise<void>;
    private _listTables;
}
//# sourceMappingURL=backup.d.ts.map