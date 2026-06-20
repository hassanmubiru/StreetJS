<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-mongodb

Official StreetJS plugin: **MongoDB**.

A **dependency-free** MongoDB client built entirely on Node.js core — a BSON
codec, OP_MSG wire framing, and SCRAM-SHA-256 authentication — with **no vendor
driver**. The codec and auth primitives are pure and offline-verified (including
against the RFC 7677 SCRAM test vector); the client performs live
`find`/`insert`/`runCommand` I/O against a `mongod`.

## Install

```bash
npm install @streetjs/plugin-mongodb
# or: street add mongodb
```

## Configuration

```ts
import { MongoDbPlugin } from '@streetjs/plugin-mongodb';

const plugin = new MongoDbPlugin({
  host: '127.0.0.1', port: 27017,   // port defaults to 27017
  database: 'app',
  user: 'app', password: process.env.MONGO_PASSWORD, // optional (together)
  authSource: 'admin',              // default 'admin'
  stateKey: 'mongo',
});
```

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| `host` / `database` | string | yes | connection |
| `port` | number | no | default 27017 |
| `user` / `password` | string | no | SCRAM-SHA-256 (together) |
| `authSource` | string | no | auth db (default `admin`) |
| `timeoutMs` | number | no | connect/command timeout |
| `stateKey` | string | no | request-state key (default `mongo`) |

## Usage

```ts
import type { StreetContext } from 'streetjs';
import type { MongoClient } from '@streetjs/plugin-mongodb';

const mongo = ctx.state['mongo'] as MongoClient;
await mongo.insertOne('events', { kind: 'signup', at: new Date() });
const recent = await mongo.find('events', { kind: 'signup' }, { limit: 10 });
```

## What is verified offline vs. live

- **Offline (unit-tested):** BSON encode/decode for all supported types, OP_MSG
  framing round-trip, and the SCRAM-SHA-256 client proof + server-signature
  against the **RFC 7677 test vector**.
- **Live (requires a running `mongod`):** the `connect`/`find`/`insertOne`
  network path. Run a local server (`docker run -p 27017:27017 mongo:7`) and the
  `example/` to exercise it end-to-end.

## Security

- **Permissions:** `net`, `secrets`, `middleware`. Ed25519-signed manifest verified on install.
- Authentication uses SCRAM-SHA-256; the password is never sent in cleartext.
- No third-party runtime dependencies — the entire driver is Node.js core,
  minimizing supply-chain surface.

## License

MIT
