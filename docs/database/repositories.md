---
layout:    default
title:     "Repositories, Transactions & Migrations"
parent:    "Database"
nav_order: 2
permalink: /database/repositories/
---

# Repositories

The repository pattern separates data access from business logic. Every database entity gets a repository class that handles SQL queries and maps raw rows to typed objects.

---

## IRepository interface

```typescript
interface IRepository<T> {
  findById(id: string): Promise<T | null>;
  findAll(limit: number, offset: number): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
}
```

---

## Creating a repository

Extend `StreetPostgresRepository<T>` and implement two abstract members:

```typescript
import { Injectable } from '../core/container.js';
import { StreetPostgresRepository } from '../database/repository.js';
import { PgPool } from '../database/pool.js';

export interface Order {
  id: string;
  user_id: string;
  total: string;
  status: string;
  created_at: string;
}

@Injectable()
export class OrderRepository extends StreetPostgresRepository<Order> {
  protected readonly tableName = 'orders';   // ← table name

  constructor(pool: PgPool) {
    super(pool);
  }

  // ← map raw DB row (all strings) to your typed entity
  protected mapRow(row: Record<string, string | null>): Order {
    return {
      id:         row['id']         ?? '',
      user_id:    row['user_id']    ?? '',
      total:      row['total']      ?? '0',
      status:     row['status']     ?? 'pending',
      created_at: row['created_at'] ?? '',
    };
  }
}
```

### What you get for free

```typescript
const repo = container.resolve(OrderRepository);

// Find by primary key (UUID)
const order = await repo.findById('abc-123');         // Order | null

// Paginated list, ordered by created_at DESC
const orders = await repo.findAll(20, 0);             // Order[]

// Insert — pass any Partial<Order>, receives full row with DB defaults
const newOrder = await repo.create({
  id: generateUuid(),
  user_id: userId,
  total: '99.99',
  status: 'pending',
  created_at: new Date().toISOString(),
});

// Update — only specified fields are changed
const updated = await repo.update('abc-123', { status: 'shipped' });

// Delete
const wasDeleted = await repo.delete('abc-123');      // boolean

// Row count
const total = await repo.count();
```

---

## Custom query methods

Add domain-specific queries alongside the generic ones:

```typescript
@Injectable()
export class OrderRepository extends StreetPostgresRepository<Order> {
  protected readonly tableName = 'orders';

  constructor(pool: PgPool) {
    super(pool);
  }

  protected mapRow(row: Record<string, string | null>): Order { /* ... */ }

  // Custom query: find by user
  async findByUserId(userId: string, limit = 20): Promise<Order[]> {
    const safeId = userId.replace(/'/g, "''");
    const result = await this.pool.query(
      `SELECT * FROM orders
       WHERE user_id = '${safeId}'
       ORDER BY created_at DESC
       LIMIT ${Math.min(limit, 1000)}`
    );
    return result.rows.map((r) => this.mapRow(r as Record<string, string | null>));
  }

  // Aggregate query
  async totalRevenueByUser(userId: string): Promise<number> {
    const safeId = userId.replace(/'/g, "''");
    const result = await this.pool.query(
      `SELECT COALESCE(SUM(total::numeric), 0) AS revenue
       FROM orders WHERE user_id = '${safeId}' AND status = 'completed'`
    );
    return parseFloat(result.rows[0]?.['revenue'] ?? '0');
  }

  // Find with join
  async findWithUserEmail(orderId: string): Promise<{ order: Order; email: string } | null> {
    const safeId = orderId.replace(/'/g, "''");
    const result = await this.pool.query(
      `SELECT o.*, u.email
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.id = '${safeId}'`
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as Record<string, string | null>;
    return {
      order: this.mapRow(row),
      email: row['email'] ?? '',
    };
  }
}
```

---

## Parameterized queries

The repository layer uses **parameterized queries** (`$1`, `$2`, `$N` placeholders) for all built-in CRUD operations. For custom queries, use parameters to prevent SQL injection:

```typescript
// Safe: parameterized query with placeholders
const result = await this.pool.query(
  `SELECT * FROM users WHERE email = $1 LIMIT 1`,
  [email.toLowerCase()]
);

// Safe: multiple parameters
await this.pool.query(
  `SELECT * FROM orders WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3`,
  [userId, status, Math.min(limit, 1000)]
);

// Safe: INSERT with parameters
await this.pool.query(
  `INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)`,
  [userId, email, name, passwordHash]
);

// Dangerous: never interpolate untrusted input directly
await this.pool.query(`SELECT * FROM users WHERE email = '${email}'`);  // ✗
```

All values are sent as separate parameters in the wire protocol — the database handles escaping, so there is no SQL injection risk. String, number, boolean, and null values are all supported.

---

# Transactions

Transactions guarantee that a group of database operations either all succeed or all fail together — ACID semantics.

---

## Pool-level transactions

The simplest way to run a transaction:

```typescript
await pool.transaction(async (conn) => {
  await conn.query(`UPDATE accounts SET balance = balance - 100 WHERE id = 'sender'`);
  await conn.query(`UPDATE accounts SET balance = balance + 100 WHERE id = 'receiver'`);
  // If either query throws, ROLLBACK is sent automatically
});
```

`pool.transaction()`:
1. Acquires a connection
2. Sends `BEGIN`
3. Calls your function with the connection
4. On success: sends `COMMIT`
5. On error: sends `ROLLBACK`, then re-throws the error
6. Releases the connection back to the pool

---

## Repository-level transactions

Via `withTransaction()`:

```typescript
@Injectable()
export class TransferService {
  constructor(private readonly repo: AccountRepository) {}

  async transfer(fromId: string, toId: string, amount: number): Promise<void> {
    await this.repo.withTransaction(async (conn) => {
      const from = await conn.query(
        `SELECT balance FROM accounts WHERE id = '${fromId}' FOR UPDATE`
      );
      const balance = parseFloat(from.rows[0]?.['balance'] ?? '0');

      if (balance < amount) {
        throw new Error('Insufficient funds');  // ← triggers ROLLBACK
      }

      await conn.query(
        `UPDATE accounts SET balance = balance - ${amount} WHERE id = '${fromId}'`
      );
      await conn.query(
        `UPDATE accounts SET balance = balance + ${amount} WHERE id = '${toId}'`
      );

      // Log the transfer atomically
      await conn.query(
        `INSERT INTO transfer_log (from_id, to_id, amount, created_at)
         VALUES ('${fromId}', '${toId}', ${amount}, NOW())`
      );
    });
  }
}
```

### `FOR UPDATE` and row locking

Use `SELECT ... FOR UPDATE` to lock rows you intend to modify within a transaction. This prevents concurrent transactions from reading the same row and causing a double-spend:

```typescript
// Lock the row for the duration of the transaction
const row = await conn.query(
  `SELECT * FROM orders WHERE id = '${orderId}' FOR UPDATE`
);
```

---

## Multi-operation transactions

For complex workflows involving multiple operations, use `pool.transaction()` to run them atomically:

```typescript
@Injectable()
export class OrderFulfillmentService {
  constructor(private readonly pool: PgPool) {}

  async fulfill(orderId: string): Promise<void> {
    await this.pool.transaction(async (conn) => {
      await conn.query(
        `UPDATE orders SET status = 'fulfilled', fulfilled_at = NOW()
         WHERE id = $1`,
        [orderId]
      );
      await conn.query(
        `INSERT INTO fulfillment_events (order_id, event, created_at)
         VALUES ($1, 'fulfilled', NOW())`,
        [orderId]
      );
      await conn.query(
        `UPDATE inventory SET reserved = reserved - 1
         WHERE product_id = (SELECT product_id FROM orders WHERE id = $1)`,
        [orderId]
      );
    });
  }
}
```

All operations run in one transaction — any failure rolls back all of them.

---

# Streaming Results

For queries that return thousands or millions of rows, streaming is essential. Buffering the full result set causes heap spikes that can trigger OOM kills.

---

## Basic streaming

```typescript
import { PgConnection } from '../database/wire.js';

const conn = await pool.acquire();
const stream = conn.queryStream(
  'SELECT id, email, created_at FROM users ORDER BY created_at'
);

let count = 0;

stream.on('data', (row: Record<string, string | null>) => {
  count++;
  // Process each row immediately — it is not held in memory after this callback
  processUser(row['id']!, row['email']!);
});

stream.on('end', () => {
  console.log(`Processed ${count} users`);
  pool.release(conn);
});

stream.on('error', (err) => {
  console.error('Stream error:', err);
  pool.release(conn);
});
```

### Memory profile

Without streaming: `SELECT *` on a 100,000-row table → ~50 MB heap spike.
With streaming: same query → ~2 MB steady state, regardless of table size.

---

## Streaming to an HTTP response

Send query results directly to the client without buffering:

```typescript
@Get('/export')
async exportCsv(ctx: StreetContext): Promise<void> {
  ctx.setHeader('Content-Type', 'text/csv');
  ctx.setHeader('Content-Disposition', 'attachment; filename="users.csv"');

  const conn = await this.pool.acquire();
  const stream = conn.queryStream('SELECT id, email, name, created_at FROM users');
  let first = true;

  ctx.res.write('id,email,name,created_at\n');   // CSV header

  stream.on('data', (row: Record<string, string | null>) => {
    const line = [row['id'], row['email'], row['name'], row['created_at']]
      .map((v) => `"${(v ?? '').replace(/"/g, '""')}"`)
      .join(',') + '\n';
    const canContinue = ctx.res.write(line);
    if (!canContinue) {
      stream.pause();   // Apply backpressure: HTTP response buffer is full
    }
  });

  ctx.res.on('drain', () => stream.resume());    // Resume when buffer drains
  stream.on('end', () => {
    ctx.res.end();
    this.pool.release(conn);
  });
  stream.on('error', (err) => {
    console.error(err);
    ctx.res.destroy();
    this.pool.release(conn);
  });
}
```

---

## Backpressure explained

Backpressure is the mechanism by which a slow consumer signals a fast producer to slow down.

```
PostgreSQL → TCP socket → PgConnection.buffer → StreetPostgresWireStream → Your code
```

When your code is slow (large CSV write, slow file I/O), the chain flows backwards:
1. `stream.pause()` stops emitting `data` events
2. `StreetPostgresWireStream._read()` stops pulling rows from the internal queue
3. The internal queue fills to `MAX_BUFFERED` (256 rows)
4. `push(row)` returns `false` → `socket.pause()` is called
5. The TCP receive buffer fills → the OS applies TCP backpressure to PostgreSQL
6. PostgreSQL slows down sending rows

When your code catches up, `ctx.res.on('drain')` fires, you call `stream.resume()`, and the chain flows forward again.

Without this mechanism, a slow HTTP client could cause unbounded heap growth.

---

# Migrations

Migrations are ordered SQL files that evolve the database schema safely. street's migration runner tracks applied migrations in a `street_migrations` table and ensures idempotency.

---

## File naming convention

```
migrations/
├── 001_create_users.sql
├── 001_create_users.rollback.sql
├── 002_create_orders.sql
├── 002_create_orders.rollback.sql
└── 003_add_users_phone.sql
```

Files are sorted lexicographically. The numeric prefix ensures correct order. Use zero-padded numbers to sort correctly past 9 (`001`, `002`, ..., `010`).

---

## Writing a migration

```sql
-- migrations/003_add_users_phone.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS
  phone VARCHAR(20);

CREATE INDEX IF NOT EXISTS users_phone_idx
  ON users (phone)
  WHERE phone IS NOT NULL;
```

### Rollback file

```sql
-- migrations/003_add_users_phone.rollback.sql
DROP INDEX IF EXISTS users_phone_idx;
ALTER TABLE users DROP COLUMN IF EXISTS phone;
```

---

## Running migrations

### Via CLI

```bash
node dist/src/main.js migrate
# [migrations] Applying: 003_add_users_phone.sql
# [migrations] Applied: 003_add_users_phone.sql
# [migrations] All migrations complete.
```

Re-running is safe — already-applied migrations are skipped:

```bash
node dist/src/main.js migrate
# [migrations] Skipping already applied: 001_create_users.sql
# [migrations] Skipping already applied: 002_create_orders.sql
# [migrations] Skipping already applied: 003_add_users_phone.sql
# [migrations] All migrations complete.
```

### Via API

```typescript
import { StreetMigrationRunner } from '../database/migrations.js';

const runner = container.resolve(StreetMigrationRunner);
await runner.run('./migrations');
```

### Rolling back

```bash
node dist/src/main.js migrate:rollback --steps 1
# [migrations] Rolling back: 003_add_users_phone.sql
# [migrations] Rolled back: 003_add_users_phone.sql
```

---

## The tracking table

The runner creates `street_migrations` automatically if it does not exist:

```sql
CREATE TABLE IF NOT EXISTS street_migrations (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

---

## Migration best practices

**Always use `IF NOT EXISTS` / `IF EXISTS`**

This makes individual migration files idempotent — they can be run multiple times without error (useful during development):

```sql
CREATE TABLE IF NOT EXISTS products (...);
CREATE INDEX IF NOT EXISTS products_name_idx ON products (name);
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
```

**Never modify an applied migration**

If you need to change something, write a new migration. The runner only checks file names, not content hashes.

**Test rollbacks before deploying**

```bash
# Apply
node dist/src/main.js migrate

# Verify the change
psql -c "\d users"

# Rollback
node dist/src/main.js migrate:rollback

# Verify rollback
psql -c "\d users"

# Re-apply
node dist/src/main.js migrate
```

**Run migrations before starting the server**

In Docker deployments, run migrations as an init container or a pre-start command:

```dockerfile
# docker-compose.yml
services:
  app:
    command: >
      sh -c "node dist/src/main.js migrate &&
             node dist/src/main.js"
```
