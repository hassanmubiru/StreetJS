// src/controllers/user.controller.ts
// User REST controller: CRUD, login, SSE stream, file upload.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '../core/container.js';
import { Controller, Get, Post, Put, Delete, Validate, ApiOperation, } from '../core/decorators.js';
import { UserService } from '../services/user.service.js';
import { StreetWebSocketServer } from '../websocket/server.js';
import { createSse } from '../websocket/sse.js';
import { NotFoundException, BadRequestException } from '../http/exceptions.js';
import { createUserSchema, updateUserSchema, loginSchema, getUserByIdSchema, } from '../domain/user.js';
/**
 * Derive audit context (originating IP and user agent) from a request so
 * authentication audit entries carry request metadata. The IP is taken from
 * the `x-forwarded-for` header when present, falling back to the socket's
 * remote address.
 */
function requestAuditContext(ctx) {
    const forwarded = ctx.headers['x-forwarded-for'];
    const ip = (forwarded ? forwarded.split(',')[0]?.trim() : undefined)
        ?? ctx.req.socket.remoteAddress
        ?? undefined;
    const userAgent = ctx.headers['user-agent'];
    return { ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}) };
}
let UserController = class UserController {
    userService;
    wsServer;
    constructor(userService, wsServer) {
        this.userService = userService;
        this.wsServer = wsServer;
    }
    async list(ctx) {
        const page = parseInt(String(ctx.query['page'] ?? '1'), 10);
        const limit = parseInt(String(ctx.query['limit'] ?? '20'), 10);
        const result = await this.userService.findAll(page, limit);
        ctx.json(result);
    }
    async getOne(ctx) {
        const id = ctx.params['id'];
        if (!id)
            throw new BadRequestException('Missing id');
        const user = await this.userService.findById(id);
        ctx.json(user);
    }
    async create(ctx) {
        const dto = ctx.body;
        const user = await this.userService.register(dto);
        // Broadcast user-created event to all WS clients
        this.wsServer.broadcast('user:created', { id: user.id, email: user.email });
        ctx.json(user, 201);
    }
    async login(ctx) {
        const dto = ctx.body;
        // Forward request context so login_success / login_failure audit entries
        // capture the originating IP and user agent.
        const tokens = await this.userService.login(dto, requestAuditContext(ctx));
        ctx.json(tokens);
    }
    async logout(ctx) {
        const userId = ctx.user?.id;
        if (!userId)
            throw new BadRequestException('Not authenticated');
        await this.userService.logout(userId, requestAuditContext(ctx));
        ctx.send(204);
    }
    async update(ctx) {
        const id = ctx.params['id'];
        if (!id)
            throw new BadRequestException('Missing id');
        const dto = ctx.body;
        const updated = await this.userService.update(id, dto);
        this.wsServer.broadcast('user:updated', { id: updated.id });
        ctx.json(updated);
    }
    async remove(ctx) {
        const id = ctx.params['id'];
        if (!id)
            throw new BadRequestException('Missing id');
        await this.userService.remove(id);
        this.wsServer.broadcast('user:deleted', { id });
        ctx.send(204);
    }
    async eventStream(ctx) {
        const id = ctx.params['id'];
        if (!id)
            throw new NotFoundException('Missing id');
        // Verify user exists
        await this.userService.findById(id);
        const sse = createSse(ctx.res, 20_000);
        sse.send({ event: 'connected', data: { userId: id, ts: Date.now() } });
        // Send a mock stream of events (real app would subscribe to change feed)
        let count = 0;
        const interval = setInterval(() => {
            if (sse.closed || count >= 10) {
                clearInterval(interval);
                sse.close();
                return;
            }
            sse.send({ event: 'ping', data: { userId: id, seq: ++count } });
        }, 2_000);
        interval.unref();
        ctx.res.once('close', () => clearInterval(interval));
    }
    async upload(ctx) {
        if (ctx.files.length === 0) {
            throw new BadRequestException('No file uploaded');
        }
        const file = ctx.files[0];
        ctx.json({
            message: 'File uploaded successfully',
            file: {
                name: file.originalName,
                size: file.size,
                mimeType: file.mimeType,
                path: file.path,
            },
        }, 201);
    }
};
__decorate([
    Get('/'),
    ApiOperation({ summary: 'List users', tags: ['users'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "list", null);
__decorate([
    Get('/:id'),
    Validate(getUserByIdSchema),
    ApiOperation({ summary: 'Get user by ID', tags: ['users'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getOne", null);
__decorate([
    Post('/'),
    Validate(createUserSchema),
    ApiOperation({ summary: 'Register a new user', tags: ['users'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "create", null);
__decorate([
    Post('/login'),
    Validate(loginSchema),
    ApiOperation({ summary: 'Login and obtain JWT', tags: ['auth'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "login", null);
__decorate([
    Post('/logout'),
    ApiOperation({ summary: 'Log out the authenticated user', tags: ['auth'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "logout", null);
__decorate([
    Put('/:id'),
    Validate({ ...getUserByIdSchema, body: updateUserSchema.body }),
    ApiOperation({ summary: 'Update user', tags: ['users'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "update", null);
__decorate([
    Delete('/:id'),
    Validate(getUserByIdSchema),
    ApiOperation({ summary: 'Delete user', tags: ['users'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "remove", null);
__decorate([
    Get('/:id/stream'),
    ApiOperation({ summary: 'SSE stream for user events', tags: ['users', 'sse'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "eventStream", null);
__decorate([
    Post('/upload'),
    ApiOperation({ summary: 'Upload a file for a user', tags: ['users'] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "upload", null);
UserController = __decorate([
    Injectable(),
    Controller('/api/users'),
    __metadata("design:paramtypes", [UserService,
        StreetWebSocketServer])
], UserController);
export { UserController };
//# sourceMappingURL=user.controller.js.map