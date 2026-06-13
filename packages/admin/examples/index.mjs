// Runnable example: users, roles, authorization, and the audit viewer.
//
//   npm run example -w packages/admin
//
// Uses the default in-memory store. Swap in `new PgAdminStore(pool)` (with
// ADMIN_MIGRATION_SQL applied) to persist to Postgres — same API.

import { AdminService } from '@streetjs/admin';

const admin = new AdminService();

await admin.createRole('system', { name: 'support', permissions: ['users:read', 'tickets:*'] });
await admin.createRole('system', { name: 'billing', permissions: ['invoices:read', 'invoices:refund'] });

const jane = await admin.createUser('system', { email: 'jane@acme.com', roles: ['support'] });

console.log('jane can users:read   ->', await admin.can(jane.id, 'users:read'));
console.log('jane can tickets:close->', await admin.can(jane.id, 'tickets:close'));
console.log('jane can invoices:read->', await admin.can(jane.id, 'invoices:read'));

await admin.assignRole('system', jane.id, 'billing');
console.log('after billing role, invoices:refund ->', await admin.can(jane.id, 'invoices:refund'));
console.log('effective permissions:', await admin.permissionsOf(jane.id));

await admin.suspendUser('system', jane.id);
console.log('\nsuspended, users:read ->', await admin.can(jane.id, 'users:read'));

console.log('\naudit log (newest first):');
for (const e of await admin.auditLog()) {
  console.log(`  [${e.seq}] ${e.actorId} ${e.action} ${e.target ?? ''} ${JSON.stringify(e.metadata)}`);
}
console.log('total audit events:', await admin.auditCount());
