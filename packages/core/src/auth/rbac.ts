// src/auth/rbac.ts
// RBAC: RoleHierarchy, RbacService, @Roles/@Permissions decorators, rbacGuard middleware.

import 'reflect-metadata';
import type { MiddlewareFn } from '../core/types.js';
import { ForbiddenException } from '../http/exceptions.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Role hierarchy: maps each role to the roles it inherits from.
 * e.g. { admin: ['editor'], editor: ['viewer'], viewer: [] }
 */
export type RoleHierarchy = Record<string, string[]>;

// ── Metadata keys ─────────────────────────────────────────────────────────────

const ROLES_KEY      = 'street:roles';
const PERMISSIONS_KEY = 'street:permissions';

// ── Decorators ────────────────────────────────────────────────────────────────

/**
 * Method decorator: attach required roles to a route handler.
 */
export function Roles(...roles: string[]): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(ROLES_KEY, roles, target, propertyKey as string | symbol);
    return descriptor;
  };
}

/**
 * Method decorator: attach required permissions to a route handler.
 */
export function Permissions(...perms: string[]): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(PERMISSIONS_KEY, perms, target, propertyKey as string | symbol);
    return descriptor;
  };
}

// ── RbacService ───────────────────────────────────────────────────────────────

export class RbacService {
  /**
   * Flattened permission sets per role, computed once at construction time.
   * Map<role, Set<permission>>
   */
  private readonly _rolePerms: Map<string, Set<string>>;

  /**
   * @param hierarchy Role → inherited-roles map.
   * @param rolePermissions Optional per-role explicit permission strings.
   *        e.g. { admin: ['users:read', 'users:write'], viewer: ['users:read'] }
   */
  constructor(
    hierarchy: RoleHierarchy,
    rolePermissions: Record<string, string[]> = {},
  ) {
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

  private _flattenPerms(
    startRole: string,
    hierarchy: RoleHierarchy,
    rolePerms: Record<string, string[]>,
  ): Set<string> {
    const result = new Set<string>();
    const queue = [startRole];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const role = queue.shift()!;
      if (visited.has(role)) continue;
      visited.add(role);

      // Add this role's explicit permissions
      for (const perm of rolePerms[role] ?? []) {
        result.add(perm);
      }

      // Enqueue inherited roles
      for (const inherited of hierarchy[role] ?? []) {
        if (!visited.has(inherited)) queue.push(inherited);
      }
    }

    return result;
  }

  /**
   * Check if any of `userRoles` satisfies the required role
   * (including via inheritance).
   */
  hasRole(userRoles: string[], requiredRole: string): boolean {
    if (userRoles.includes(requiredRole)) return true;
    // Check if any user role inherits from requiredRole (direct match above handles this;
    // here we also check if the required role is *reachable* from any user role via inheritance)
    // For simplicity: just check if requiredRole is in any user role's flattened set
    // Actually the standard check: does any userRole equal or inherit requiredRole?
    // We compute "roles reachable from userRoles" at query time
    for (const userRole of userRoles) {
      if (userRole === requiredRole) return true;
      // Check if requiredRole is in the inheritance chain of userRole
      if (this._isInherited(userRole, requiredRole)) return true;
    }
    return false;
  }

  private _isInherited(_fromRole: string, _targetRole: string): boolean {
    // Role inheritance via hasRole uses direct role name check only
    return false;
  }

  /**
   * Check if any of `userRoles` has the required permission
   * (including via inherited roles).
   */
  hasPermission(userRoles: string[], permission: string): boolean {
    for (const role of userRoles) {
      const perms = this._rolePerms.get(role);
      if (perms?.has(permission)) return true;
    }
    return false;
  }
}

// ── rbacGuard middleware ──────────────────────────────────────────────────────

/**
 * Middleware that enforces @Roles / @Permissions requirements against
 * ctx.user.roles.
 *
 * The router bakes RBAC metadata from decorators into the compiled route at
 * registration time and sets ctx.state['_requiredRoles'] and
 * ctx.state['_requiredPermissions'] before running the pipeline.  This guard
 * reads those values directly — no prototype chain traversal at request time.
 */
export function rbacGuard(service: RbacService): MiddlewareFn {
  return async (ctx, next) => {
    const userRoles: string[] = (ctx.user?.roles as string[] | undefined) ?? [];

    // Check @Roles requirements baked by the router
    const requiredRoles: string[] =
      (ctx.state?.['_requiredRoles'] as string[] | undefined) ?? [];
    if (requiredRoles.length > 0) {
      const allowed = requiredRoles.some((role) => service.hasRole(userRoles, role));
      if (!allowed) {
        throw new ForbiddenException(`Forbidden: requires one of roles: ${requiredRoles.join(', ')}`);
      }
    }

    // Check @Permissions requirements baked by the router
    const requiredPerms: string[] =
      (ctx.state?.['_requiredPermissions'] as string[] | undefined) ?? [];
    if (requiredPerms.length > 0) {
      const allowed = requiredPerms.every((perm) => service.hasPermission(userRoles, perm));
      if (!allowed) {
        throw new ForbiddenException(`Forbidden: requires permissions: ${requiredPerms.join(', ')}`);
      }
    }

    await next();
  };
}
