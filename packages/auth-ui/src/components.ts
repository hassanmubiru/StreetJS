// Auth components for @streetjs/auth-ui. Each component is a thin, accessible
// React form wired to @streetjs/react hooks (which talk to @streetjs/client).
// No backend logic is duplicated — components only call the public client API.

import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth, useSession, useStreetClient } from '@streetjs/react';
import { h, Field, Button, ErrorText, type ClassNames } from './theme.js';

export interface AuthFormProps {
  /** Called with the server result after a successful submit. */
  onSuccess?: (result: unknown) => void;
  /** Override the container theme: 'light' | 'dark' (defaults to system). */
  theme?: 'light' | 'dark';
  /** Replace default class names on the root and elements. */
  classNames?: ClassNames;
  /** Heading text. */
  title?: string;
}

function shell(theme: string | undefined, className: string | undefined, children: ReactNode): ReactNode {
  return h('div', {
    className: className ?? 'street-auth',
    'data-theme': theme,
  }, children);
}

/** Email + password login form backed by `useAuth().login`. */
export function LoginForm(props: AuthFormProps): ReactNode {
  const { login, loading, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await login({ email, password });
      props.onSuccess?.(r);
    } catch { /* surfaced via `error` */ } finally { setBusy(false); }
  };
  return shell(props.theme, props.classNames?.root,
    h('form', { onSubmit: submit, 'aria-busy': busy || loading, noValidate: true },
      h('h2', null, props.title ?? 'Sign in'),
      h(Field, { id: 'email', label: 'Email', type: 'email', value: email, onChange: setEmail, required: true, autoComplete: 'email' }),
      h(Field, { id: 'password', label: 'Password', type: 'password', value: password, onChange: setPassword, required: true, autoComplete: 'current-password' }),
      h(ErrorText, { error }),
      h(Button, { type: 'submit', disabled: busy || loading }, busy ? 'Signing in…' : 'Sign in'),
    ),
  );
}

/** Registration form backed by `useAuth().register`. */
export function RegisterForm(props: AuthFormProps): ReactNode {
  const { register, loading, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await register({ name, email, password });
      props.onSuccess?.(r);
    } catch { /* surfaced via `error` */ } finally { setBusy(false); }
  };
  return shell(props.theme, props.classNames?.root,
    h('form', { onSubmit: submit, 'aria-busy': busy || loading, noValidate: true },
      h('h2', null, props.title ?? 'Create account'),
      h(Field, { id: 'name', label: 'Name', value: name, onChange: setName, autoComplete: 'name' }),
      h(Field, { id: 'email', label: 'Email', type: 'email', value: email, onChange: setEmail, required: true, autoComplete: 'email' }),
      h(Field, { id: 'password', label: 'Password', type: 'password', value: password, onChange: setPassword, required: true, autoComplete: 'new-password' }),
      h(ErrorText, { error }),
      h(Button, { type: 'submit', disabled: busy || loading }, busy ? 'Creating…' : 'Create account'),
    ),
  );
}

export interface ForgotPasswordProps extends AuthFormProps {
  /** Client path for the reset request (default '/auth/forgot-password'). */
  path?: string;
}

/** Forgot-password form that POSTs an email to the reset endpoint. */
export function ForgotPasswordForm(props: ForgotPasswordProps): ReactNode {
  const client = useStreetClient();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>();
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true); setError(undefined);
    try {
      const r = await client.request('POST', props.path ?? '/auth/forgot-password', { body: { email } });
      setSent(true);
      props.onSuccess?.(r);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return shell(props.theme, props.classNames?.root,
    h('form', { onSubmit: submit, 'aria-busy': busy, noValidate: true },
      h('h2', null, props.title ?? 'Reset password'),
      sent
        ? h('p', { className: 'st-muted', role: 'status' }, 'If that email exists, a reset link is on its way.')
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            h(Field, { id: 'email', label: 'Email', type: 'email', value: email, onChange: setEmail, required: true, autoComplete: 'email' }),
            h(ErrorText, { error }),
            h(Button, { type: 'submit', disabled: busy }, busy ? 'Sending…' : 'Send reset link'),
          ),
    ),
  );
}

export interface MFASetupProps extends AuthFormProps {
  /** Path that returns `{ otpauthUrl, secret }` (default '/auth/mfa/setup'). */
  setupPath?: string;
  /** Path that verifies the 6-digit code (default '/auth/mfa/verify'). */
  verifyPath?: string;
}

/** TOTP MFA setup: fetches a secret/otpauth URL, then verifies a code. */
export function MFASetup(props: MFASetupProps): ReactNode {
  const client = useStreetClient();
  const [secret, setSecret] = useState<string>();
  const [otpauthUrl, setOtpauthUrl] = useState<string>();
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const begin = async (): Promise<void> => {
    setBusy(true); setError(undefined);
    try {
      const r = await client.request<{ otpauthUrl?: string; secret?: string }>('POST', props.setupPath ?? '/auth/mfa/setup');
      setSecret(r.secret); setOtpauthUrl(r.otpauthUrl);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const verify = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true); setError(undefined);
    try {
      const r = await client.request('POST', props.verifyPath ?? '/auth/mfa/verify', { body: { code } });
      setVerified(true);
      props.onSuccess?.(r);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return shell(props.theme, props.classNames?.root,
    h('section', { 'aria-busy': busy },
      h('h2', null, props.title ?? 'Set up two-factor authentication'),
      !secret
        ? h(Button, { onClick: begin, disabled: busy }, busy ? 'Loading…' : 'Begin setup')
        : verified
          ? h('p', { className: 'st-muted', role: 'status' }, 'Two-factor authentication is enabled.')
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              otpauthUrl ? h('p', { className: 'st-muted' }, 'Scan this URL in your authenticator app, then enter the 6-digit code.') : null,
              otpauthUrl ? h('code', { style: { wordBreak: 'break-all', fontSize: 12 } }, otpauthUrl) : null,
              secret ? h('p', { className: 'st-muted' }, h('span', null, 'Secret: '), h('strong', null, secret)) : null,
              h('form', { onSubmit: verify },
                h(Field, { id: 'mfa-code', label: 'Authentication code', value: code, onChange: setCode, required: true, autoComplete: 'one-time-code' }),
                h(ErrorText, { error }),
                h(Button, { type: 'submit', disabled: busy || code.length < 6 }, 'Verify & enable'),
              ),
            ),
      !secret ? h(ErrorText, { error }) : null,
    ),
  );
}

export interface ProfileSettingsProps extends AuthFormProps {
  /** Path used to persist the profile (default '/auth/profile'). */
  path?: string;
}

interface ProfileShape { name?: string; email?: string; [k: string]: unknown }

/** Profile settings form, pre-filled from the current session. */
export function ProfileSettings(props: ProfileSettingsProps): ReactNode {
  const client = useStreetClient();
  const session = useSession<ProfileShape>();
  const { logout } = useAuth();
  const current = session.data ?? {};
  const [name, setName] = useState<string>(current.name ?? '');
  const [email, setEmail] = useState<string>(current.email ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>();

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true); setError(undefined); setSaved(false);
    try {
      const r = await client.request(props.path ?? '/auth/profile', { method: 'PATCH', body: { name, email } });
      setSaved(true);
      props.onSuccess?.(r);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return shell(props.theme, props.classNames?.root,
    h('form', { onSubmit: submit, 'aria-busy': busy || session.loading, noValidate: true },
      h('h2', null, props.title ?? 'Profile settings'),
      h(Field, { id: 'profile-name', label: 'Name', value: name, onChange: setName, autoComplete: 'name' }),
      h(Field, { id: 'profile-email', label: 'Email', type: 'email', value: email, onChange: setEmail, autoComplete: 'email' }),
      saved ? h('p', { className: 'st-muted', role: 'status' }, 'Saved.') : null,
      h(ErrorText, { error }),
      h('div', { style: { display: 'flex', gap: 8 } },
        h(Button, { type: 'submit', disabled: busy }, busy ? 'Saving…' : 'Save changes'),
        h(Button, { type: 'button', onClick: () => { void logout(); } }, 'Sign out'),
      ),
    ),
  );
}
