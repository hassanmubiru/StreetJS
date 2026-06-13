# @streetjs/admin

Official Street Framework admin module: user management, RBAC roles &
permissions, authorization checks, and an append-only audit log with a query
viewer — the back-office layer for any Street application.

- User management: create, list, suspend/activate, role assignment, delete
- Roles & permissions (RBAC) with `domain:action` + `*` wildcards
- `can(userId, permission)` authorization (suspended users denied everything)
- Append-only audit log; every mutating admin action is recorded
- Audit viewer with filters (actor, action, target, time range) + pagination

## Install

```bash
npm install @streetjs/admin
```

## Quick start

```ts
import { AdminService } from '@streetjs/admin';

const admin = new AdminService(); // in-memory store by default

await admin.createRole('system', { name: 'support', permissions: ['users:read', 'tickets:*'] });
const jane = await admin.createUser('system', { email: 'jane@acme.com', roles: ['support'] });

await admin.can(jane.id, 'users:read');     // true
await admin.can(jane.id, 'tickets:close');  // true (tickets:* wildcard)
await admin.can(jane.id, 'users:delete');   // false

await admin.suspendUser('system', jane.id);
await admin.can(jane.id, 'users:read');     // false (suspended → denied all)

// Audit viewer — newest first, filterable.
await admin.auditLog({ action: 'user.suspend' });
await admin.auditLog({ actorId: 'system', limit: 50 });
```

All methods are async (the store is pluggable). The first argument to every
mutating method is the **actor** id — recorded in the audit log.

## Postgres

```ts
import { PgPool } from 'streetjs';
import { AdminService, PgAdminStore, ADMIN_MIGRATION_SQL } from '@streetjs/admin';

const pool = new PgPool({ /* … */ });
await pool.query(ADMIN_MIGRATION_SQL);
const admin = new AdminService({ store: new PgAdminStore(pool) });
```

## Permissions

`domain:action` with `*` wildcards:

| Granted | Satisfies |
|---|---|
| `users:read` | `users:read` only |
| `users:*` | `users:read`, `users:write`, … |
| `*:read` | `users:read`, `orders:read`, … |
| `*` | everything |

## Audit log

Every successful state change appends one immutable `AuditEvent`
`{ id, actorId, action, target, metadata, createdAt, seq }`. No-op calls (e.g.
assigning a role the user already has) do not log. Query with `auditLog(query)`:
filter by `actorId`/`action`/`target`/`since`/`until`, paginate with
`limit` + `before` (a `seq` cursor).

## API (selected)

- Users: `createUser`, `getUser`, `listUsers`, `suspendUser`, `activateUser`, `assignRole`, `revokeRole`, `deleteUser`
- Roles: `createRole`, `getRole`, `listRoles`, `grantPermission`, `revokePermission`, `deleteRole`
- Authz: `can`, `permissionsOf`, `permissionMatches`
- Audit: `auditLog`, `auditCount`

## Note on persistence

State lives behind a pluggable async `AdminStore`: `InMemoryAdminStore`
(default) or `PgAdminStore` (Postgres, via `ADMIN_MIGRATION_SQL`). Both are
verified by the same test suite.

## Testing

```bash
npm run test -w packages/admin     # unit + property tests, no external services
```

## License

MIT
