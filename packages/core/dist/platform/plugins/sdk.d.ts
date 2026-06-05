import type { MiddlewareFn } from '../../core/types.js';
/**
 * Sandboxed application interface exposed to plugins.
 * Plugins receive this restricted view — they cannot access the DI container
 * or internal server state directly.
 */
export interface SandboxedApp {
    /** Register a middleware function */
    use(middleware: MiddlewareFn): void;
    /** Listen for framework lifecycle events */
    on(event: string, handler: (...args: unknown[]) => void): void;
}
/**
 * Abstract base class for all Street plugins.
 * Subclass this and implement `name` and `version` to create a plugin.
 */
export declare abstract class PluginModule {
    /** Unique plugin identifier */
    abstract readonly name: string;
    /** Semver version string */
    abstract readonly version: string;
    /**
     * Called once when the plugin is installed for the first time.
     * Use this to run one-time setup (e.g. database migrations).
     */
    onInstall?(): Promise<void>;
    /**
     * Called each time the application loads the plugin.
     * Register middlewares and event listeners via the sandboxed app.
     */
    onLoad?(app: SandboxedApp): Promise<void>;
    /**
     * Called when the plugin is unloaded.
     * Clean up resources, remove listeners, etc.
     */
    onUnload?(app: SandboxedApp): Promise<void>;
}
//# sourceMappingURL=sdk.d.ts.map