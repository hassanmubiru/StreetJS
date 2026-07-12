# Realtime chat starter

Scaffolded with `street create --starter realtime`. Overlays WebSocket channels,
presence and typing indicators on the base app.

## Included

- **WebSocket server** — bounded `StreetWebSocketServer` with heartbeat.
- **Channels & presence** — `ChannelHub` (typing TTL configurable) in `src/features/chat.ts`.
- **Message history** — `channels`, `channel_members`, `messages` (see migration).
- **Auth-on-upgrade** — gate the WS upgrade with the core auth middleware.

## Schema

See `migrations/001_realtime.sql` — apply with `street migrate:run`.

## Flow

Client connects → authenticates on upgrade → joins a channel → messages are
broadcast to channel members and persisted to `messages`. Presence/typing are
in-memory via `ChannelHub`. For multi-instance fan-out, add `@streetjs/plugin-redis`.

See the [Starters guide](https://hassanmubiru.github.io/StreetJS/starters/) and
[Realtime docs](https://hassanmubiru.github.io/StreetJS/realtime/).
