// Runnable example: users, roles, authorization, and the audit viewer.
//
//   npm run example -w packages/admin

import { AdminService } from '@streetjs/admin';

const admin = new AdminService();

// Define roles.
admin.createRole('system', { name: 'support', permissions: ['users:read', 'tickets:*'] });
admin.createRole('system', { name: 'billing', permissions: ['invoices:read', 'invoices:refund'] });

// Onboard a user.
const jane = admin.createUser('system', { email: 'jane@acme.com', roles: ['support'] });

console.log('jane can users:read   ->', admin.can(jane.id, 'users:read'));    // true
console.log('jane can tickets:close->', admin.can(jane.id, 'tickets:close')); // true (wildcard)
console.log('jane can invoices:read->', admin.can(jane.id, 'invoices:read')); // false

// Grant billing too.
admin.assignRole('system', jane.id, 'billing');
console.log('after billing role, invoices:refund ->', admin.can(jane.id, 'invoices:refund')); // true
console.log('effective permissions:', admin.permissionsOf(jane.id));

// Suspend — denies everything.
admin.suspendUser('system', jane.id);
console.log('\nsuspended, users:read ->', admin.can(jane.id, 'users:read')); // false

// Audit viewer.
console.log('\naudit log (newest first):');
for (const e of admin.auditLog()) {
  console.log(`  [${e.seq}] ${e.actorId} ${e.action} ${e.target ?? ''} ${JSON.stringify(e.metadata)}`);
}
console.log('total audit events:', admin.auditCount());
