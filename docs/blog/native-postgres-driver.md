---
layout:      default
title:       "How StreetJS talks to PostgreSQL without the pg package"
permalink:   /blog/native-postgres-driver/
nav_exclude: true
description:  "StreetJS implements the PostgreSQL wire protocol v3 over node:net with SCRAM-SHA-256 auth and streaming backpressure — no pg, no native bindings. Here's how and why."
---

{% include doc-styles.html %}

<div class="doc-header" markdown="0">
<span class="dh-label">Engineering</span>
<h1>Talking to PostgreSQL without the <code>pg</code> package</h1>
<p>StreetJS speaks PostgreSQL wire protocol v3 directly over <code>node:net</code>, with SCRAM-SHA-256 authentication and socket-level streaming — no <code>pg</code>, no native bindings to compile.</p>
</div>

Almost every Node app that touches PostgreSQL installs `pg`. StreetJS doesn't.
The framework implements the database client itself. That sounds extreme until
you look at what it buys you.

## The wire protocol, briefly

PostgreSQL's client/server protocol (version 3) is a well-documented,
message-framed binary protocol over a TCP socket. A client:

1. opens a socket (`node:net`),
2. sends a startup message,
3. completes authentication (StreetJS implements **SCRAM-SHA-256**),
4. sends `Parse`/`Bind`/`Execute` for parameterized queries,
5. reads `RowDescription` + `DataRow` messages back.

StreetJS implements exactly this, so from your code a query is just:

```typescript
const { rows } = await pool.query(
  'INSERT INTO items (name) VALUES ($1) RETURNING id, name',
  ['Widget'],
);
```

Parameters are always sent out-of-band (never string-concatenated), so
parameterized queries are injection-safe by construction.

## Why implement it instead of depending on it

- **No transitive dependencies.** `pg` is well-maintained, but it and its
  helpers pull packages into every app that uses the framework. A native client
  keeps the core dependency-light — see
  [Why StreetJS has so few dependencies](/StreetJS/blog/why-2-dependencies/).
- **No native bindings.** Nothing to compile per platform; install is just
  JavaScript.
- **Control over memory and backpressure.** Because StreetJS owns the socket
  read loop, it applies streaming backpressure and bounded buffers — the same
  memory-safety discipline applied across the framework.
- **Auth you can audit.** SCRAM-SHA-256 is implemented in the open, in
  TypeScript, rather than delegated.

## The same idea, everywhere

This isn't a one-off. The official plugins apply the identical approach: native,
dependency-free clients for [MySQL](/StreetJS/plugins/mysql/),
[MongoDB](/StreetJS/plugins/mongodb/) (BSON + OP_MSG + SCRAM),
[Redis](/StreetJS/plugins/redis/) (RESP2), Kafka, and AMQP — all in the
[Plugin Marketplace](/StreetJS/plugins/marketplace/).

## When you'd want the opposite

If you need a PostgreSQL feature StreetJS's driver doesn't implement yet, that's a
real constraint — file an issue or an RFC. The native-driver bet is that the
common path (parameterized queries, pooling, streaming, transactions) covers the
overwhelming majority of application needs, and the dependency savings are worth
owning that path.

---

*Try it: `npx @streetjs/cli create my-app --database postgres` — see [Getting Started](/StreetJS/getting-started/installation/).*
