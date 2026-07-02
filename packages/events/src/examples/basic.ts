// src/examples/basic.ts
// A runnable @streetjs/events example demonstrating typed publish/subscribe,
// class-based events, wildcard subscriptions, middleware, an event store with
// replay, and the queue/realtime integration bridges (wired against tiny
// structural fakes so the example runs anywhere with no Redis/queue/realtime).
//
// Run it: `npm run example` (after `npm run build`). It is also executed as an
// automated smoke test (tests/example-smoke.test.ts) so it stays working.

import {
  createEvents,
  Event,
  MemoryEventStore,
  type Events,
} from '../index.js';
import { bridgeQueueEvents } from '../integrations/queue.js';
import { bridgeRealtimeEvents } from '../integrations/realtime.js';

// ── The application's typed event map ────────────────────────────────────────
interface AppEvents {
  'user.created': { id: string; email: string };
  'user.verified': { id: string };
  'report.generated': { jobId: string; url: string };
}

// A class-based event (publish with `new UserCreated(...)`).
class UserCreated extends Event<{ id: string; email: string }> {
  readonly type = 'user.created';
}

/** The example's observable outcome, returned so the smoke test can assert it. */
export interface ExampleResult {
  auditLog: string[];
  verifiedUsers: string[];
  broadcasts: Array<{ room: string; type: string }>;
  replayedCount: number;
}

export async function main(quiet = false): Promise<ExampleResult> {
  const log = (msg: string): void => {
    if (!quiet) console.log(msg);
  };

  const store = new MemoryEventStore();
  const events: Events<AppEvents> = createEvents<AppEvents>({ store });

  // 1) Middleware: a simple audit log that runs once per event, around delivery.
  const auditLog: string[] = [];
  events.use(async (ctx, _payload, next) => {
    auditLog.push(ctx.event);
    await next();
  });

  // 2) Typed exact subscription — `user` is fully typed as { id, email }.
  events.on('user.created', async (user) => {
    log(`welcome email queued for ${user.email}`);
    // A downstream module reacts by verifying the user, decoupled from the creator.
    await events.publish('user.verified', { id: user.id });
  });

  // 3) Wildcard subscription — receives every `user.*` event.
  const verifiedUsers: string[] = [];
  events.on('user.*', (_payload, ctx) => {
    if (ctx.event === 'user.verified') {
      verifiedUsers.push((_payload as { id: string }).id);
    }
  });

  // 4) once — fires a single time.
  let firstReportOnly = 0;
  events.once('report.generated', () => {
    firstReportOnly += 1;
  });

  // 5) Realtime bridge — broadcast `report.generated` to a room (fake realtime).
  const broadcasts: Array<{ room: string; type: string }> = [];
  const fakeRealtime = {
    room(name: string) {
      return {
        broadcast(message: { type: string; payload: unknown }) {
          broadcasts.push({ room: name, type: message.type });
          return Promise.resolve();
        },
      };
    },
  };
  bridgeRealtimeEvents(events, fakeRealtime, [{ appEvent: 'report.generated', room: 'reports' }]);

  // 6) Queue bridge — a queue `job.completed` publishes `report.generated` (fake queue).
  const queueHandlers = new Map<string, (p: unknown) => void>();
  const fakeQueue = {
    on(event: string, handler: (p: unknown) => void) {
      queueHandlers.set(event, handler);
    },
  };
  bridgeQueueEvents(fakeQueue, events, [
    {
      queueEvent: 'job.completed',
      appEvent: 'report.generated',
      map: (e) => {
        const ctx = (e as { ctx: { id: string } }).ctx;
        return { jobId: ctx.id, url: `/reports/${ctx.id}` };
      },
    },
  ]);

  // ── Drive the example ──────────────────────────────────────────────────────
  await events.publish(new UserCreated({ id: 'u1', email: 'ada@example.com' }));

  // Simulate the queue finishing a job → bridged into an app event → broadcast.
  queueHandlers.get('job.completed')?.({ ctx: { id: 'report-42' } });
  await events.flush(); // drain the fire-and-forget bridge publish

  log(`audit log: ${auditLog.join(', ')}`);
  log(`verified: ${verifiedUsers.join(', ')}`);
  log(`broadcasts: ${broadcasts.map((b) => `${b.room}:${b.type}`).join(', ')}`);
  log(`once fired: ${firstReportOnly} time(s)`);

  // Snapshot the live-flow outcome BEFORE replay (replay re-delivers to current
  // listeners, which would otherwise inflate these counts).
  const verifiedSnapshot = [...verifiedUsers];

  // 7) Replay — re-dispatch every stored event to a late subscriber.
  const replayed: string[] = [];
  events.on('**', (_p, ctx) => {
    replayed.push(ctx.event);
  });
  const replayedCount = await events.replay();
  log(`replayed ${replayedCount} stored event(s): ${replayed.join(', ')}`);

  await events.close();
  return { auditLog, verifiedUsers: verifiedSnapshot, broadcasts, replayedCount };
}

// Run directly when invoked as a script (node dist/examples/basic.js).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
