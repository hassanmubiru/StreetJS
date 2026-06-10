// src/enterprise/console/index.ts
// Public surface for the Enterprise Console APIs.

export { EnterpriseConsole } from './console.js';
export type { EnterpriseConsoleOptions } from './console.js';
export { CONSOLE_ROUTES } from './routes.js';
export { consoleOpenApiSpec } from './openapi.js';
export { InMemoryConsoleBackend, ConsoleNotFoundError } from './backend.js';
export type {
  ConsoleArea,
  ConsoleBackend,
  ConsoleMethod,
  ConsolePrincipal,
  ConsoleRequest,
  ConsoleResponse,
  ConsoleRoute,
  ValidationResult,
  CreateTenantInput,
  UpdateTenantInput,
  RbacPolicyInput,
  MfaPolicyInput,
  RetentionPolicyInput,
  ClassificationPolicyInput,
  AuditExportInput,
  ManageUserInput,
  RotateKeyInput,
  ManageSecretInput,
} from './types.js';
