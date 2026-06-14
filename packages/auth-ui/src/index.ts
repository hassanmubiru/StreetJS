// @streetjs/auth-ui — accessible, themeable React auth components built on
// @streetjs/react (which consumes @streetjs/client). No backend logic is
// duplicated; components call the public client API only (RFC 0002). React is a
// peer dependency. Styling is CSS-variable driven with built-in dark mode.

export {
  LoginForm,
  RegisterForm,
  ForgotPasswordForm,
  MFASetup,
  ProfileSettings,
} from './components.js';
export type {
  AuthFormProps,
  ForgotPasswordProps,
  MFASetupProps,
  ProfileSettingsProps,
} from './components.js';

export {
  StreetAuthStyles,
  streetAuthCss,
  Field,
  Button,
  ErrorText,
} from './theme.js';
export type { ClassNames, FieldProps, ButtonProps } from './theme.js';
