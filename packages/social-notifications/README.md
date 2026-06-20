<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/social-notifications

Official StreetJS Framework social module: a **per-user notification inbox** that
the other social modules feed into.

- Create notifications with a type, optional actor/subject, and JSON payload
- List newest-first, optionally unread-only, cursor-paginated
- Unread counts, mark-one-read, mark-all-read, delete (all recipient-scoped)
- Self-notifications suppressed (you are never notified about your own action)
- Convenience builders: `onFollow`, `onMention`, `onComment`, `onReaction`
- Pluggable persistence: in-memory default + Postgres-backed adapter

## Install

```bash
npm install @streetjs/social-notifications streetjs
```

## Quick start (in-memory)

```ts
import { NotificationService } from '@streetjs/social-notifications';

const inbox = new NotificationService();

await inbox.onFollow('ada', 'bob');                 // bob followed ada
await inbox.onComment('ada', 'cat', 'post-1');      // cat commented on ada's post
await inbox.onReaction('ada', 'cat', 'post-1', '👍');

await inbox.unreadCount('ada');                     // 3
await inbox.list('ada', { unreadOnly: true });      // newest first
const [latest] = await inbox.list('ada');
await inbox.markRead(latest.id, 'ada');
await inbox.markAllRead('ada');                     // returns count marked
```

`onFollow('ada', 'ada')` (and any actor === recipient) returns `null` — you are
not notified about your own actions.

## Postgres-backed

```ts
import { PgPool } from 'streetjs';
import {
  NotificationService,
  PgNotificationStore,
  SOCIAL_NOTIFICATIONS_MIGRATION_SQL,
} from '@streetjs/social-notifications';

const pool = new PgPool({ /* … */ });
await pool.query(SOCIAL_NOTIFICATIONS_MIGRATION_SQL);
const inbox = new NotificationService({ store: new PgNotificationStore(pool) });
```

## Wiring it to the other social modules

```ts
// after follows.follow(actor, target):
await inbox.onFollow(target, actor);

// after a comment that mentions handles:
for (const handle of comment.mentions) await inbox.onMention(handle, comment.authorId, comment.id);

// after a reaction on someone's comment:
await inbox.onReaction(comment.authorId, reactorId, comment.id, reaction);
```

## Semantics

| Behaviour | Guarantee |
|---|---|
| ordering | newest first (descending `seq`); `before = seq` pages older |
| `notify` self | suppressed when `actorId === recipientId` (returns `null`) |
| `markRead` | recipient-scoped, idempotent (`false` if already read / not yours) |
| `markAllRead` | returns how many were unread and got marked |
| `unreadCount` | never negative; `markAllRead` drives it to 0 |

## API

- `new NotificationService({ store?, now?, idGen? })`
- `notify({ recipientId, type, actorId?, subjectId?, data? })` → `Notification | null`
- `list(recipientId, { limit?, before?, unreadOnly? })` → `Notification[]`
- `unreadCount(recipientId)` → `number`
- `markRead(id, recipientId)` / `delete(id, recipientId)` → `boolean`
- `markAllRead(recipientId)` → `number`
- builders: `onFollow`, `onMention`, `onComment`, `onReaction`

Stores: `InMemoryNotificationStore`, `PgNotificationStore`. Schema: `SOCIAL_NOTIFICATIONS_MIGRATION_SQL`.

## Testing

```bash
npm run test -w packages/social-notifications    # unit + property tests (no DB)
PG_HOST=127.0.0.1 PG_PORT=5433 PG_USER=street PG_PASSWORD=street_secret \
  PG_DATABASE=street_test npm run test -w packages/social-notifications
```

## License

MIT
