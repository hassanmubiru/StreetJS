import { UserRepository } from './user.repository.js';
import { AppConfig } from '../config/index.js';
import type { UserPublic, CreateUserDto, UpdateUserDto, LoginDto } from '../domain/user.js';
import type { TokenPair, PaginatedResult } from '../core/types.js';
import type { AuditWriter, AuditEventDetails } from '../auth/audit-writer.js';
export declare class UserService {
    private readonly repo;
    private readonly config;
    private readonly jwt;
    private _auditWriter?;
    constructor(repo: UserRepository, config: AppConfig);
    /**
     * Attach an {@link AuditWriter} so authentication flows emit audit entries
     * (`login_success`, `login_failure`, `logout`). Optional: when unset, the
     * service behaves exactly as before. Wired via a setter rather than the
     * constructor so the DI container can resolve `UserService` without an
     * `AuditWriter` registration.
     */
    setAuditWriter(writer: AuditWriter): void;
    register(dto: CreateUserDto): Promise<UserPublic>;
    login(dto: LoginDto, auditContext?: AuditEventDetails): Promise<TokenPair>;
    /**
     * Record a logout for `userId`. When an {@link AuditWriter} is attached, a
     * `logout` audit entry is written; otherwise this is a no-op. Session and
     * token revocation are handled by their respective services.
     */
    logout(userId: string, auditContext?: AuditEventDetails): Promise<void>;
    findById(id: string): Promise<UserPublic>;
    findAll(page: number, limit: number): Promise<PaginatedResult<UserPublic>>;
    update(id: string, dto: UpdateUserDto): Promise<UserPublic>;
    remove(id: string): Promise<void>;
    verifyToken(token: string): {
        sub: string;
        email: string;
        roles: string[];
    } | null;
    private _hashPassword;
    private _verifyPassword;
    private _dummyHash;
}
//# sourceMappingURL=user.service.d.ts.map