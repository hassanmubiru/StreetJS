import { StreetPostgresRepository } from '../database/repository.js';
import { PgPool } from '../database/pool.js';
import type { User } from '../domain/user.js';
export declare class UserRepository extends StreetPostgresRepository<User> {
    protected readonly tableName = "users";
    constructor(pool: PgPool);
    protected mapRow(row: Record<string, string | null>): User;
    findByEmail(email: string): Promise<User | null>;
    emailExists(email: string): Promise<boolean>;
    updatePassword(id: string, passwordHash: string): Promise<void>;
}
//# sourceMappingURL=user.repository.d.ts.map