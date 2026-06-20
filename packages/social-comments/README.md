<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/social-comments

Official StreetJS Framework social module: **threaded comments** with reactions
and `@mentions`, on any subject (a post, photo, listing — anything with an id).

- Comments and threaded replies (`parentId`)
- `@mention` extraction (normalized, deduped) with reverse lookup
- Per-user reactions (toggle, idempotent) with counts
- Author-scoped deletion (clears the comment's mentions and reactions)
- Pluggable persistence: in-memory default + Postgres-backed adapter

## Install

```bash
npm install @streetjs/social-comments streetjs
```

## Quick start (in-memory)

```ts
import { CommentService } from '@streetjs/social-comments';

const comments = new CommentService();

const root = await comments.comment({ subjectId: 'post1', authorId: 'ada', text: 'great post @bob!' });
root.mentions;                                  // ['bob']
await comments.comment({ subjectId: 'post1', authorId: 'bob', text: 'thanks @ada', parentId: root.id });

await comments.thread('post1');                 // chronological comments
await comments.replies(root.id);                // direct replies
await comments.mentionsOf('bob');               // comments mentioning @bob

await comments.react(root.id, 'cat', '👍');     // true (added)
await comments.react(root.id, 'cat', '👍');     // false (idempotent)
await comments.reactions(root.id);              // { '👍': 1 }
```

## Postgres-backed

```ts
import { PgPool } from 'streetjs';
import { CommentService, PgCommentStore, SOCIAL_COMMENTS_MIGRATION_SQL } from '@streetjs/social-comments';

const pool = new PgPool({ /* … */ });
await pool.query(SOCIAL_COMMENTS_MIGRATION_SQL);
const comments = new CommentService({ store: new PgCommentStore(pool) });
```

## Semantics

| Behaviour | Guarantee |
|---|---|
| `thread(subject)` | chronological (ascending), cursor-paginated by `after = seq` |
| replies | a reply must share its parent's subject; missing parent rejected |
| mentions | `@handle` parsed at creation, lowercased, deduped; email-like `@` ignored |
| `react` / `unreact` | idempotent; `changed` flag reflects whether state moved |
| `delete(id, authorId)` | author-scoped; also clears mentions + reactions |

## API

- `new CommentService({ store?, now?, idGen? })`
- `comment({ subjectId, authorId, text, parentId? })` → `Comment`
- `thread(subjectId, { limit?, after? })` / `replies(parentId)` → `Comment[]`
- `mentionsOf(handle)` → `Comment[]`
- `react/unreact(commentId, userId, reaction)` → `boolean`
- `reactions(commentId)` → `Record<reaction, count>`
- `reactionsByUser(commentId, userId)` → `string[]`
- `delete(commentId, authorId)` → `boolean`
- `extractMentions(text)` → `string[]` (exported helper)

Stores: `InMemoryCommentStore`, `PgCommentStore`. Schema: `SOCIAL_COMMENTS_MIGRATION_SQL`.

## Testing

```bash
npm run test -w packages/social-comments     # unit + property tests (no DB)
PG_HOST=127.0.0.1 PG_PORT=5433 PG_USER=street PG_PASSWORD=street_secret \
  PG_DATABASE=street_test npm run test -w packages/social-comments
```

## License

MIT
