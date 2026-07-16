# Architecture — @streetjs/repository

## Purpose

`@streetjs/repository` is the StreetJS data-access base layer: a generic,
strongly-typed CRUD repository over a PostgreSQL pool, plus a small atomic
"ledger" transaction helper. Domain repositories in an application extend
`StreetPostgresRepository<T>` and supply a table name and a row mapper.

## Dependencies

```
@streetjs/pool      (PgPool — the query/transaction/stream surface)
@streetjs/postgres  (PgConnection + StreetPostgresWireStream types)
```

No cyclic dependencies. Field-level encryption is decoupled via a structural
`FieldEncryptor` interface, so this package does **not** depend on the enterprise
data-policy module — any object with `encryptEntity`/`decryptEntity` qualifies
(the framework's `FieldEncryptor` class satisfies it structurally).

## Design

### Typed CRUD over parameterized SQL

`StreetPostgresRepository<T>` is abstract: subclasses declare `tableName` and
implement `mapRow(row)`. Every method issues **parameterized** queries
(`$1..$N`); values are never interpolated. `create`/`update` build column and
placeholder lists from the object's own keys, skipping `undefined` values.
`findAll` clamps `limit` into `[1, 1000]` and floors `offset` at `0` to bound
result sizes.

### Table-name safety

The only identifier that can't be parameterized is the table name. It is
validated against `^[a-zA-Z_][a-zA-Z0-9_.]*$` **lazily on first query** (the
abstract property isn't available in the base constructor), so a mis-declared
subclass fails fast with a clear error instead of emitting injectable SQL.

### Optional transparent encryption

When a subclass sets both `encryptor` (a `FieldEncryptor`) and `encryptedEntity`
(the annotated entity class), `create`/`update` run values through
`encryptEntity` before writing and `findById`/`findAll`/`create`/`update` run
returned rows through `decryptEntity`. When either is unset, both paths are
no-ops — zero overhead for repositories that don't opt in.

### Transactions and streaming

`withTransaction(fn)` delegates to `pool.transaction`, giving `fn` a single
connection with BEGIN/COMMIT (ROLLBACK on throw). `streamAll(sql)` delegates to
`pool.stream` for backpressured reads; parameterized streaming is not yet
supported and throws synchronously to steer callers to `pool.query`.
`LedgerTransactionService.execute(ops, onSuccess?)` runs a list of operations and
an optional success callback within one transaction.

## Testing

The suite runs with **no live database** using a fake pool that records queries
and returns scripted results. It covers all CRUD paths (including limit/offset
clamping, undefined-field skipping, empty-update fallthrough, and the
delete/insert edge cases), lazy table-name rejection, the encrypt-on-write /
decrypt-on-read cycle via a fake `FieldEncryptor`, streaming (both the
parameterized rejection and the delegation path), `withTransaction`, and the
ledger service with and without a success callback. Coverage is 100%.

## Non-goals

- No query builder, joins, or relations — this is a single-table CRUD base.
- No schema management (see `@streetjs/migrations`).
- No connection management (see `@streetjs/pool`).
- No encryption implementation — only the structural hook to plug one in.
