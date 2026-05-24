// src/core/container.ts
// Dependency injection container with singleton registry and circular dep detection.
import 'reflect-metadata';
const INJECTABLE_META = Symbol('street:injectable');
/** Mark a class as injectable and register its dependencies */
export function Injectable() {
    return (target) => {
        Reflect.defineMetadata(INJECTABLE_META, true, target);
    };
}
/** Container manages singleton instances and resolves dependency trees */
export class Container {
    static instance = new Container();
    singletons = new Map();
    resolving = new Set();
    constructor() { }
    static getInstance() {
        return Container.instance;
    }
    /** Register a pre-built instance */
    register(token, instance) {
        this.singletons.set(token, instance);
    }
    /** Resolve a class, creating it if not already instantiated */
    resolve(token) {
        const existing = this.singletons.get(token);
        if (existing) {
            return existing;
        }
        if (this.resolving.has(token)) {
            throw new Error(`Circular dependency detected while resolving: ${token.name}. ` +
                `Resolution chain: ${[...this.resolving].map((c) => c.name).join(' -> ')} -> ${token.name}`);
        }
        this.resolving.add(token);
        try {
            const paramTypes = Reflect.getMetadata('design:paramtypes', token) ?? [];
            const deps = paramTypes.map((dep) => {
                if (!dep || dep === Object) {
                    throw new Error(`Cannot resolve dependency for ${token.name}: got primitive or undefined type. ` +
                        `Ensure emitDecoratorMetadata is enabled and the dependency is decorated with @Injectable.`);
                }
                return this.resolve(dep);
            });
            const instance = new token(...deps);
            this.singletons.set(token, instance);
            return instance;
        }
        finally {
            this.resolving.delete(token);
        }
    }
    /** Remove all registered instances (useful in tests) */
    reset() {
        this.singletons.clear();
        this.resolving.clear();
    }
    /** Check if a token has been resolved or registered */
    has(token) {
        return this.singletons.has(token);
    }
}
/** Global container singleton */
export const container = Container.getInstance();
//# sourceMappingURL=container.js.map