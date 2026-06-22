// SaaS feature wiring — admin users, roles (RBAC), and an audit log.
import { AdminService } from '@streetjs/admin';

export const admin = new AdminService();
// await admin.createRole('system', { name: 'owner', permissions: ['*'] });
