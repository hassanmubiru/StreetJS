import type { MiddlewareFn } from '../core/types.js';
import type { Constructor } from '../core/types.js';
export interface StreetAppOptions {
    port?: number;
    host?: string;
    globalMiddlewares?: MiddlewareFn[];
    requestTimeoutMs?: number;
    maxBodyBytes?: number;
    uploadsDir?: string;
}
export interface StreetApp {
    listen(port?: number, host?: string): Promise<void>;
    close(): Promise<void>;
    registerController(ctor: Constructor): void;
    use(mw: MiddlewareFn): void;
    openApiSpec(): object;
}
export declare function streetApp(options?: StreetAppOptions): StreetApp;
//# sourceMappingURL=server.d.ts.map