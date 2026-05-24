// src/database/migrations.ts
// Ordered, idempotent SQL migration runner with tracking table.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PgPool } from './pool.js';
import { Injectable } from '../core/container.js';
const MIGRATIONS_TABLE = 'street_migrations';
let StreetMigrationRunner = class StreetMigrationRunner {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /** Run all pending migrations from the migrations directory */
    async run(migrationsDir) {
        await this._ensureTable();
        const appliedSet = await this._getApplied();
        const files = await this._getMigrationFiles(migrationsDir);
        for (const file of files) {
            if (appliedSet.has(file)) {
                console.log(`[migrations] Skipping already applied: ${file}`);
                continue;
            }
            const fullPath = join(migrationsDir, file);
            const sql = await readFile(fullPath, 'utf8');
            console.log(`[migrations] Applying: ${file}`);
            await this.pool.transaction(async (conn) => {
                await conn.query(sql);
                await conn.query(`INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES ('${file.replace(/'/g, "''")}', NOW())`);
            });
            console.log(`[migrations] Applied: ${file}`);
        }
        console.log('[migrations] All migrations complete.');
    }
    /** Rollback the last N migrations (requires rollback SQL files) */
    async rollback(migrationsDir, steps = 1) {
        const applied = await this._getAppliedOrdered();
        const toRollback = applied.slice(-steps).reverse();
        for (const name of toRollback) {
            const rollbackFile = name.replace(/\.sql$/, '.rollback.sql');
            const fullPath = join(migrationsDir, rollbackFile);
            let sql;
            try {
                sql = await readFile(fullPath, 'utf8');
            }
            catch {
                throw new Error(`Rollback file not found: ${rollbackFile}`);
            }
            console.log(`[migrations] Rolling back: ${name}`);
            await this.pool.transaction(async (conn) => {
                await conn.query(sql);
                await conn.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = '${name.replace(/'/g, "''")}'`);
            });
            console.log(`[migrations] Rolled back: ${name}`);
        }
    }
    async _ensureTable() {
        await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    }
    async _getApplied() {
        const result = await this.pool.query(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY applied_at ASC`);
        return new Set(result.rows.map((r) => r['name'] ?? '').filter(Boolean));
    }
    async _getAppliedOrdered() {
        const result = await this.pool.query(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY applied_at ASC`);
        return result.rows.map((r) => r['name'] ?? '').filter(Boolean);
    }
    async _getMigrationFiles(dir) {
        let entries;
        try {
            entries = await readdir(dir);
        }
        catch {
            console.warn(`[migrations] Directory not found: ${dir}`);
            return [];
        }
        return entries
            .filter((f) => f.endsWith('.sql') && !f.endsWith('.rollback.sql'))
            .sort(); // lexicographic = timestamp order
    }
};
StreetMigrationRunner = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PgPool])
], StreetMigrationRunner);
export { StreetMigrationRunner };
//# sourceMappingURL=migrations.js.map