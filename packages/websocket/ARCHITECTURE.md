# @streetjs/websocket — Architecture

## Goals

- A single, generic realtime transport (WebSocket + SSE + channels) for StreetJS.
- One runtime dependency (`ws`); everything else is Node core.
- Secure by default: origin + auth gating, capacity limits, bounded payloads/listeners.
- Strongly typed; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  server.ts    StreetWebSocketServer + StreetSocket + origin helpers.
  sse.ts       SseConnection + createSse.
  channels.ts  ChannelHub (presence/typing) over a minimal connection contract.
  index.ts     Curated public API + WEBSOCKET_SERVER DI token.
```

`server`, `sse`, and `channels` are independent; `channels` depends only on a small
`RealtimeConnection` interface (which `StreetSocket` satisfies), so it is transport-
agnostic and unit-testable with fakes.

## Extraction & single source of truth

Extracted from `streetjs` core. Core now depends on `@streetjs/websocket` and its
`src/websocket/{server,sse,channels}.ts` re-export from it, so the `streetjs/websocket`
and `streetjs/sse` subpaths and all internal imports resolve to one implementation
(dependency inversion — not duplication, not a shim).

## Security model

- **Origin (CSWSH)** — `isOriginAllowed` runs before the handshake: no `Origin` header is
  allowed (non-browser clients); a malformed origin is rejected; with `allowedOrigins`
  the normalized origin must be a member; otherwise it must equal the derived self-origin.
  A rejected upgrade returns `403` and never emits a `connection` event.
- **Auth** — an optional `authFn(req)` runs before accepting the upgrade; a falsy return
  or a throw yields `401`. In production, constructing a server without an `authFn` logs a
  one-time, non-throwing warning (the server still starts).
- **Resource bounds** — 512 KB max payload, a per-event listener cap on `StreetSocket`,
  and a `maxConnections` capacity that closes excess connections with `1013`.

## Lifecycle & framing

`StreetSocket` wraps a raw `ws` socket, parsing inbound frames as `{ type, payload, ts }`
and dispatching to `on(type)` handlers plus a `*` wildcard; malformed frames are ignored.
It exposes an idempotent close with `onClose` callbacks and a stable `id`. The server
tracks live clients, an optional unref'd heartbeat (`ping`/`pong`, reaping the unresponsive),
and both a default handler path (`attach`) and a subprotocol path (`attachProtocol`).

## Channel hub

Presence is reference-counted by connection: a member is present while ≥1 of their
connections is in the channel, so multi-device and reconnect-overlap don't flicker
presence. Typing indicators optionally auto-clear after a TTL. Empty channels are dropped
to bound memory. Broadcasts isolate per-connection send failures and skip closed
connections. For horizontal scale, place a pub/sub fan-out in front of `publish`/presence.

## Testing

`node --test`:
- **channels** — pure logic with fake connections: join/leave/disconnect, multi-connection
  presence, publish exceptions, typing (+ TTL auto-clear), name validation, isolation.
- **sse** — a fake `ServerResponse`: headers, framing, CR/LF injection guard, multi-line
  data, comments, close, write-failure cleanup.
- **server (unit)** — origin helpers and `StreetSocket` with a fake `ws`.
- **server (integration)** — a real `http.Server` + `ws` client: echo, broadcast +
  `connectionCount`, `onClose`, origin `403`, auth `401`, capacity `1013`, heartbeat, and
  `attachProtocol` (happy path + origin/auth/capacity).

Coverage is enforced by `c8` (lines/functions/statements ≥90, branches ≥85 — the server
has defensive socket branches that are impractical to force from integration tests); the
declaration-only types are excluded.
