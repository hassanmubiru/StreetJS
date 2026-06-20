<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/social-feed

Official StreetJS Framework social module: **post publishing and timeline
generation** over the follow graph (`@streetjs/social-users`).

- Publish posts; read author (user) timelines and home timelines
- Fan-out-on-read: a home timeline merges posts from everyone a user follows
- Total, stable ordering via a store-assigned monotonic `seq` (also the cursor)
- Cursor pagination (`limit` + `before`)
- Pluggable persistence: in-memory default + Postgres-backed adapter

## Install

```bash
npm install @streetjs/social-feed @streetjs/social-users streetjs
```

## Quick start (in-memory)

```ts
import { FollowService } from '@streetjs/social-users';
import { FeedService } from '@streetjs/social-feed';

const follows = new FollowService();
const feed = new FeedService({ followees: follows }); // FollowService satisfies FolloweeSource

await follows.follow('reader', 'ada');
await feed.publish({ authorId: 'ada', text: 'hello world' });

await feed.homeTimeline('reader');           // [{ author: 'ada', text: 'hello world', ... }]
await feed.userTimeline('ada');              // ada's own posts, newest first
await feed.homeTimeline('reader', { limit: 10, before: cursorSeq });
```

The `followees` source is any object with `following(userId)` — the
`FollowService` from `@streetjs/social-users` works directly.

## Postgres-backed

```ts
import { PgPool } from 'streetjs';
import { FeedService, PgFeedStore, SOCIAL_POSTS_MIGRATION_SQL } from '@streetjs/social-feed';

const pool = new PgPool({ /* … */ });
await pool.query(SOCIAL_POSTS_MIGRATION_SQL);

const feed = new FeedService({ followees: follows, store: new PgFeedStore(pool) });
```

## Semantics

| Behaviour | Guarantee |
|---|---|
| ordering | every timeline is strictly descending by `seq` (newest first) |
| home timeline | posts by everyone the reader follows (+ self if `includeSelf`, default true) |
| pagination | `before = seq` returns strictly older posts; no gaps or duplicates |
| `delete(postId, authorId)` | author-scoped; idempotent |
| empty author/text | rejected |

## API

- `new FeedService({ followees, store?, includeSelf?, now?, idGen? })`
- `publish({ authorId, text })` → `Post`
- `userTimeline(authorId, { limit?, before? })` → `Post[]`
- `homeTimeline(userId, { limit?, before? })` → `Post[]`
- `get(postId)` → `Post | undefined`
- `delete(postId, authorId)` → `boolean`

Stores: `InMemoryFeedStore`, `PgFeedStore`. Schema: `SOCIAL_POSTS_MIGRATION_SQL`.

## Testing

```bash
npm run test -w packages/social-feed       # unit + property tests (no DB)
PG_HOST=127.0.0.1 PG_PORT=5433 PG_USER=street PG_PASSWORD=street_secret \
  PG_DATABASE=street_test npm run test -w packages/social-feed
```

## License

MIT
