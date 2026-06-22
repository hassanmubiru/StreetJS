// src/modules/dashboard/auth-ui.controller.ts
// Auth + RBAC management screens for the SaaS starter (overlay code — NOT framework code).
//
// Composes the official React component packages instead of hand-rolling forms
// (Requirement 9.3):
//   @streetjs/auth-ui  — LoginForm, RegisterForm, ForgotPasswordForm, MFASetup, ProfileSettings
//   @streetjs/admin-ui — UserManagement, RoleManager, AuditLogViewer, TenantSwitcher
//
// NO CLIENT BUILD STEP: each screen is a server-rendered htmx page that drops a React
// "island" mount point (partials/dashboard/react-island.html) and hydrates it from an
// ESM CDN declared in the page importmap (layouts/dashboard.html) — the same build-free
// approach the base htmx scaffold uses to load htmx.org from a CDN. The packages' own
// stylesheets (streetAuthCss / streetAdminCss) are injected server-side so the screens
// are styled before/without hydration.
//
// ROLE-GATING (Requirements 9.2, 9.5): RBAC management is owner/admin only — a member
// requesting it gets 403 with no data. Account (the user's own profile/MFA) is open to
// any member. The login/register/forgot screens are public.
//
// WIRING (src/main.ts):
//   app.registerController(AuthRbacController);   // /o/:slug/account, /o/:slug/rbac
//   app.registerController(AuthScreensController); // /auth/login, /auth/register, ...

import 'reflect-metadata';
import { Controller, Get } from 'streetjs';
import type { StreetContext } from 'streetjs';
import { streetAuthCss } from '@streetjs/auth-ui';
import { streetAdminCss } from '@streetjs/admin-ui';
import type { ActiveOrg, Role } from '../members/membership.service.js';

const MANAGE_ROLES: Role[] = ['owner', 'admin'];

/** Descriptor consumed by the react-island partial (mounts a component client-side). */
function island(
  pkg: string,
  component: string,
  props: Record<string, unknown> = {},
): { pkg: string; component: string; props: string } {
  return { pkg, component, props: JSON.stringify(props) };
}

@Controller('/o/:slug')
export class AuthRbacController {
  /** GET /o/:slug/account — the signed-in user's profile + MFA (auth-ui); any member. */
  @Get('/account')
  async account(ctx: StreetContext): Promise<void> {
    const org = ctx.org as ActiveOrg | undefined;
    if (!org || !ctx.user) {
      ctx.htmx.view('dashboard/forbidden', { title: 'Forbidden' }, 403); // 9.4: no membership
      return;
    }
    ctx.htmx.view('dashboard/account', {
      title: 'Account',
      uiCss: streetAuthCss,
      profile: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/auth-ui', 'ProfileSettings', { userId: ctx.user.id }),
      ),
      mfa: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/auth-ui', 'MFASetup', { userId: ctx.user.id }),
      ),
    });
  }

  /** GET /o/:slug/rbac — RBAC management (admin-ui); owner/admin only. */
  @Get('/rbac')
  async rbac(ctx: StreetContext): Promise<void> {
    const org = ctx.org as ActiveOrg | undefined;
    if (!org || !MANAGE_ROLES.includes(org.role)) {
      ctx.htmx.view('dashboard/forbidden', { title: 'Forbidden' }, 403); // 9.5: 403, no data
      return;
    }
    ctx.htmx.view('dashboard/rbac', {
      title: 'RBAC',
      uiCss: streetAdminCss,
      users: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/admin-ui', 'UserManagement', { orgId: org.id }),
      ),
      roles: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/admin-ui', 'RoleManager', { orgId: org.id }),
      ),
      auditLog: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/admin-ui', 'AuditLogViewer', { orgId: org.id }),
      ),
      tenants: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/admin-ui', 'TenantSwitcher', { orgId: org.id }),
      ),
    });
  }
}

/** Public authentication screens rendered with @streetjs/auth-ui (Requirement 9.3). */
@Controller('/auth')
export class AuthScreensController {
  @Get('/login')
  async login(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('dashboard/auth', {
      title: 'Log in',
      uiCss: streetAuthCss,
      form: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/auth-ui', 'LoginForm', { action: '/auth/login' }),
      ),
    });
  }

  @Get('/register')
  async register(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('dashboard/auth', {
      title: 'Create account',
      uiCss: streetAuthCss,
      form: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/auth-ui', 'RegisterForm', { action: '/auth/register' }),
      ),
    });
  }

  @Get('/forgot-password')
  async forgotPassword(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('dashboard/auth', {
      title: 'Reset password',
      uiCss: streetAuthCss,
      form: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/auth-ui', 'ForgotPasswordForm', { action: '/auth/forgot-password' }),
      ),
    });
  }
}
