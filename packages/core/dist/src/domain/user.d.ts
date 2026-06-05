import type { ValidationSchema } from '../core/types.js';
export interface User {
    id: string;
    email: string;
    name: string;
    password_hash: string;
    roles: string;
    created_at: string;
    updated_at: string;
}
export interface UserPublic {
    id: string;
    email: string;
    name: string;
    roles: string[];
    createdAt: string;
}
export interface CreateUserDto {
    email: string;
    name: string;
    password: string;
}
export interface UpdateUserDto {
    name?: string;
    email?: string;
}
export interface LoginDto {
    email: string;
    password: string;
}
/** Strip sensitive fields and parse JSON columns */
export declare function toPublicUser(user: User): UserPublic;
export declare const createUserSchema: ValidationSchema;
export declare const updateUserSchema: ValidationSchema;
export declare const loginSchema: ValidationSchema;
export declare const getUserByIdSchema: ValidationSchema;
//# sourceMappingURL=user.d.ts.map