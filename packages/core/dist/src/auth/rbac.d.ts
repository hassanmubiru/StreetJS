import 'reflect-metadata';
import type { MiddlewareFn } from '../core/types.js';
import type { AuditWriter } from './audit-writer.js';
/**
 * Role hierarchy: maps each role to the roles it inherits from.
 * e.g. { admin: ['editor'], editor: ['viewer'], viewer: [] }
 */
export type RoleHierarchy = Record<string, string[]>;
/**
 * Method decorator: attach required roles to a route handler.
 */
export declare function Roles(...roles: string[]): MethodDecorator;
/**
 * Method decorator: attach required permissions to a route handler.
 */
export declare function Permissions(...perms: string[]): MethodDecorator;
export declare class RbacService {
    /**
     * Flattened permission sets per role, computed once at construction time.
     * Map<role, Set<permission>>
     */
    private readonly _rolePerms;
    /**
     * @param hierarchy Role → inherited-roles map.
     * @param rolePermissions Optional per-role explicit permission strings.
     *        e.g. { admin: ['users:read', 'users:write'], viewer: ['users:read'] }
     */
    constructor(hierarchy: RoleHierarchy, rolePermissions?: Record<string, string[]>);
    private _flattenPerms;
    /**
     * Check if any of `userRoles` satisfies the required role
     * (including via inheritance).
     */
    hasRole(userRoles: string[], requiredRole: string): boolean;
    private _isInherited;
    /**
     * Check if any of `userRoles` has the required permission
     * (including via inherited roles).
     */
    hasPermission(userRoles: string[], permission: string): boolean;
}
/**
 * Middleware that enforces @Roles / @Permissions requirements against
 * ctx.user.roles.
 *
 * The router bakes RBAC metadata from decorators into the compiled route at
 * registration time and sets ctx.state['_requiredRoles'] and
 * ctx.state['_requiredPermissions'] before running the pipeline.  This guard
 * reads those values directly — no prototype chain traversal at request time.
 */
/** Optional configuration for {@link rbacGuard}. */
export interface RbacGuardOptions {
    /**
     * When provided, the guard writes a `permission_denied` audit entry before
     * throwing {@link ForbiddenException}. Omitting it keeps the guard's
     * behaviour and dependencies unchanged.
     */
    auditWriter?: AuditWriter;
}
export declare function rbacGuard(service: RbacService, opts?: RbacGuardOptions): MiddlewareFn;
//# sourceMappingURL=rbac.d.ts.map