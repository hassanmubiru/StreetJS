---
layout:    default
title:     "Dependency Injection"
parent:    "Core"
nav_order: 1
permalink: /core/dependency-injection/
description: "Dependency injection in StreetJS — an IoC container with constructor injection, singletons and circular-dependency detection for TypeScript."
---

# Dependency Injection

street ships with a lightweight IoC (Inversion of Control) container that resolves constructor dependencies automatically using TypeScript's emitted decorator metadata. No configuration files, no token symbols, no factory functions for the common case.

---

## Core concepts

### Inversion of Control

Without IoC, a controller directly creates its dependencies:

```typescript
// Tightly coupled — hard to test, hard to swap
class UserController {
  private service = new UserService(new UserRepository(new PgPool(...)));
}
```

With IoC, dependencies are declared and injected:

```typescript
// Loosely coupled — UserController doesn't know how UserService is built
@Injectable()
class UserController {
  constructor(private readonly service: UserService) {}
}
```

The container handles the construction graph. This means:
- Services are singletons by default — one instance shared across the app
- Swapping an implementation means registering a different instance: `container.register(UserService, mockService)`
- Circular dependencies are detected at startup, not runtime

### Why constructor injection?

street only supports constructor injection (not property injection or method injection). This is a deliberate constraint:

- Dependencies are explicit and visible in the constructor signature
- The class cannot be instantiated without its dependencies being satisfied
- TypeScript emits the constructor parameter types as metadata, enabling automatic resolution
- Testing is straightforward: `new UserController(mockService)`

---

## The `@Injectable()` decorator

Mark any class as injectable to enable automatic resolution:

```typescript
import { Injectable } from '../core/container.js';

@Injectable()
export class PaymentService {
  charge(amount: number): boolean {
    // ...
    return true;
  }
}
```

`@Injectable()` calls `Reflect.defineMetadata('street:injectable', true, target)`. While the container does not strictly require this mark for resolution (TypeScript metadata is emitted regardless), it serves as documentation and allows future tools to detect injectable classes.

---

## The Container

The global container is a singleton accessible via `container`:

```typescript
import { container } from '../core/container.js';
```

### `container.resolve<T>(ctor)`

Resolves a class, constructing it and all its transitive dependencies:

```typescript
const service = container.resolve(UserService);
```

Resolution steps:
1. Check the singleton registry — if already resolved, return it
2. Check the resolving set — if present, throw `CircularDependencyError`
3. Read `design:paramtypes` metadata from TypeScript
4. Recursively resolve each parameter type
5. Construct the class with resolved dependencies
6. Store in singleton registry
7. Return the instance

### `container.register<T>(ctor, instance)`

Register a pre-built instance. Used for:
- Providing configured singleton values (e.g., `AppConfig`, `PgPool`)
- Injecting test doubles without subclassing

```typescript
// Register configured instances
container.register(AppConfig, config);
container.register(PgPool, pool);

// Register a mock for testing
const mockPool = { query: async () => ({ rows: [], command: 'SELECT', rowCount: 0 }) };
container.register(PgPool, mockPool as unknown as PgPool);
```

### `container.has(ctor)`

Check if a class has been resolved or registered:

```typescript
if (!container.has(PgPool)) {
  throw new Error('PgPool must be registered before services');
}
```

### `container.reset()`

Clear all registrations. Use in tests to isolate each suite:

```typescript
beforeEach(() => {
  container.reset();
});
```

---

## Resolution walkthrough

Given this dependency graph:

```
UserController
  └── UserService
        └── UserRepository
              └── PgPool      ← registered externally
        └── AppConfig         ← registered externally
```

Resolution of `UserController` proceeds as follows:

```typescript
// 1. main.ts registers root-level singletons
container.register(AppConfig, config);
container.register(PgPool, pool);

// 2. Framework resolves UserController
app.registerController(UserController);
// → container.resolve(UserController)
//   → reads design:paramtypes: [UserService]
//   → container.resolve(UserService)
//     → reads design:paramtypes: [UserRepository, AppConfig]
//     → container.resolve(UserRepository)
//       → reads design:paramtypes: [PgPool]
//       → container.resolve(PgPool) → returns registered instance
//       → new UserRepository(pool)
//       → stores singleton
//     → container.resolve(AppConfig) → returns registered instance
//     → new UserService(repo, config)
//     → stores singleton
//   → new UserController(userService)
//   → stores singleton
```

Every class is instantiated exactly once.

---

## Circular dependency detection

The container tracks the resolution chain. If a class appears twice in the chain, it throws immediately:

```typescript
@Injectable()
class A {
  constructor(private b: B) {}
}

@Injectable()
class B {
  constructor(private a: A) {}
}

container.resolve(A);
// Error: Circular dependency detected while resolving: A.
// Resolution chain: A -> B -> A
```

This surfaces the problem at startup rather than causing a stack overflow at request time.

---

## Full example: three-tier injection

```typescript
// src/database/pool.ts (registered manually in main.ts)
export class PgPool { /* ... */ }

// src/services/product.repository.ts
import { Injectable } from '../core/container.js';
import { PgPool } from '../database/pool.js';
import { StreetPostgresRepository } from '../database/repository.js';

@Injectable()
export class ProductRepository extends StreetPostgresRepository<Product> {
  protected readonly tableName = 'products';

  constructor(pool: PgPool) {
    super(pool);
  }

  protected mapRow(row: Record<string, string | null>): Product {
    return {
      id: row['id'] ?? '',
      name: row['name'] ?? '',
      price: parseFloat(row['price'] ?? '0'),
      createdAt: row['created_at'] ?? '',
    };
  }
}

// src/services/product.service.ts
import { Injectable } from '../core/container.js';
import { ProductRepository } from './product.repository.js';
import { AppConfig } from '../config/index.js';

@Injectable()
export class ProductService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly config: AppConfig,
  ) {}

  async findAll(): Promise<Product[]> {
    return this.repo.findAll(100, 0);
  }
}

// src/controllers/product.controller.ts
import { Injectable } from '../core/container.js';
import { Controller, Get } from '../core/decorators.js';
import type { StreetContext } from '../core/context.js';
import { ProductService } from '../services/product.service.js';

@Injectable()
@Controller('/api/products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get('/')
  async list(ctx: StreetContext): Promise<void> {
    const items = await this.products.findAll();
    ctx.json({ items });
  }
}
```

Register in `main.ts`:

```typescript
// PgPool and AppConfig registered first (they have no resolvable deps)
container.register(AppConfig, config);
container.register(PgPool, pool);

// ProductController resolved automatically — pulls in ProductService → ProductRepository → PgPool
app.registerController(ProductController);
```

---

## Using the container directly

For cases where you need to resolve a service outside a controller:

```typescript
// In a CLI command, webhook handler, or background job
import { container } from '../core/container.js';
import { UserService } from '../services/user.service.js';

const userService = container.resolve(UserService);
const user = await userService.findById('abc-123');
```

---

## Testing with the container

When a container is passed to `streetApp` or `streetHttp2App` with
`containerOwnership: 'app'`, the application owns its registered resources.
Closing the application disposes those resources, including when listener
startup fails. Leave the default ownership as `external` when another
component is responsible for disposal.

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { container } from '../src/core/container.js';
import { UserService } from '../src/services/user.service.js';

describe('UserService', () => {
  beforeEach(() => {
    container.reset();

    // Register mocks
    container.register(AppConfig, {
      jwtSecret: 'test-secret-at-least-32-chars-here!!',
    } as AppConfig);

    container.register(PgPool, {
      query: async (sql: string) => {
        if (sql.includes('SELECT')) return { rows: [], command: 'SELECT', rowCount: 0 };
        return { rows: [{ id: 'uuid-1', email: 'a@b.com', name: 'Alice' }], command: 'INSERT', rowCount: 1 };
      },
      transaction: async (fn: Function) => fn({ query: async () => ({ rows: [], command: '', rowCount: 0 }) }),
    } as unknown as PgPool);
  });

  it('register creates a user', async () => {
    const service = container.resolve(UserService);
    const user = await service.register({
      email: 'test@example.com',
      name: 'Test',
      password: 'password123',
    });
    assert.ok(user.id);
  });
});
```
