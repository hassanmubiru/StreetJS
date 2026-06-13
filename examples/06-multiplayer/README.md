# Example 06 — Multiplayer Updates

Players join a room and broadcast position updates to the **other** players
(sender excluded), with presence tracking — the realtime pattern behind
multiplayer games, collaborative editors, and shared cursors.

## Run

```bash
npm run build:app -w packages/core
node examples/06-multiplayer/main.mjs
```

Three players join `arena-1`; one moves; the example asserts peers receive the
move while the sender does not, and that presence updates when a player leaves.
Exits 0 on success.

## Pattern

```ts
socket.on('move', (payload) => {
  // authoritative server would validate/clamp here
  hub.publish('arena-1', 'move', { player, ...payload }, { exceptMemberId: player });
});
```

`exceptMemberId` excludes all of the sender's connections, so clients never echo
their own input. Presence (`ChannelEvents.PresenceJoin` / `PresenceLeave`) lets
peers render who is in the room.
