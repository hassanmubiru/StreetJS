// src/core/decorators.ts
// Framework decorators: Controller, route methods, Validate, Config, Command.
import 'reflect-metadata';
const CONTROLLER_META = 'street:controller';
const ROUTES_META = 'street:routes';
const COMMAND_META = 'street:command';
// ─── Controller ────────────────────────────────────────────────────────────────
export function Controller(prefix, ...middlewares) {
    return (target) => {
        const meta = { prefix, middlewares };
        Reflect.defineMetadata(CONTROLLER_META, meta, target);
    };
}
export function getControllerMeta(target) {
    return Reflect.getMetadata(CONTROLLER_META, target);
}
export function getRoutesMeta(target) {
    return Reflect.getMetadata(ROUTES_META, target) ?? [];
}
// ─── Route method decorators ───────────────────────────────────────────────────
function routeDecorator(method, path, middlewares, openapi) {
    return (target, propertyKey, _descriptor) => {
        const routes = Reflect.getMetadata(ROUTES_META, target.constructor) ?? [];
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
export function Get(path, ...middlewares) {
    return routeDecorator('GET', path, middlewares);
}
export function Post(path, ...middlewares) {
    return routeDecorator('POST', path, middlewares);
}
export function Put(path, ...middlewares) {
    return routeDecorator('PUT', path, middlewares);
}
export function Delete(path, ...middlewares) {
    return routeDecorator('DELETE', path, middlewares);
}
export function Patch(path, ...middlewares) {
    return routeDecorator('PATCH', path, middlewares);
}
// ─── Validate decorator ────────────────────────────────────────────────────────
export function Validate(schema) {
    return (target, propertyKey, _descriptor) => {
        const routes = Reflect.getMetadata(ROUTES_META, target.constructor) ?? [];
        const routeName = String(propertyKey);
        const route = routes.find((r) => r.handlerName === routeName);
        if (route) {
            route.validate = schema;
        }
        Reflect.defineMetadata(ROUTES_META, routes, target.constructor);
    };
}
// ─── OpenApi decorator ─────────────────────────────────────────────────────────
export function ApiOperation(op) {
    return (target, propertyKey, _descriptor) => {
        const routes = Reflect.getMetadata(ROUTES_META, target.constructor) ?? [];
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
export function Config(envKey, options) {
    return (target, propertyKey) => {
        const fields = Reflect.getMetadata(CONFIG_META, target.constructor ?? target) ?? [];
        fields.push({
            propertyKey: String(propertyKey),
            envKey,
            encrypted: options?.encrypted ?? false,
            required: options?.required ?? true,
        });
        Reflect.defineMetadata(CONFIG_META, fields, target.constructor ?? target);
    };
}
export function getConfigFields(target) {
    return Reflect.getMetadata(CONFIG_META, target) ?? [];
}
export function Command(name, description = '') {
    return (target, propertyKey, _descriptor) => {
        const cmds = Reflect.getMetadata(COMMAND_META, target.constructor) ?? [];
        cmds.push({ name, description, handlerMethod: String(propertyKey) });
        Reflect.defineMetadata(COMMAND_META, cmds, target.constructor);
    };
}
export function getCommandMeta(target) {
    return Reflect.getMetadata(COMMAND_META, target) ?? [];
}
//# sourceMappingURL=decorators.js.map