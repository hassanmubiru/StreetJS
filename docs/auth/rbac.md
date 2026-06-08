---
title: RBAC
parent: Authentication
nav_order: 1
---

# Role-Based Access Control (RBAC)

Street's RBAC system supports hierarchical roles, granular permissions, and decorator-based access control on controller methods. It is framework-agnostic and works with any authentication mechanism (JWT, session, API key).

## Core Concepts

- **Role** — A named group of permissions. Example: `admin`, `editor`, `viewer`.
- **Permission** — A string describing a specific action. Example: `posts:write`, `users:delete`.
- **Hierarchy** — Roles can inherit from other roles. An `admin` that inherits from `editor` automatically gains all editor permissions.

---

## RoleHierarchy Configuration

Define the hierarchy as a `Record<string, string[]>` where each key is a role and the value is the list of roles it inherits from.

```typescript
import { RbacService, type RoleHierarchy } from '@streetjs/core';

const hierarchy: RoleHierarchy = {
  admin: ['editor'],      // admin inherits from editor
  editor: ['viewer'],     // editor inherits from viewer
  viewer: [],             // viewer has no parents
};

const rolePermissions = {
  admin: ['users:write', 'users:delete', 'settings:manage'],
  editor: ['posts:write', 'posts:delete', 'media:upload'],
  viewer: ['posts:read', 'media:read'],
};

const rbac = new RbacService(hierarchy, rolePermissions);
```

With this configuration:
- `admin` has `users:write`, `users:delete`, `settings:manage`, `posts:write`, `posts:delete`, `media:upload`, `posts:read`, `media:read`.
- `editor` has `posts:write`, `posts:delete`, `media:upload`, `posts:read`, `media:read`.
- `viewer` has `posts:read`, `media:read`.

The inheritance is resolved via BFS, so arbitrarily deep hierarchies are supported without risk of infinite loops.

---

## @Roles() Decorator

Use `@Roles(...roles)` on a controller method to declare that the caller must have at least one of the specified roles.

```typescript
import { Controller, Get, Post, Delete } from '@streetjs/core';
import { Roles, Permissions } from '@streetjs/core';

@Controller('/posts')
export class PostsController {
  @Get('/')
  async list(ctx) {
    // Public — no role required
    ctx.json({ posts: [] });
  }

  @Post('/')
  @Roles('editor', 'admin')
  async create(ctx) {
    // Only editor or admin can create
    ctx.json({ created: true }, 201);
  }

  @Delete('/:id')
  @Roles('admin')
  async remove(ctx) {
    // Only admin can delete
    ctx.json({ deleted: true });
  }
}
```

---

## @Permissions() Decorator

Use `@Permissions(...permissions)` when you want fine-grained permission checks instead of (or in addition to) role checks.

```typescript
@Post('/media/upload')
@Permissions('media:upload')
async uploadMedia(ctx) {
  // Requires the media:upload permission (editor and admin have it via hierarchy)
  ctx.json({ uploaded: true });
}
```

---

## rbacGuard Middleware

`rbacGuard` reads the `_requiredRoles` and `_requiredPermissions` from `ctx.state`, which are set by the decorators via the router. Wire it as a global middleware after `authMiddleware`:

```typescript
import {
  authMiddleware, rbacGuard, RbacService,
  JwtService, type RoleHierarchy,
} from '@streetjs/core';

const jwt = new JwtService({ secret: process.env.JWT_SECRET! });

const hierarchy: RoleHierarchy = {
  admin: ['editor'],
  editor: ['viewer'],
  viewer: [],
};
const permissions = {
  admin: ['users:write'],
  editor: ['posts:write'],
  viewer: ['posts:read'],
};

const rbac = new RbacService(hierarchy, permissions);

// Wire middlewares (order matters)
app.use(authMiddleware(jwt));    // 1. Populate ctx.user from Bearer token
app.use(rbacGuard(rbac));        // 2. Enforce roles/permissions on each route
```

When a user lacks the required role or permission, `rbacGuard` throws `ForbiddenException` (HTTP 403).

---

## Checking Roles and Permissions Programmatically

You can also call `rbac` methods directly in your own code:

```typescript
// Check a single role
if (rbac.hasRole(ctx.user!.roles, 'admin')) {
  // do admin things
}

// Check a permission (respects hierarchy)
if (rbac.hasPermission(ctx.user!.roles, 'posts:write')) {
  // allow the action
}
```

---

## Complete Example

```typescript
import 'reflect-metadata';
import {
  streetApp, authMiddleware, rbacGuard,
  RbacService, JwtService, Controller, Get, Post, Delete,
  Roles, Permissions,
} from '@streetjs/core';

const jwt = new JwtService({ secret: 'super-secret' });
const rbac = new RbacService(
  { admin: ['editor'], editor: ['viewer'], viewer: [] },
  {
    admin: ['users:write'],
    editor: ['posts:write'],
    viewer: ['posts:read'],
  },
);

const app = streetApp({ port: 3000 });
app.use(authMiddleware(jwt));
app.use(rbacGuard(rbac));

@Controller('/admin')
class AdminController {
  @Get('/dashboard')
  @Roles('admin')
  async dashboard(ctx) {
    ctx.json({ message: 'Admin dashboard', user: ctx.user });
  }

  @Get('/reports')
  @Permissions('users:write')
  async reports(ctx) {
    ctx.json({ reports: [] });
  }
}

app.registerController(AdminController);
await app.listen(3000);
```
