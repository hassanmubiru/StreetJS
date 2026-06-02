---
layout:    default
title:     "File Upload"
parent:    "Examples"
nav_order: 3
permalink: /examples/file-upload/
description: "Streaming file upload example with Street Framework — multipart/form-data, disk storage, validation."
---

# Example: File Upload

Streaming multipart file upload with type validation, size limits, and disk storage. The parser uses ≤128 KB of heap regardless of file size.

---

## Controller

```typescript
// src/controllers/upload.controller.ts
import {
  Controller, Post, Get, ApiOperation,
  BadRequestException, container,
} from '@streetjs/core';
import type { StreetContext } from '@streetjs/core';
import { UploadService } from '../services/upload.service.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_SIZE_BYTES = 10 * 1024 * 1024;  // 10 MB

@Controller('/api/uploads')
export class UploadController {
  private readonly svc = container.resolve(UploadService);

  @Post('/image')
  @ApiOperation({ summary: 'Upload an image', tags: ['uploads'] })
  async uploadImage(ctx: StreetContext): Promise<void> {
    if (ctx.files.length === 0) {
      throw new BadRequestException('No file provided');
    }

    const file = ctx.files[0]!;

    if (!ALLOWED_TYPES.has(file.mimeType)) {
      throw new BadRequestException(
        `File type ${file.mimeType} not allowed. Allowed: ${[...ALLOWED_TYPES].join(', ')}`
      );
    }

    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException(`File too large. Max size: ${MAX_SIZE_BYTES / 1024 / 1024} MB`);
    }

    const record = await this.svc.save({
      originalName: file.originalName,
      mimeType:     file.mimeType,
      size:         file.size,
      path:         file.path,
    });

    ctx.json({ id: record.id, url: `/api/uploads/${record.id}` }, 201);
  }

  @Post('/avatar')
  @ApiOperation({ summary: 'Upload user avatar', tags: ['uploads'] })
  async uploadAvatar(ctx: StreetContext): Promise<void> {
    if (!ctx.user) throw new BadRequestException('Authentication required');
    if (ctx.files.length === 0) throw new BadRequestException('No file provided');

    const file = ctx.files[0]!;
    if (!file.mimeType.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed for avatars');
    }

    const record = await this.svc.saveAvatar(ctx.user.id, {
      originalName: file.originalName,
      mimeType:     file.mimeType,
      size:         file.size,
      path:         file.path,
    });

    ctx.json({ avatarUrl: `/api/uploads/${record.id}` });
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Get upload metadata', tags: ['uploads'] })
  async getOne(ctx: StreetContext): Promise<void> {
    const record = await this.svc.findById(ctx.params['id']!);
    ctx.json(record);
  }
}
```

---

## Service

```typescript
// src/services/upload.service.ts
import { Injectable, container, PgPool, NotFoundException } from '@streetjs/core';
import { resolve } from 'node:path';

export interface UploadRecord {
  id:           string;
  userId:       string | null;
  originalName: string;
  mimeType:     string;
  size:         number;
  path:         string;
  createdAt:    Date;
}

@Injectable()
export class UploadService {
  private readonly pool = container.resolve(PgPool);

  async save(file: Omit<UploadRecord, 'id'|'userId'|'createdAt'>): Promise<UploadRecord> {
    const record: UploadRecord = {
      id: crypto.randomUUID(), userId: null,
      ...file, createdAt: new Date(),
    };
    await this.pool.query(
      `INSERT INTO uploads (id, user_id, original_name, mime_type, size, path, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [record.id, null, record.originalName, record.mimeType,
       record.size, record.path, record.createdAt.toISOString()]
    );
    return record;
  }

  async saveAvatar(userId: string, file: Omit<UploadRecord, 'id'|'userId'|'createdAt'>): Promise<UploadRecord> {
    const record: UploadRecord = {
      id: crypto.randomUUID(), userId,
      ...file, createdAt: new Date(),
    };
    await this.pool.query(
      `INSERT INTO uploads (id, user_id, original_name, mime_type, size, path, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [record.id, userId, record.originalName, record.mimeType,
       record.size, record.path, record.createdAt.toISOString()]
    );
    return record;
  }

  async findById(id: string): Promise<UploadRecord> {
    const result = await this.pool.query('SELECT * FROM uploads WHERE id = $1', [id]);
    if (!result.rows[0]) throw new NotFoundException(`Upload ${id} not found`);
    const row = result.rows[0] as Record<string, unknown>;
    return {
      id:           String(row['id']),
      userId:       row['user_id'] ? String(row['user_id']) : null,
      originalName: String(row['original_name']),
      mimeType:     String(row['mime_type']),
      size:         Number(row['size']),
      path:         String(row['path']),
      createdAt:    new Date(String(row['created_at'])),
    };
  }
}
```

---

## Migration

```sql
-- migrations/20260101000001_create_uploads.sql
CREATE TABLE uploads (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         REFERENCES users(id) ON DELETE SET NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size          BIGINT       NOT NULL,
  path          TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

---

## Test with curl

```bash
# Upload an image
curl -X POST http://localhost:3000/api/uploads/image \
  -F 'file=@/path/to/photo.jpg'
# {"id":"...","url":"/api/uploads/..."}

# Upload with wrong type
curl -X POST http://localhost:3000/api/uploads/image \
  -F 'file=@/path/to/script.sh'
# {"error":"File type application/x-sh not allowed...","statusCode":400}

# Get metadata
curl http://localhost:3000/api/uploads/<id>
# {"id":"...","originalName":"photo.jpg","mimeType":"image/jpeg","size":245678,...}
```
