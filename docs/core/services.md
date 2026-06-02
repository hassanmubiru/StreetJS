---
layout:    default
title:     "Services"
parent:    "Core"
nav_order: 4
permalink: /core/services/
description: "How to write services in Street Framework — business logic layer, @Injectable decorator, constructor injection."
---

# Services

Services contain your application's business logic. They are plain TypeScript classes decorated with `@Injectable()` so the IoC container can resolve and inject them.

---

## Anatomy of a service

```typescript
// src/services/product.service.ts
import { Injectable } from '@streetjs/core';
import { ProductRepository } from '../repositories/product.repository.js';
import { NotFoundException } from '@streetjs/core';

export interface Product {
  id: string;
  name: string;
  price: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductInput {
  name: string;
  price: number;
}

@Injectable()
export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
  ) {}

  async findAll(page: number, limit: number) {
    return this.repository.findAll(page, limit);
  }

  async findById(id: string): Promise<Product> {
    const product = await this.repository.findById(id);
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async create(input: CreateProductInput): Promise<Product> {
    const now = new Date();
    const product: Product = {
      id:        crypto.randomUUID(),
      name:      input.name,
      price:     input.price,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(product);
    return product;
  }

  async update(id: string, input: Partial<CreateProductInput>): Promise<Product> {
    const existing = await this.findById(id);
    const updated: Product = { ...existing, ...input, updatedAt: new Date() };
    await this.repository.update(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);   // throws NotFoundException if missing
    await this.repository.delete(id);
  }
}
```

---

## The `@Injectable()` decorator

`@Injectable()` marks a class for IoC resolution. Under the hood it calls `Reflect.defineMetadata` to record the class so the container can find it.

```typescript
import { Injectable } from '@streetjs/core';

@Injectable()
export class EmailService {
  async send(to: string, subject: string, body: string): Promise<void> {
    // ...
  }
}
```

**Rules:**
- Every class that is injected into another class must be decorated with `@Injectable()`
- The decorator must appear before any other decorators on the class
- `import 'reflect-metadata'` must be the first import in your entry point (`src/main.ts`)

---

## Constructor injection

Dependencies are declared as constructor parameters. The container reads the parameter types via `Reflect.getMetadata('design:paramtypes', ...)` and resolves each one automatically.

```typescript
@Injectable()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly products: ProductService,
    private readonly email: EmailService,
  ) {}

  async placeOrder(userId: string, productId: string): Promise<Order> {
    const product = await this.products.findById(productId);
    const order = await this.orders.create({ userId, productId, total: product.price });
    await this.email.send(userId, 'Order confirmed', `Order #${order.id} placed.`);
    return order;
  }
}
```

The container resolves `OrderRepository`, `ProductService`, and `EmailService` automatically — no manual wiring needed.

---

## Manual registration

For services that require runtime configuration (e.g. a database pool, a secret key), register them manually before the container resolves anything:

```typescript
// src/main.ts
import { container, PgPool, JwtService } from '@streetjs/core';

const pool = new PgPool({ /* ... */ });
await pool.initialize();

container.register(PgPool, pool);
container.register(JwtService, new JwtService(process.env['JWT_SECRET']!));
```

After manual registration, any `@Injectable()` class that declares `PgPool` or `JwtService` as a constructor parameter will receive the registered instance.

---

## Singleton behaviour

The container stores one instance per class. The first `container.resolve(MyService)` creates the instance; subsequent calls return the same object.

```typescript
const a = container.resolve(ProductService);
const b = container.resolve(ProductService);
console.log(a === b);  // true
```

This means services are stateful across requests. Keep per-request state in `ctx.state`, not in service properties.

---

## Accessing the container directly

In rare cases (e.g. a factory function, a gateway), resolve a service directly:

```typescript
import { container } from '@streetjs/core';
import { NotificationService } from './notification.service.js';

// Inside a WebSocket handler
const notifications = container.resolve(NotificationService);
await notifications.push(userId, message);
```

---

## Service layer patterns

### Validation in services

Validate business rules in the service, not the controller:

```typescript
async register(email: string, password: string): Promise<User> {
  if (password.length < 8) {
    throw new BadRequestException('Password must be at least 8 characters');
  }
  const exists = await this.repository.emailExists(email);
  if (exists) {
    throw new ConflictException(`Email ${email} is already registered`);
  }
  // ...
}
```

### Pagination

Return a consistent pagination shape:

```typescript
async findAll(page: number, limit: number) {
  const offset = (page - 1) * limit;
  const [items, total] = await Promise.all([
    this.repository.list(limit, offset),
    this.repository.count(),
  ]);
  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}
```

### Transactions

For multi-step operations that must be atomic, use the pool directly:

```typescript
import { container, PgPool } from '@streetjs/core';

@Injectable()
export class TransferService {
  private readonly pool = container.resolve(PgPool);

  async transfer(fromId: string, toId: string, amount: number): Promise<void> {
    await this.pool.query('BEGIN');
    try {
      await this.pool.query(
        'UPDATE accounts SET balance = balance - $1 WHERE id = $2',
        [amount, fromId]
      );
      await this.pool.query(
        'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
        [amount, toId]
      );
      await this.pool.query('COMMIT');
    } catch (err) {
      await this.pool.query('ROLLBACK');
      throw err;
    }
  }
}
```

---

## Testing services

Services are plain classes — test them directly without HTTP:

```typescript
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { container } from '@streetjs/core';
import { ProductService } from '../src/services/product.service.js';

describe('ProductService', () => {
  let service: ProductService;

  before(() => {
    service = container.resolve(ProductService);
  });

  it('creates a product', async () => {
    const product = await service.create({ name: 'Widget', price: 9.99 });
    assert.equal(product.name, 'Widget');
    assert.equal(product.price, 9.99);
    assert.ok(product.id);
  });

  it('throws NotFoundException for unknown id', async () => {
    await assert.rejects(
      () => service.findById('00000000-0000-0000-0000-000000000000'),
      { name: 'NotFoundException' }
    );
  });
});
```
