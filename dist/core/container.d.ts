import 'reflect-metadata';
import type { Constructor } from './types.js';
/** Mark a class as injectable and register its dependencies */
export declare function Injectable(): ClassDecorator;
/** Container manages singleton instances and resolves dependency trees */
export declare class Container {
    private static readonly instance;
    private readonly singletons;
    private readonly resolving;
    private constructor();
    static getInstance(): Container;
    /** Register a pre-built instance */
    register<T extends object>(token: Constructor<T>, instance: T): void;
    /** Resolve a class, creating it if not already instantiated */
    resolve<T extends object>(token: Constructor<T>): T;
    /** Remove all registered instances (useful in tests) */
    reset(): void;
    /** Check if a token has been resolved or registered */
    has(token: Constructor): boolean;
}
/** Global container singleton */
export declare const container: Container;
//# sourceMappingURL=container.d.ts.map