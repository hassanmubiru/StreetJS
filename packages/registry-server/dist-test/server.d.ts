import { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { RegistryService } from './registry.js';
import type { RegistryErrorCode } from './types.js';
/** Map a registry error code to an HTTP status. */
export declare function statusForError(code: RegistryErrorCode): number;
/** Build the request handler for a given service (usable in tests without a socket). */
export declare function createRequestHandler(service: RegistryService): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export interface RegistryServerHandle {
    server: Server;
    service: RegistryService;
    close: () => Promise<void>;
}
/** Start an HTTP registry server bound to `port` (0 = ephemeral). */
export declare function createRegistryServer(service: RegistryService): Server;
/** Start and begin listening; resolves once bound. */
export declare function startRegistryServer(service: RegistryService, port?: number, host?: string): Promise<RegistryServerHandle>;
//# sourceMappingURL=server.d.ts.map