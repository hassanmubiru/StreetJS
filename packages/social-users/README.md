<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/social-users

Official StreetJS Framework social module: the **follow graph**. It is the
foundation the other social modules (`@streetjs/social-feed`,
`@streetjs/social-comments`, `@streetjs/social-notifications`) build on.

- Directional, idempotent follow edges (`follow` / `unfollow`)
- Followers / following listings and counts
- Mutual-follow detection (order-independent)
- Pluggable persistence: in-memory default + Postgres-backed adapter

## Install

```bash
npm install @streetjs/social-users streetjs
```

## Quick start (in-memory)

```ts
import { FollowService } from '@streetjs/social-users';

const social = new FollowService(); // in-memory store by default

await social.follow('ada', 'lin');           // { changed: true, mutual: false }
await social.isFollowing('ada', 'lin');       // true
await social.follow('lin', 'ada');            // { changed: true, mutual: true }
await social.isMutual('ada', 'lin');          // true
await social.followers('lin');                // ['ada']
await social.counts('lin');                   // { followers: 1, following: 0 }
await social.unfollow('ada', 'lin');          // { changed: true, mutual: false }
```

## Postgres-backed

Compose StreetJS's native `PgPool`. Run the exported migration once at bootstrap.

```ts
import { PgPool } from 'streetjs';
import {
  FollowService,
  PgFollowStore,
  SOCIAL_FOLLOWS_MIGRATION_SQL,
} from '@streetjs/social-users';

const pool = new PgPool({ host: '127.0.0.1', port: 5432, user: 'street', password: '…', database: 'app' });
await pool.query(SOCIAL_FOLLOWS_MIGRATION_SQL);

const social = new FollowService({ store: new PgFollowStore(pool) });
await social.follow('ada', 'lin');
```

`PgFollowStore` accepts any object satisfying the narrow `SocialUsersPool`
interface (a single `query(sql, params)` method), so `PgPool` works directly.

## Semantics

| Behaviour | Guarantee |
|---|---|
| `follow(a, b)` twice | idempotent — second call reports `changed: false` |
| `unfollow(a, b)` when not following | no-op — `changed: false` |
| `follow(a, a)` | throws (no self-follow) |
| `isMutual(a, b)` | true iff both `a→b` and `b→a` exist; symmetric |
| listings | returned in edge-creation order |

## API

- `new FollowService({ store?, now? })`
- `follow(followerId, followeeId)` → `{ changed, mutual }`
- `unfollow(followerId, followeeId)` → `{ changed, mutual }`
- `isFollowing(a, b)` → `boolean`
- `isMutual(a, b)` → `boolean`
- `followers(userId)` / `following(userId)` → `string[]`
- `counts(userId)` → `{ followers, following }`

Stores: `InMemoryFollowStore`, `PgFollowStore`. Schema: `SOCIAL_FOLLOWS_MIGRATION_SQL`.

## Testing

```bash
npm run test -w packages/social-users          # unit + property tests (no DB)
# add PG_* env to also run the live-Postgres integration suite
PG_HOST=127.0.0.1 PG_PORT=5433 PG_USER=street PG_PASSWORD=street_secret \
  PG_DATABASE=street_test npm run test -w packages/social-users
```

## License

MIT
