# Kampala Life

A small full-stack Kampala Life game inspired by the visual rhythm of [Lagos Life](https://lagoslife.app/): a living city map, real account signup/login, persisted player state, daily goals, limited moves, and server-validated city actions.

## Run locally

From this directory:

```bash
npm start
```

Then open <http://localhost:4173> in a browser. If port `4173` is already in use, stop the old server first or run the equivalent command on another port:

```bash
python3 -m http.server 4174
```

The server persists player accounts, hashed passwords, sessions, cash, energy, reputation, day number, daily goals, and action history in the local `data/` store. Each day gives the player three moves. Complete the daily reputation goal for a UGX 5,000 reward, then end the day to recover energy and start the next one. The browser stores only the session token. This is a local development build; move the stores to a managed database and secret-backed session service before deployment.

## Multiplayer

Authenticated players join the `kampala:central` WebSocket room at `/ws`. The server broadcasts presence, movement, and gameplay activity, validates movement distance, and persists the accepted position. Open the game in two browser windows, create or log into two accounts, and click the map background in either window to move that player; the other window will see the avatar and live activity feed update. The current single-process room uses StreetJS `ChannelHub`; use `@streetjs/realtime` with its Redis adapter when running multiple game servers.

## Art assets

The city scene uses reusable, hand-authored SVG assets in `assets/`: apartment blocks, a tower, Owino-style market, parks, trees, billboards, and a boda boda. They are intentionally vector-based so the scene stays crisp at different viewport sizes and can later be replaced with exported 3D renders without changing the map layout.
