// src/services/user.service.ts
// User service: registration, auth, CRUD. Uses PBKDF2 for password hashing.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '../core/container.js';
import { UserRepository } from './user.repository.js';
import { JwtService } from '../security/jwt.js';
import { AppConfig } from '../config/index.js';
import { toPublicUser } from '../domain/user.js';
import { NotFoundException, UnauthorizedException, ConflictException, } from '../http/exceptions.js';
import { auditLoginSuccess, auditLoginFailure, auditLogout } from '../auth/audit-writer.js';
const pbkdf2Async = promisify(pbkdf2);
const HASH_ITERATIONS = 100_000;
const HASH_KEYLEN = 64;
const HASH_DIGEST = 'sha512';
const SALT_BYTES = 32;
let UserService = class UserService {
    repo;
    config;
    jwt;
    _auditWriter;
    constructor(repo, config) {
        this.repo = repo;
        this.config = config;
        this.jwt = new JwtService(this.config.jwtSecret);
    }
    /**
     * Attach an {@link AuditWriter} so authentication flows emit audit entries
     * (`login_success`, `login_failure`, `logout`). Optional: when unset, the
     * service behaves exactly as before. Wired via a setter rather than the
     * constructor so the DI container can resolve `UserService` without an
     * `AuditWriter` registration.
     */
    setAuditWriter(writer) {
        this._auditWriter = writer;
    }
    async register(dto) {
        const exists = await this.repo.emailExists(dto.email.toLowerCase());
        if (exists) {
            throw new ConflictException('Email already registered');
        }
        const passwordHash = await this._hashPassword(dto.password);
        const user = await this.repo.create({
            id: generateUuid(),
            email: dto.email.toLowerCase(),
            name: dto.name,
            password_hash: passwordHash,
            roles: JSON.stringify(['user']),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });
        return toPublicUser(user);
    }
    async login(dto, auditContext = {}) {
        const user = await this.repo.findByEmail(dto.email.toLowerCase());
        if (!user) {
            // Constant-time: still run hash check to avoid timing leak
            await this._dummyHash();
            if (this._auditWriter) {
                await auditLoginFailure(this._auditWriter, {
                    ...auditContext,
                    details: { email: dto.email.toLowerCase(), reason: 'user_not_found', ...(auditContext.details ?? {}) },
                });
            }
            throw new UnauthorizedException('Invalid credentials');
        }
        const valid = await this._verifyPassword(dto.password, user.password_hash);
        if (!valid) {
            if (this._auditWriter) {
                await auditLoginFailure(this._auditWriter, {
                    actorId: user.id,
                    ...auditContext,
                    details: { email: dto.email.toLowerCase(), reason: 'bad_password', ...(auditContext.details ?? {}) },
                });
            }
            throw new UnauthorizedException('Invalid credentials');
        }
        let roles = ['user'];
        try {
            roles = JSON.parse(user.roles);
        }
        catch { /* default */ }
        const accessToken = this.jwt.sign({ sub: user.id, email: user.email, roles }, { expiresInSeconds: 3600 });
        const refreshToken = this.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresInSeconds: 86400 * 7 });
        if (this._auditWriter) {
            await auditLoginSuccess(this._auditWriter, { actorId: user.id, ...auditContext });
        }
        return { accessToken, refreshToken, expiresIn: 3600 };
    }
    /**
     * Record a logout for `userId`. When an {@link AuditWriter} is attached, a
     * `logout` audit entry is written; otherwise this is a no-op. Session and
     * token revocation are handled by their respective services.
     */
    async logout(userId, auditContext = {}) {
        if (this._auditWriter) {
            await auditLogout(this._auditWriter, { actorId: userId, ...auditContext });
        }
    }
    async findById(id) {
        const user = await this.repo.findById(id);
        if (!user)
            throw new NotFoundException('User not found');
        return toPublicUser(user);
    }
    async findAll(page, limit) {
        const safePage = Math.max(1, page);
        const safeLimit = Math.min(Math.max(1, limit), 100);
        const offset = (safePage - 1) * safeLimit;
        const [items, total] = await Promise.all([
            this.repo.findAll(safeLimit, offset),
            this.repo.count(),
        ]);
        return {
            items: items.map(toPublicUser),
            total,
            page: safePage,
            limit: safeLimit,
            hasMore: offset + items.length < total,
        };
    }
    async update(id, dto) {
        const existing = await this.repo.findById(id);
        if (!existing)
            throw new NotFoundException('User not found');
        if (dto.email) {
            const emailOwner = await this.repo.findByEmail(dto.email.toLowerCase());
            if (emailOwner && emailOwner.id !== id) {
                throw new ConflictException('Email already taken');
            }
        }
        const updated = await this.repo.update(id, {
            ...(dto.name ? { name: dto.name } : {}),
            ...(dto.email ? { email: dto.email.toLowerCase() } : {}),
            updated_at: new Date().toISOString(),
        });
        if (!updated)
            throw new NotFoundException('User not found');
        return toPublicUser(updated);
    }
    async remove(id) {
        const deleted = await this.repo.delete(id);
        if (!deleted)
            throw new NotFoundException('User not found');
    }
    verifyToken(token) {
        const payload = this.jwt.verify(token);
        if (!payload?.sub)
            return null;
        return {
            sub: payload.sub,
            email: String(payload.email ?? ''),
            roles: Array.isArray(payload.roles) ? payload.roles : [],
        };
    }
    async _hashPassword(password) {
        const salt = randomBytes(SALT_BYTES);
        const hash = await pbkdf2Async(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST);
        return `${salt.toString('hex')}:${hash.toString('hex')}`;
    }
    async _verifyPassword(password, stored) {
        const [saltHex, hashHex] = stored.split(':');
        if (!saltHex || !hashHex)
            return false;
        const salt = Buffer.from(saltHex, 'hex');
        const expected = Buffer.from(hashHex, 'hex');
        const actual = await pbkdf2Async(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST);
        if (actual.length !== expected.length)
            return false;
        return timingSafeEqual(actual, expected);
    }
    async _dummyHash() {
        const salt = randomBytes(SALT_BYTES);
        await pbkdf2Async('dummy', salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST);
    }
};
UserService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UserRepository,
        AppConfig])
], UserService);
export { UserService };
function generateUuid() {
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
//# sourceMappingURL=user.service.js.map