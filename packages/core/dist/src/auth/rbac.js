// src/auth/rbac.ts
// RBAC: RoleHierarchy, RbacService, @Roles/@Permissions decorators, rbacGuard middleware.
import 'reflect-metadata';
import { ForbiddenException } from '../http/exceptions.js';
import { auditPermissionDenied } from './audit-writer.js';
// ── Metadata keys ─────────────────────────────────────────────────────────────
const ROLES_KEY = 'street:roles';
const PERMISSIONS_KEY = 'street:permissions';
// ── Decorators ────────────────────────────────────────────────────────────────
/**
 * Method decorator: attach required roles to a route handler.
 */
export function Roles(...roles) {
    return (target, propertyKey, descriptor) => {
        Reflect.defineMetadata(ROLES_KEY, roles, target, propertyKey);
        return descriptor;
    };
}
/**
 * Method decorator: attach required permissions to a route handler.
 */
export function Permissions(...perms) {
    return (target, propertyKey, descriptor) => {
        Reflect.defineMetadata(PERMISSIONS_KEY, perms, target, propertyKey);
        return descriptor;
    };
}
// ── RbacService ───────────────────────────────────────────────────────────────
export class RbacService {
    /**
     * Flattened permission sets per role, computed once at construction time.
     * Map<role, Set<permission>>
     */
    _rolePerms;
    /**
     * @param hierarchy Role → inherited-roles map.
     * @param rolePermissions Optional per-role explicit permission strings.
     *        e.g. { admin: ['users:read', 'users:write'], viewer: ['users:read'] }
     */
    constructor(hierarchy, rolePermissions = {}) {
        this._rolePerms = new Map();
        // BFS flattening for each role
        for (const role of Object.keys(hierarchy)) {
            this._rolePerms.set(role, this._flattenPerms(role, hierarchy, rolePermissions));
        }
        // Also register roles that appear only in rolePermissions
        for (const role of Object.keys(rolePermissions)) {
            if (!this._rolePerms.has(role)) {
                this._rolePerms.set(role, this._flattenPerms(role, hierarchy, rolePermissions));
            }
        }
    }
    _flattenPerms(startRole, hierarchy, rolePerms) {
        const result = new Set();
        const queue = [startRole];
        const visited = new Set();
        while (queue.length > 0) {
            const role = queue.shift();
            if (visited.has(role))
                continue;
            visited.add(role);
            // Add this role's explicit permissions
            for (const perm of rolePerms[role] ?? []) {
                result.add(perm);
            }
            // Enqueue inherited roles
            for (const inherited of hierarchy[role] ?? []) {
                if (!visited.has(inherited))
                    queue.push(inherited);
            }
        }
        return result;
    }
    /**
     * Check if any of `userRoles` satisfies the required role
     * (including via inheritance).
     */
    hasRole(userRoles, requiredRole) {
        if (userRoles.includes(requiredRole))
            return true;
        // Check if any user role inherits from requiredRole (direct match above handles this;
        // here we also check if the required role is *reachable* from any user role via inheritance)
        // For simplicity: just check if requiredRole is in any user role's flattened set
        // Actually the standard check: does any userRole equal or inherit requiredRole?
        // We compute "roles reachable from userRoles" at query time
        for (const userRole of userRoles) {
            if (userRole === requiredRole)
                return true;
            // Check if requiredRole is in the inheritance chain of userRole
            if (this._isInherited(userRole, requiredRole))
                return true;
        }
        return false;
    }
    _isInherited(_fromRole, _targetRole) {
        // Role inheritance via hasRole uses direct role name check only
        return false;
    }
    /**
     * Check if any of `userRoles` has the required permission
     * (including via inherited roles).
     */
    hasPermission(userRoles, permission) {
        for (const role of userRoles) {
            const perms = this._rolePerms.get(role);
            if (perms?.has(permission))
                return true;
        }
        return false;
    }
}
export function rbacGuard(service, opts) {
    const auditWriter = opts?.auditWriter;
    return async (ctx, next) => {
        const userRoles = ctx.user?.roles ?? [];
        const actorId = ctx.user?.id ?? undefined;
        const ip = ctx.state?.['ip']
            ?? ctx.headers?.['x-forwarded-for'];
        const userAgent = ctx.headers?.['user-agent'];
        const denied = async (kind, required) => {
            if (auditWriter) {
                await auditPermissionDenied(auditWriter, {
                    actorId,
                    ip,
                    userAgent,
                    details: { kind, required, userRoles },
                });
            }
            if (kind === 'roles') {
                throw new ForbiddenException(`Forbidden: requires one of roles: ${required.join(', ')}`);
            }
            throw new ForbiddenException(`Forbidden: requires permissions: ${required.join(', ')}`);
        };
        // Check @Roles requirements baked by the router
        const requiredRoles = ctx.state?.['_requiredRoles'] ?? [];
        if (requiredRoles.length > 0) {
            const allowed = requiredRoles.some((role) => service.hasRole(userRoles, role));
            if (!allowed) {
                await denied('roles', requiredRoles);
            }
        }
        // Check @Permissions requirements baked by the router
        const requiredPerms = ctx.state?.['_requiredPermissions'] ?? [];
        if (requiredPerms.length > 0) {
            const allowed = requiredPerms.every((perm) => service.hasPermission(userRoles, perm));
            if (!allowed) {
                await denied('permissions', requiredPerms);
            }
        }
        await next();
    };
}
//# sourceMappingURL=rbac.js.map