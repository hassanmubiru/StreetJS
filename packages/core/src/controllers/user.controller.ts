// src/controllers/user.controller.ts
// User REST controller: CRUD, login, SSE stream, file upload.

import { Injectable } from '../core/container.js';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Validate,
  ApiOperation,
} from '../core/decorators.js';
import type { StreetContext } from '../core/context.js';
import { UserService } from '../services/user.service.js';
import { StreetWebSocketServer } from '../websocket/server.js';
import { createSse } from '../websocket/sse.js';
import { NotFoundException, BadRequestException } from '../http/exceptions.js';
import {
  createUserSchema,
  updateUserSchema,
  loginSchema,
  getUserByIdSchema,
  type CreateUserDto,
  type UpdateUserDto,
  type LoginDto,
} from '../domain/user.js';

@Injectable()
@Controller('/api/users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly wsServer: StreetWebSocketServer
  ) {}

  @Get('/')
  @ApiOperation({ summary: 'List users', tags: ['users'] })
  async list(ctx: StreetContext): Promise<void> {
    const page = parseInt(String(ctx.query['page'] ?? '1'), 10);
    const limit = parseInt(String(ctx.query['limit'] ?? '20'), 10);
    const result = await this.userService.findAll(page, limit);
    ctx.json(result);
  }

  @Get('/:id')
  @Validate(getUserByIdSchema)
  @ApiOperation({ summary: 'Get user by ID', tags: ['users'] })
  async getOne(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) throw new BadRequestException('Missing id');
    const user = await this.userService.findById(id);
    ctx.json(user);
  }

  @Post('/')
  @Validate(createUserSchema)
  @ApiOperation({ summary: 'Register a new user', tags: ['users'] })
  async create(ctx: StreetContext): Promise<void> {
    const dto = ctx.body as CreateUserDto;
    const user = await this.userService.register(dto);
    // Broadcast user-created event to all WS clients
    this.wsServer.broadcast('user:created', { id: user.id, email: user.email });
    ctx.json(user, 201);
  }

  @Post('/login')
  @Validate(loginSchema)
  @ApiOperation({ summary: 'Login and obtain JWT', tags: ['auth'] })
  async login(ctx: StreetContext): Promise<void> {
    const dto = ctx.body as LoginDto;
    const tokens = await this.userService.login(dto);
    ctx.json(tokens);
  }

  @Put('/:id')
  @Validate({ ...getUserByIdSchema, body: updateUserSchema.body })
  @ApiOperation({ summary: 'Update user', tags: ['users'] })
  async update(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) throw new BadRequestException('Missing id');
    const dto = ctx.body as UpdateUserDto;
    const updated = await this.userService.update(id, dto);
    this.wsServer.broadcast('user:updated', { id: updated.id });
    ctx.json(updated);
  }

  @Delete('/:id')
  @Validate(getUserByIdSchema)
  @ApiOperation({ summary: 'Delete user', tags: ['users'] })
  async remove(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) throw new BadRequestException('Missing id');
    await this.userService.remove(id);
    this.wsServer.broadcast('user:deleted', { id });
    ctx.send(204);
  }

  @Get('/:id/stream')
  @ApiOperation({ summary: 'SSE stream for user events', tags: ['users', 'sse'] })
  async eventStream(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) throw new NotFoundException('Missing id');

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

  @Post('/upload')
  @ApiOperation({ summary: 'Upload a file for a user', tags: ['users'] })
  async upload(ctx: StreetContext): Promise<void> {
    if (ctx.files.length === 0) {
      throw new BadRequestException('No file uploaded');
    }
    const file = ctx.files[0]!;
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
}
