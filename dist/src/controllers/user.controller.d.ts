import type { StreetContext } from '../core/context.js';
import { UserService } from '../services/user.service.js';
import { StreetWebSocketServer } from '../websocket/server.js';
export declare class UserController {
    private readonly userService;
    private readonly wsServer;
    constructor(userService: UserService, wsServer: StreetWebSocketServer);
    list(ctx: StreetContext): Promise<void>;
    getOne(ctx: StreetContext): Promise<void>;
    create(ctx: StreetContext): Promise<void>;
    login(ctx: StreetContext): Promise<void>;
    update(ctx: StreetContext): Promise<void>;
    remove(ctx: StreetContext): Promise<void>;
    eventStream(ctx: StreetContext): Promise<void>;
    upload(ctx: StreetContext): Promise<void>;
}
//# sourceMappingURL=user.controller.d.ts.map