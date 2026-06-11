# @streetjs/dating-moderation

Official [Street Framework](https://hassanmubiru.github.io/street/) dating
reference package providing **blocking and reporting** for a dating app.

It is a thin facade over the core `ModerationToolkit` (Phase 7 of the
consumer-platform-security work) and introduces **no independent moderation
logic**: every operation delegates to `@streetjs/core`, so the framework's
guarantees — a block prevents the blocked user from messaging the blocker,
reports are queued for review, and the audit log is append-only — hold here
unchanged.

## Install

```bash
npm install @streetjs/dating-moderation
```

## Usage

```ts
import { DatingModeration } from '@streetjs/dating-moderation';

const mod = new DatingModeration();

// Reporting
const report = await mod.reportUser('alice', 'bob', 'inappropriate messages');
const queue = await mod.reviewQueue();                 // pending reports
await mod.resolveReport('moderator-1', report.id, 'user warned');

// Blocking
await mod.blockUser('alice', 'bob');                   // alice blocks bob
await mod.canMessage('bob', 'alice');                  // false — bob is blocked
await mod.canMessage('alice', 'bob');                  // true  — directional
await mod.isBlockedBetween('alice', 'bob');            // true  — either direction

// Append-only audit log
const log = await mod.auditLog();
```

## API

| Method | Description |
| ------ | ----------- |
| `reportUser(reporter, target, reason)` | File a report; stored and queued for moderation. |
| `reviewQueue()` | List reports awaiting moderator review. |
| `resolveReport(moderator, reportId, outcome)` | Record a moderator's resolution; clears the report from the queue. |
| `blockUser(blocker, blocked)` | Record a block. While it exists, `blocked` cannot message `blocker`. |
| `canMessage(from, to)` | Whether `from` may message `to` (false iff `to` has blocked `from`). |
| `isBlockedBetween(a, b)` | Whether a block exists in **either** direction. |
| `auditLog()` | The append-only moderation audit log. |
| `moderation` | The underlying core `ModerationToolkit`, for advanced composition. |

## Configuration

`new DatingModeration(options)` accepts:

| Option | Description |
| ------ | ----------- |
| `store` | A `ModerationStore` to back a toolkit (defaults to in-memory). For multi-instance enforcement, supply a shared store. |
| `clock` | A now-provider for deterministic timestamps under test. |
| `toolkit` | A pre-constructed `ModerationToolkit` to wrap (overrides `store`/`clock`). |

## Example

A runnable, offline example lives in [`examples/`](./examples):

```bash
npm run build
node examples/index.mjs
```

## Tests

```bash
npm test
```

Unit tests cover the report/queue/resolve and block APIs; a property-based test
(`fast-check`) checks the block-prevents-messaging invariant across arbitrary
block sequences.

## License

MIT
