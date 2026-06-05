import { UserRepository } from './user.repository.js';
import { AppConfig } from '../config/index.js';
import type { UserPublic, CreateUserDto, UpdateUserDto, LoginDto } from '../domain/user.js';
import type { TokenPair, PaginatedResult } from '../core/types.js';
export declare class UserService {
    private readonly repo;
    private readonly config;
    private readonly jwt;
    constructor(repo: UserRepository, config: AppConfig);
    register(dto: CreateUserDto): Promise<UserPublic>;
    login(dto: LoginDto): Promise<TokenPair>;
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