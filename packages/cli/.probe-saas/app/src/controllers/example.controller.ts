// src/controllers/example.controller.ts
// Example REST controller demonstrating CRUD operations.

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  ApiOperation,
  container,
} from 'streetjs';
import type { StreetContext } from 'streetjs';
import { ExampleService, CreateItemInput, UpdateItemInput } from '../services/example.service.js';

@Controller('/api/items')
export class ExampleController {
  private readonly exampleService = container.resolve(ExampleService);

  @Get('/')
  @ApiOperation({ summary: 'List all items', tags: ['items'] })
  async findAll(ctx: StreetContext): Promise<void> {
    const page = parseInt(ctx.query['page'] ?? '1', 10);
    const limit = parseInt(ctx.query['limit'] ?? '20', 10);
    const result = await this.exampleService.findAll(page, limit);
    ctx.json(result);
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Get item by ID', tags: ['items'] })
  async findById(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) {
      ctx.json({ error: 'Missing id parameter' }, 400);
      return;
    }
    const item = await this.exampleService.findById(id);
    if (!item) {
      ctx.json({ error: 'Item not found' }, 404);
      return;
    }
    ctx.json(item);
  }

  @Post('/')
  @ApiOperation({ summary: 'Create a new item', tags: ['items'] })
  async create(ctx: StreetContext): Promise<void> {
    const data = ctx.body as Record<string, unknown> | null;
    if (!data || typeof data !== 'object' || !data['name'] || typeof data['name'] !== 'string') {
      ctx.json({ error: 'Invalid request body — name is required' }, 400);
      return;
    }
    const input: CreateItemInput = {
      name: data['name'],
      description: typeof data['description'] === 'string' ? data['description'] : undefined,
    };
    const item = await this.exampleService.create(input);
    ctx.json(item, 201);
  }

  @Put('/:id')
  @ApiOperation({ summary: 'Update an item', tags: ['items'] })
  async update(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    const data = ctx.body as Record<string, unknown> | null;
    if (!id || !data) {
      ctx.json({ error: 'Missing id or body' }, 400);
      return;
    }
    const item = await this.exampleService.update(id, data as UpdateItemInput);
    if (!item) {
      ctx.json({ error: 'Item not found' }, 404);
      return;
    }
    ctx.json(item);
  }

  @Delete('/:id')
  @ApiOperation({ summary: 'Delete an item', tags: ['items'] })
  async delete(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) {
      ctx.json({ error: 'Missing id parameter' }, 400);
      return;
    }
    await this.exampleService.delete(id);
    ctx.send(204);
  }
}
