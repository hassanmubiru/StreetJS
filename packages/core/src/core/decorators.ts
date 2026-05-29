// src/core/decorators.ts
// Framework decorators: Controller, route methods, Validate, Config, Command.

import 'reflect-metadata';
import type { MiddlewareFn, RouteMetadata, ControllerMetadata, ValidationSchema, OpenApiOperation } from './types.js';

const CONTROLLER_META = 'street:controller';
const ROUTES_META = 'street:routes';
const COMMAND_META = 'street:command';

// ─── Controller ────────────────────────────────────────────────────────────────

export function Controller(prefix: string, ...middlewares: MiddlewareFn[]): ClassDecorator {
  return (target: object) => {
    const meta: ControllerMetadata = { prefix, middlewares };
    Reflect.defineMetadata(CONTROLLER_META, meta, target);
  };
}

export function getControllerMeta(target: unknown): ControllerMetadata | undefined {
  return Reflect.getMetadata(CONTROLLER_META, target as object) as ControllerMetadata | undefined as ControllerMetadata | undefined;
}

export function getRoutesMeta(target: unknown): RouteMetadata[] {
  return (Reflect.getMetadata(ROUTES_META, target as object) as RouteMetadata[] | undefined) ?? [];
}

// ─── Route method decorators ───────────────────────────────────────────────────

function routeDecorator(
  method: string,
  path: string,
  middlewares: MiddlewareFn[],
  openapi?: OpenApiOperation
): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const routes: RouteMetadata[] = (Reflect.getMetadata(ROUTES_META, target.constructor) as RouteMetadata[] | undefined) ?? [];
    routes.push({
      method,
      path,
      handlerName: String(propertyKey),
      middlewares,
      openapi,
    });
    Reflect.defineMetadata(ROUTES_META, routes, target.constructor);
  };
}

export function Get(path: string, ...middlewares: MiddlewareFn[]): MethodDecorator {
  return routeDecorator('GET', path, middlewares);
}

export function Post(path: string, ...middlewares: MiddlewareFn[]): MethodDecorator {
  return routeDecorator('POST', path, middlewares);
}

export function Put(path: string, ...middlewares: MiddlewareFn[]): MethodDecorator {
  return routeDecorator('PUT', path, middlewares);
}

export function Delete(path: string, ...middlewares: MiddlewareFn[]): MethodDecorator {
  return routeDecorator('DELETE', path, middlewares);
}

export function Patch(path: string, ...middlewares: MiddlewareFn[]): MethodDecorator {
  return routeDecorator('PATCH', path, middlewares);
}

// ─── Validate decorator ────────────────────────────────────────────────────────

export function Validate(schema: ValidationSchema): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const routes: RouteMetadata[] = (Reflect.getMetadata(ROUTES_META, target.constructor) as RouteMetadata[] | undefined) ?? [];
    const routeName = String(propertyKey);
    const route = routes.find((r) => r.handlerName === routeName);
    if (route) {
      route.validate = schema;
    }
    Reflect.defineMetadata(ROUTES_META, routes, target.constructor);
  };
}

// ─── OpenApi decorator ─────────────────────────────────────────────────────────

export function ApiOperation(op: OpenApiOperation): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const routes: RouteMetadata[] = (Reflect.getMetadata(ROUTES_META, target.constructor) as RouteMetadata[] | undefined) ?? [];
    const routeName = String(propertyKey);
    const route = routes.find((r) => r.handlerName === routeName);
    if (route) {
      route.openapi = op;
    }
    Reflect.defineMetadata(ROUTES_META, routes, target.constructor);
  };
}

// ─── Config decorator ──────────────────────────────────────────────────────────

const CONFIG_META = 'street:config';

export interface ConfigField {
  propertyKey: string;
  envKey: string;
  encrypted: boolean;
  required: boolean;
}

export function Config(envKey: string, options?: { encrypted?: boolean; required?: boolean }): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const fields: ConfigField[] = (Reflect.getMetadata(CONFIG_META, target.constructor ?? target) as ConfigField[] | undefined) ?? [];
    fields.push({
      propertyKey: String(propertyKey),
      envKey,
      encrypted: options?.encrypted ?? false,
      required: options?.required ?? true,
    });
    Reflect.defineMetadata(CONFIG_META, fields, target.constructor ?? target);
  };
}

export function getConfigFields(target: unknown): ConfigField[] {
  return (Reflect.getMetadata(CONFIG_META, target as object) as ConfigField[] | undefined) ?? [];
}

// ─── Command decorator (CLI) ───────────────────────────────────────────────────

export interface CommandMetadata {
  name: string;
  description: string;
  handlerMethod: string;
}

export function Command(name: string, description = ''): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const cmds: CommandMetadata[] = (Reflect.getMetadata(COMMAND_META, target.constructor) as CommandMetadata[] | undefined) ?? [];
    cmds.push({ name, description, handlerMethod: String(propertyKey) });
    Reflect.defineMetadata(COMMAND_META, cmds, target.constructor);
  };
}

export function getCommandMeta(target: unknown): CommandMetadata[] {
  return (Reflect.getMetadata(COMMAND_META, target as object) as CommandMetadata[] | undefined) ?? [];
}
