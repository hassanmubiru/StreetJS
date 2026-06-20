<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/admin-ui

Accessible, themeable React admin components for
[StreetJS](https://hassanmubiru.github.io/StreetJS/), built on
[`@streetjs/react`](https://www.npmjs.com/package/@streetjs/react). CSS-variable
theming with dark mode; no CSS-in-JS runtime. React is a peer dependency.

```bash
npm install @streetjs/client @streetjs/react @streetjs/admin-ui react
```

## Components

`UserManagement`, `RoleManager` (RBAC), `AuditLogViewer`, `TenantSwitcher`
(multi-tenancy), plus `StreetAdminStyles` and an `AsyncState` helper.

```tsx
import { StreetProvider } from '@streetjs/react';
import { createStreetClient } from '@streetjs/client';
import { UserManagement, RoleManager, StreetAdminStyles } from '@streetjs/admin-ui';

const client = createStreetClient({ baseUrl: '/api', credentials: 'include' });

function Admin() {
  return (
    <StreetProvider client={client}>
      <StreetAdminStyles />
      <UserManagement resource="users" />
      <RoleManager roles={['admin', 'editor', 'viewer']} />
    </StreetProvider>
  );
}
```

These components consume your **existing** StreetJS RBAC, audit-log, user and
tenancy APIs — no backend logic is duplicated.

> **Status:** `0.1.x` preview — pre-1.0. Verified by build + type-check +
> export-shape tests (not full DOM render tests).

## License

MIT
