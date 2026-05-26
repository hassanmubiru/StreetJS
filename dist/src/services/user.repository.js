// src/services/user.repository.ts
// User repository with typed row mapping.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { StreetPostgresRepository } from '../database/repository.js';
import { PgPool } from '../database/pool.js';
import { Injectable } from '../core/container.js';
let UserRepository = class UserRepository extends StreetPostgresRepository {
    tableName = 'users';
    constructor(pool) {
        super(pool);
    }
    mapRow(row) {
        return {
            id: row['id'] ?? '',
            email: row['email'] ?? '',
            name: row['name'] ?? '',
            password_hash: row['password_hash'] ?? '',
            roles: row['roles'] ?? '["user"]',
            created_at: row['created_at'] ?? new Date().toISOString(),
            updated_at: row['updated_at'] ?? new Date().toISOString(),
        };
    }
    async findByEmail(email) {
        const result = await this.pool.query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [email]);
        if (result.rows.length === 0)
            return null;
        return this.mapRow(result.rows[0]);
    }
    async emailExists(email) {
        const result = await this.pool.query(`SELECT 1 FROM users WHERE email = $1 LIMIT 1`, [email]);
        return result.rows.length > 0;
    }
    async updatePassword(id, passwordHash) {
        await this.pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, id]);
    }
};
UserRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PgPool])
], UserRepository);
export { UserRepository };
//# sourceMappingURL=user.repository.js.map