# Migration & backward compatibility

`@streetjs/realtime` is an **additive** layer over the existing `streetjs`
realtime primitives. Upgrading does not change the behavior of applications that
use `StreetWebSocketServer` and `ChannelHub` directly, and adopting the facade
is entirely opt-in.

## Compatibility guarantees

- **Preserved signatures.** The existing public method signatures of
  `StreetWebSocketServer`, `StreetSocket`, and `ChannelHub` are preserved. Code
  that calls them keeps compiling and running unchanged. (These are pinned by
  signature- and behavior-regression tests so any drift breaks the suite.)
- **Unchanged behavior without the facade.** An application that uses
  `StreetWebSocketServer` and `ChannelHub` directly — without adopting the
  `Realtime` facade — behaves exactly as it did before this package existed. The
  facade wraps these primitives; it does not patch or replace them.
- **Retained event identifiers.** The built-in event type identifiers
  `presence:join`, `presence:leave`, and `typing` are retained verbatim, so
  existing client-side handlers continue to match.

## Changed public surface

There are **no breaking changes** to the existing `streetjs` public surface in
this release. Everything in `@streetjs/realtime` is *new* API exposed by the new
package; nothing in the core WebSocket/channels surface was renamed, removed, or
had its signature changed.

Because there is no changed core surface, there is no forced migration. The
guidance below is purely about **adopting** the new facade if you choose to.

## Before: using the core primitives directly

This continues to work unchanged.

```ts
import { StreetWebSocketServer, ChannelHub } from 'streetjs';

const server = new StreetWebSocketServer();
const hub = new ChannelHub({ typingTtlMs: 5_000 });

// Manual wiring: bind a connection, join/leave, publish.
hub.bind(conn);
hub.join('general', memberId, conn);
hub.publish('general', 'message', { text: 'hi' }, { exceptConnId: conn.id });
hub.setTyping('general', memberId, true, conn);
const present = hub.presence('general');
```

## After: adopting the Realtime facade

The facade owns a single `ChannelHub` internally and gives you a typed,
member-oriented API plus authentication, authorization, rate limiting, and
cluster adapters. You do **not** create a `ChannelHub` yourself.

```ts
import { createRealtime } from '@streetjs/realtime';
import type { Member } from '@streetjs/realtime';
import { StreetWebSocketServer } from 'streetjs';

const server = new StreetWebSocketServer();
const realtime = createRealtime({ server, typingTtlMs: 5_000 });

const member: Member = { id: memberId };
const room = realtime.room('general');

await room.join(member, conn);
await room.broadcast({ type: 'message', payload: { text: 'hi' } }, { exceptConnId: conn.id });
room.setTyping(member, true, conn);
const present = await room.presence();
```

### Mapping from the hub API to the facade API

| Core `ChannelHub`                                   | Facade equivalent |
| --------------------------------------------------- | ----------------- |
| `new ChannelHub({ typingTtlMs })`                   | `createRealtime({ server, typingTtlMs })` (facade owns the hub) |
| `hub.join(channel, memberId, conn)`                 | `realtime.room(channel).join(member, conn)` |
| `hub.leave(channel, memberId, conn)`                | `realtime.room(channel).leave(member, conn)` |
| `hub.publish(channel, type, payload, opts)`         | `realtime.room(channel).broadcast({ type, payload }, opts)` |
| `hub.setTyping(channel, memberId, typing, conn)`    | `realtime.room(channel).setTyping(member, typing, conn)` |
| `hub.presence(channel)`                             | `await realtime.room(channel).presence()` |
| `hub.memberCount(channel)`                          | `await realtime.room(channel).memberCount()` |

Notes:

- The facade works with `Member` objects (`{ id, roles?, ... }`) rather than raw
  member id strings; `presence()` / `memberCount()` still return / count member
  ids.
- Broadcast payloads become a typed `RealtimeMessage<T>` (`{ type, payload }`)
  and `PublishOptions` become `BroadcastOptions` (`exceptConnId`,
  `exceptMemberId`), which map one-to-one.
- Facade `presence()` / `memberCount()` are async because they compute the
  distributed union across cluster instances (see
  [cluster-adapters.md](./cluster-adapters.md)).

## Adopting via the plugin

If your app uses the StreetJS plugin mechanism, register `RealtimePlugin`
instead of constructing the facade by hand:

```ts
import { RealtimePlugin } from '@streetjs/realtime';

await host.register(new RealtimePlugin({ server, health, metrics }), manifest);
```

## Incremental adoption

You can adopt the facade room-by-room. Because the facade wraps a `ChannelHub`
and preserves the same event identifiers, connections and clients that still
rely on direct hub usage or on the `presence:join` / `presence:leave` / `typing`
events keep interoperating during the transition.
