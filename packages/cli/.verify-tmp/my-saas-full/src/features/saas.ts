// SaaS feature wiring — RBAC composed from core StreetJS primitives.
//
// The DEFAULT scaffold composes role-based access control from the core
// framework (`requireRoles` and the auth/RBAC middleware primitives exported by
// `streetjs`). This keeps the default project dependency-minimal: it installs
// and type-checks with ZERO extra @streetjs packages beyond the always-on
// @streetjs/plugin-htmx dashboard runtime.
//
// `requireRoles(...roles)` returns middleware that authorizes a request only
// when `ctx.user` holds one of the named roles (otherwise 403). Compose it on
// your privileged routes — e.g. members management, API keys, audit, settings.
//
// OPTIONAL ENHANCEMENT: @streetjs/admin's `AdminService` adds a managed RBAC
// engine (wildcard permissions, `can()`, audit primitives) and, with
// @streetjs/admin-ui, server-rendered management screens. It is an optional
// upgrade — install it separately once published:
//   npm install @streetjs/admin
// and scaffold the auth/RBAC screens with `street create --starter saas --with-admin-ui`.
import { requireRoles } from 'streetjs';

/** Guard owner-only routes (billing, ownership transfer). */
export const requireOwner = requireRoles('owner');

/** Guard owner/admin routes (member management, API keys, audit, settings). */
export const requireAdmin = requireRoles('owner', 'admin');
