import 'reflect-metadata';
import type { MiddlewareFn, RouteMetadata, ControllerMetadata, ValidationSchema, OpenApiOperation } from './types.js';
export declare function Controller(prefix: string, ...middlewares: MiddlewareFn[]): ClassDecorator;
export declare function getControllerMeta(target: unknown): ControllerMetadata | undefined;
export declare function getRoutesMeta(target: unknown): RouteMetadata[];
export declare function Get(path: string, ...middlewares: MiddlewareFn[]): MethodDecorator;
export declare function Post(path: string, ...middlewares: MiddlewareFn[]): MethodDecorator;
export declare function Put(path: string, ...middlewares: MiddlewareFn[]): MethodDecorator;
export declare function Delete(path: string, ...middlewares: MiddlewareFn[]): MethodDecorator;
export declare function Patch(path: string, ...middlewares: MiddlewareFn[]): MethodDecorator;
export declare function Validate(schema: ValidationSchema): MethodDecorator;
export declare function ApiOperation(op: OpenApiOperation): MethodDecorator;
export interface ConfigField {
    propertyKey: string;
    envKey: string;
    encrypted: boolean;
    required: boolean;
}
export declare function Config(envKey: string, options?: {
    encrypted?: boolean;
    required?: boolean;
}): PropertyDecorator;
export declare function getConfigFields(target: unknown): ConfigField[];
export interface CommandMetadata {
    name: string;
    description: string;
    handlerMethod: string;
}
export declare function Command(name: string, description?: string): MethodDecorator;
export declare function getCommandMeta(target: unknown): CommandMetadata[];
//# sourceMappingURL=decorators.d.ts.map