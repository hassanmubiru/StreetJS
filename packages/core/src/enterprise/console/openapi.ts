// src/enterprise/console/openapi.ts
// Generates the OpenAPI 3.1 specification for the Enterprise Console REST
// surface (Req 6.9). The spec is produced through the framework's OpenAPI
// facility (`generateOpenApi`, the same generator backing `openApiSpec()`) so
// that the generated document covers *every* exposed console operation and is
// consistent with the rest of the platform's generated specs.
//
// On top of the base generation, each operation is enriched with:
//   • a stable `operationId` (the route's operationId),
//   • `security` requiring the bearer token every operation enforces (Req 6.5),
//   • a `requestBody` schema for body-carrying operations,
//   • the uniform error responses every operation can return
//     (400 invalid input, 401 unauthenticated, 403 unauthorized — Req 6.6–6.8).
//
// Zero runtime dependencies — Node core only.

import { generateOpenApi, type OpenApiRouteInput } from '../../http/openapi.js';
import { CONSOLE_ROUTES } from './routes.js';
import type { ConsoleRoute } from './types.js';

/** Title + version used for the published Enterprise Console specification. */
const SPEC_TITLE = 'Street Enterprise Console API';
const SPEC_VERSION = '1.0.0';
const SPEC_DESCRIPTION =
  'REST surface for tenant, policy, compliance, and administrative operations. ' +
  'Every operation requires a successful bearer-token authentication and an ' +
  'authorization check before it is performed.';

/** Human-readable tag descriptions, one per console area. */
const AREA_TAGS: Array<{ name: string; description: string }> = [
  { name: 'tenant', description: 'Tenant lifecycle operations (create, update, suspend).' },
  { name: 'policy', description: 'Policy operations: RBAC, MFA, retention, and classification.' },
  { name: 'compliance', description: 'Compliance operations: audit export, reporting, posture.' },
  { name: 'admin', description: 'Administrative operations: users, key rotation, secrets.' },
];

/**
 * Success status code per operation. Mirrors what each route's `perform`
 * returns so the generated responses match the runtime contract.
 */
const SUCCESS_STATUS: Record<string, number> = {
  createTenant: 201,
};

/**
 * JSON Schemas for each operation's request body, keyed by `operationId`.
 * Operations that take no body (path-only or read operations) are omitted.
 * These mirror the validators in `validators.ts` so the published spec
 * documents exactly the input each operation accepts.
 */
const REQUEST_SCHEMAS: Record<string, object> = {
  createTenant: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, description: 'Tenant display name.' },
      plan: { type: 'string', description: 'Optional subscription plan.' },
      connectionString: { type: 'string', description: 'Optional dedicated database connection string.' },
    },
  },
  updateTenant: {
    type: 'object',
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1 },
      plan: { type: 'string' },
      status: { type: 'string', enum: ['active', 'suspended'] },
    },
  },
  setRbacPolicy: {
    type: 'object',
    required: ['roles'],
    properties: {
      roles: {
        type: 'array',
        items: {
          type: 'object',
          required: ['role', 'permissions'],
          properties: {
            role: { type: 'string', minLength: 1 },
            permissions: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
  setMfaPolicy: {
    type: 'object',
    required: ['required'],
    properties: {
      required: { type: 'boolean' },
      methods: { type: 'array', items: { type: 'string' } },
    },
  },
  setRetentionPolicy: {
    type: 'object',
    required: ['entity', 'retentionDays'],
    properties: {
      entity: { type: 'string', minLength: 1 },
      retentionDays: { type: 'integer', minimum: 1 },
    },
  },
  setClassificationPolicy: {
    type: 'object',
    required: ['field', 'level'],
    properties: {
      field: { type: 'string', minLength: 1 },
      level: { type: 'string', enum: ['public', 'internal', 'confidential', 'restricted'] },
    },
  },
  exportAudit: {
    type: 'object',
    required: ['from', 'to', 'format'],
    properties: {
      from: { type: 'string', format: 'date-time', description: 'ISO-8601 start of the export window.' },
      to: { type: 'string', format: 'date-time', description: 'ISO-8601 end of the export window.' },
      format: { type: 'string', enum: ['jsonl', 'csv'] },
    },
  },
  manageUser: {
    type: 'object',
    required: ['action', 'userId'],
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'disable'] },
      userId: { type: 'string', minLength: 1 },
      roles: { type: 'array', items: { type: 'string' } },
    },
  },
  rotateKey: {
    type: 'object',
    required: ['keyId'],
    properties: { keyId: { type: 'string', minLength: 1 } },
  },
  manageSecret: {
    type: 'object',
    required: ['value'],
    properties: { value: { type: 'string', minLength: 1, description: 'Secret material to store.' } },
  },
};

/** The uniform error responses every console operation can return. */
function errorResponses(): Record<string, { description: string; schema?: unknown }> {
  const errorSchema = {
    type: 'object',
    properties: {
      error: { type: 'string' },
      message: { type: 'string' },
      field: { type: 'string' },
    },
  };
  return {
    '400': { description: 'Invalid input — the offending field is identified; state is unchanged.', schema: errorSchema },
    '401': { description: 'Authentication failed — a valid bearer token is required.', schema: errorSchema },
    '403': { description: 'Authorization failed — the principal lacks a required role.', schema: errorSchema },
  };
}

/** Map a single console route onto the OpenAPI route-input shape. */
function toRouteInput(route: ConsoleRoute): OpenApiRouteInput {
  const successCode = SUCCESS_STATUS[route.operationId] ?? 200;
  const responses: Record<string, { description: string; schema?: unknown }> = {
    [String(successCode)]: { description: route.summary },
    ...errorResponses(),
  };
  return {
    method: route.method,
    path: route.pattern,
    summary: route.summary,
    description:
      `${route.summary}. Requires one of the roles: ${route.requiredRoles.join(', ')}.`,
    tags: [route.area],
    responses,
  };
}

/**
 * Generate the OpenAPI 3.1 specification for the Enterprise Console.
 *
 * Built through the framework's `generateOpenApi` facility so the document is
 * produced the same way as the rest of the platform's specs, then enriched with
 * console-specific metadata (info block, security, tags, operationIds, and
 * request bodies). Every route in `routes` becomes an exposed operation in the
 * returned `paths`, so the spec covers every operation (Req 6.9).
 *
 * @param routes The console route table (defaults to the full surface).
 */
export function consoleOpenApiSpec(routes: ReadonlyArray<ConsoleRoute> = CONSOLE_ROUTES): object {
  const base = generateOpenApi(routes.map(toRouteInput)) as {
    openapi: string;
    info: Record<string, unknown>;
    paths: Record<string, Record<string, Record<string, unknown>>>;
    components?: Record<string, unknown>;
  };

  // Override the info block with console-specific identity.
  base.info = { title: SPEC_TITLE, version: SPEC_VERSION, description: SPEC_DESCRIPTION };

  // Index routes by their OpenAPI (method, path) so we can enrich each operation.
  for (const route of routes) {
    const openApiPath = route.pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
    const method = route.method.toLowerCase();
    const op = base.paths[openApiPath]?.[method] as Record<string, unknown> | undefined;
    if (!op) continue;

    op['operationId'] = route.operationId;
    // Every operation enforces authentication + authorization (Req 6.5).
    op['security'] = [{ bearerAuth: [] }];

    const schema = REQUEST_SCHEMAS[route.operationId];
    if (schema) {
      op['requestBody'] = {
        required: true,
        content: { 'application/json': { schema } },
      };
    }
  }

  // Declare the area tags and a top-level security requirement.
  base['tags'] = AREA_TAGS;
  base['security'] = [{ bearerAuth: [] }];

  return base;
}
