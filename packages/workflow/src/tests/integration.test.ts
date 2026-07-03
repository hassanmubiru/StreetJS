// Integration tests for the four structural pillar bridges (Storage/Queue/
// Events/Realtime) and the Redis-backed WorkflowStore, with HONEST skipping.
//
// This suite is split into three tiers, matching how @streetjs/workflow is
// actually deployed (the four pillar packages are OPTIONAL peer dependencies and
// a live Redis server may or may not be present):
//
//   1. In-process bridge doubles (ALWAYS run, no external dependency). A fake
//      StorageLike/QueueLike/EventsLike/RealtimeLike and a fake RedisLike exercise
//      the *wiring* paths: `createWorkflow({ bridges })` threads each structural
//      bridge onto `ctx.*`, and a RedisWorkflowStore over the fake RedisLike backs
//      a real run. These MUST run unconditionally and pass (Req 15.1, 16.1, 17.1,
//      18.1, 27.4).
//
//   2. Unwired-bridge misconfiguration. A `ctx.storage` operation with no
//      StorageLike bridge raises a descriptive WorkflowConfigError, both directly
//      through the storage bridge surface and end-to-end through the engine
//      (Req 15.1 error path).
//
//   3. Live pillar bridges + live Redis (SKIP HONESTLY when absent). Each pillar
//      test attempts a dynamic `import("@streetjs/<pillar>")`; when the package is
//      not installed the subtest is SKIPPED via the Node test context (`t.skip`)
//      with a clear message and is NEVER reported as passed. The Redis test
//      attempts to connect a real `redis` client within a short timeout and skips
//      honestly when a server is unavailable (Req 15.1, 16.1, 17.1, 18.1, 27.3).
//
// Uses the Node.js built-in test runner (node:test) and node:assert/strict, and
// is executed via `node --test dist/tests/*.test.js`.
//
// Requirements: 15.1, 16.1, 17.1, 18.1, 27.3, 27.4

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { createWorkflow } from "../engine.js";
import { WorkflowConfigError } from "../errors.js";
import { bridgeWorkflowStorage } from "../integrations/storage.js";
import { DEFAULT_BROADCAST_EVENT } from "../integrations/realtime.js";
import { RedisWorkflowStore } from "../redis/index.js";
import type { RedisLike } from "../redis/index.js";
import type {
  EventsLike,
  QueueLike,
  RealtimeLike,
  StorageLike,
  WorkflowFunction,
} from "../types.js";

// ── Shared harness ─────────────────────────────────────────────────────────────

/** A deterministic, injected fake Clock. None of these tests advance time. */
const CLOCK = (): number => 1_000;

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** True when `value` is an object exposing every named method as a function. */
function hasMethods(value: unknown, methods: readonly string[]): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return methods.every((name) => typeof obj[name] === "function");
}

/**
 * Attempt to dynamically import an OPTIONAL module by specifier, returning its
 * namespace on success and `null` when it is not installed. A non-literal
 * specifier keeps the import out of the static module graph so the base package
 * builds and runs without the optional peer dependency present.
 */
async function optionalImport(specifier: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(specifier)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Reject after `ms` so a hung connection/handshake cannot stall the suite. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      timer.unref();
    }),
  ]);
}

// ── Tier 1: in-process bridge doubles (ALWAYS run) ───────────────────────────────

/** A Map-backed {@link StorageLike} double — no filesystem, no cloud, no network. */
class FakeStorage implements StorageLike {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, content: Uint8Array | string): Promise<unknown> {
    this.objects.set(key, typeof content === "string" ? ENCODER.encode(content) : content);
    return undefined;
  }
  async get(key: string): Promise<{ found: boolean; bytes?: Uint8Array; metadata?: unknown }> {
    const bytes = this.objects.get(key);
    return bytes === undefined ? { found: false } : { found: true, bytes };
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async move(from: string, to: string): Promise<void> {
    const bytes = this.objects.get(from);
    if (bytes !== undefined) {
      this.objects.set(to, bytes);
      this.objects.delete(from);
    }
  }
  async copy(from: string, to: string): Promise<void> {
    const bytes = this.objects.get(from);
    if (bytes !== undefined) {
      this.objects.set(to, bytes);
    }
  }
}

/** A recording {@link QueueLike} double returning a synthetic jobId. */
class FakeQueue implements QueueLike {
  readonly dispatched: { job: string; payload: unknown }[] = [];

  async dispatch(job: string, payload: unknown): Promise<string> {
    this.dispatched.push({ job, payload });
    return `job-${this.dispatched.length}`;
  }
}

/** A recording {@link EventsLike} double that also delivers to local subscribers. */
class FakeEvents implements EventsLike {
  readonly published: { event: string; payload: unknown }[] = [];
  private readonly subscribers = new Map<string, ((payload: unknown) => void)[]>();

  publish(event: string, payload: unknown): void {
    this.published.push({ event, payload });
    for (const handler of this.subscribers.get(event) ?? []) {
      handler(payload);
    }
  }
  async waitFor(): Promise<unknown> {
    return undefined;
  }
  subscribe(event: string, handler: (payload: unknown) => void): () => void {
    const list = this.subscribers.get(event) ?? [];
    list.push(handler);
    this.subscribers.set(event, list);
    return () => {
      const current = this.subscribers.get(event);
      if (current !== undefined) {
        this.subscribers.set(
          event,
          current.filter((h) => h !== handler),
        );
      }
    };
  }
}

/** A recording {@link RealtimeLike} double capturing every broadcast. */
class FakeRealtime implements RealtimeLike {
  readonly calls: { channel: string; event: string; payload: unknown }[] = [];

  broadcast(channel: string, event: string, payload: unknown): void {
    this.calls.push({ channel, event, payload });
  }
}

/**
 * A fully in-process {@link RedisLike} double: strings live in a `Map` and sets
 * live in a `Map<string, Set>` — exactly the two structures RedisWorkflowStore
 * relies on. No network and no server.
 */
class FakeRedis implements RedisLike {
  private readonly strings = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    return this.strings.has(key) ? this.strings.get(key)! : null;
  }
  async set(key: string, value: string): Promise<unknown> {
    this.strings.set(key, value);
    return "OK";
  }
  async del(key: string): Promise<unknown> {
    return this.strings.delete(key) ? 1 : 0;
  }
  async sAdd(key: string, member: string): Promise<unknown> {
    let set = this.sets.get(key);
    if (set === undefined) {
      set = new Set<string>();
      this.sets.set(key, set);
    }
    const existed = set.has(member);
    set.add(member);
    return existed ? 0 : 1;
  }
  async sRem(key: string, member: string): Promise<unknown> {
    return this.sets.get(key)?.delete(member) ? 1 : 0;
  }
  async sMembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set === undefined ? [] : [...set];
  }
}

describe("in-process bridge doubles (always run, no external dependency)", () => {
  test("StorageLike double is wired onto ctx.storage put/get/delete/move/copy (Req 15.1)", async () => {
    const storage = new FakeStorage();
    const engine = createWorkflow({ clock: CLOCK, bridges: { storage } });

    const wf: WorkflowFunction<null, string> = async (ctx) => {
      await ctx.storage.put("a.txt", "hello");
      await ctx.storage.copy("a.txt", "b.txt");
      await ctx.storage.move("b.txt", "c.txt");
      const got = await ctx.storage.get("a.txt");
      await ctx.storage.delete("a.txt");
      return got.found && got.bytes !== undefined ? DECODER.decode(got.bytes) : "missing";
    };
    engine.define("wf", wf);

    const handle = await engine.run("wf", null);
    assert.equal(await handle.result(), "hello", "get returned the put content through the bridge");

    // Observable stored state after put→copy→move→(get)→delete of a.txt.
    assert.equal(storage.objects.has("c.txt"), true, "the moved object landed at c.txt");
    assert.equal(storage.objects.has("b.txt"), false, "the source of the move no longer exists");
    assert.equal(storage.objects.has("a.txt"), false, "the deleted object is gone");
    await engine.close();
  });

  test("QueueLike double is wired onto ctx.queue.dispatch and returns the jobId (Req 16.1)", async () => {
    const queue = new FakeQueue();
    const engine = createWorkflow({ clock: CLOCK, bridges: { queue } });

    const wf: WorkflowFunction<null, string> = async (ctx) =>
      ctx.queue.dispatch("send-email", { to: "a@example.com" });
    engine.define("wf", wf);

    const handle = await engine.run("wf", null);
    assert.equal(await handle.result(), "job-1", "the dispatched jobId flows back to the workflow");
    assert.equal(queue.dispatched.length, 1, "the job was dispatched exactly once through the bridge");
    assert.deepEqual(queue.dispatched[0], { job: "send-email", payload: { to: "a@example.com" } });
    await engine.close();
  });

  test("EventsLike double is wired onto ctx.events.publish (Req 17.1)", async () => {
    const events = new FakeEvents();
    const engine = createWorkflow({ clock: CLOCK, bridges: { events } });

    const wf: WorkflowFunction<null, string> = async (ctx) => {
      await ctx.events.publish("order.placed", { id: 7 });
      return "ok";
    };
    engine.define("wf", wf);

    const handle = await engine.run("wf", null);
    assert.equal(await handle.result(), "ok");
    assert.equal(events.published.length, 1, "the event was published through the bridge");
    assert.deepEqual(events.published[0], { event: "order.placed", payload: { id: 7 } });
    await engine.close();
  });

  test("RealtimeLike double is wired onto ctx.realtime.broadcast and lifecycle broadcasts (Req 18.1)", async () => {
    const realtime = new FakeRealtime();
    const engine = createWorkflow({ clock: CLOCK, bridges: { realtime } });

    const wf: WorkflowFunction<null, string> = async (ctx) => {
      await ctx.realtime.broadcast("room-1", { msg: "hi" });
      return "ok";
    };
    engine.define("wf", wf);

    const handle = await engine.run("wf", null);
    assert.equal(await handle.result(), "ok");

    // The explicit ctx.realtime.broadcast maps (channel, payload) onto the
    // structural (channel, event, payload) bridge with the default event name.
    const broadcast = realtime.calls.find((call) => call.channel === "room-1");
    assert.ok(broadcast, "ctx.realtime.broadcast reached the bridge");
    assert.equal(broadcast!.event, DEFAULT_BROADCAST_EVENT);
    assert.deepEqual(broadcast!.payload, { msg: "hi" });

    // Run-lifecycle transitions also broadcast on the workflow channel (Req 18.2).
    assert.ok(
      realtime.calls.some(
        (call) => call.channel === "workflow" && call.event === "workflow.started",
      ),
      "workflow.started lifecycle event was broadcast",
    );
    await engine.close();
  });

  test("RedisLike double backs a real run through RedisWorkflowStore (Req 27.4)", async () => {
    const store = new RedisWorkflowStore({ client: new FakeRedis(), keyPrefix: "wf-double:" });
    const engine = createWorkflow({ clock: CLOCK, store });

    const wf: WorkflowFunction<{ n: number }, number> = async (ctx, input) =>
      ctx.activity(() => input.n * 2);
    engine.define("double", wf);

    const handle = await engine.run("double", { n: 21 });
    assert.equal(await handle.result(), 42, "the run completes over the fake-Redis-backed store");
    assert.equal(await engine.status(handle.runId), "completed");

    // The run is durably persisted in the store, evidencing the wiring path.
    const persisted = await store.load(handle.runId);
    assert.notEqual(persisted, null, "the RedisWorkflowStore holds the run");
    assert.equal(persisted!.status, "completed");
    await engine.close();
  });
});

// ── Tier 2: unwired-bridge misconfiguration (always run) ─────────────────────────

describe("an unwired ctx.storage operation raises WorkflowConfigError (Req 15.1)", () => {
  test("ctx.storage.put with no StorageLike bridge throws WorkflowConfigError", async () => {
    // `bridgeWorkflowStorage(undefined)` builds the exact `ctx.storage` surface
    // the engine wires when no storage bridge is configured.
    const storage = bridgeWorkflowStorage(undefined);

    await assert.rejects(
      storage.put("key", "value"),
      (error: unknown) =>
        error instanceof WorkflowConfigError &&
        error.bridge === "storage" &&
        error.operation === "put",
      "an unwired ctx.storage.put throws a descriptive WorkflowConfigError",
    );
  });

  test("a workflow using ctx.storage with no bridge fails the run (Req 15.1)", async () => {
    const engine = createWorkflow({ clock: CLOCK }); // no bridges configured

    const wf: WorkflowFunction<null, string> = async (ctx) => {
      await ctx.storage.put("key", "value");
      return "unreachable";
    };
    engine.define("wf", wf);

    const handle = await engine.run("wf", null);
    await assert.rejects(handle.result(), "the run rejects because ctx.storage is unwired");
    assert.equal(
      await engine.status(handle.runId),
      "failed",
      "the misconfigured run finalizes as failed",
    );
    await engine.close();
  });
});

// ── Tier 3a: live pillar bridges (skip honestly when the pillar is absent) ───────

describe("live pillar bridges (skipped when the pillar package is absent)", () => {
  test("live @streetjs/storage satisfies StorageLike and round-trips through ctx.storage (Req 15.1)", async (t) => {
    const mod = await optionalImport("@streetjs/storage");
    if (mod === null) {
      t.skip("@streetjs/storage is not installed; skipping live storage bridge integration");
      return;
    }
    const createStorage = mod["createStorage"];
    if (typeof createStorage !== "function") {
      t.skip("@streetjs/storage present but exposes no createStorage factory; skipping");
      return;
    }
    let storage: unknown;
    try {
      storage = (createStorage as (config?: unknown) => unknown)({});
    } catch (error) {
      t.skip(
        `@streetjs/storage present but no zero-config in-process instance could be built (${String(error)}); skipping`,
      );
      return;
    }
    if (!hasMethods(storage, ["put", "get", "delete", "move", "copy"])) {
      t.skip("@streetjs/storage instance does not structurally satisfy StorageLike; skipping");
      return;
    }

    const engine = createWorkflow({ clock: CLOCK, bridges: { storage: storage as StorageLike } });
    const wf: WorkflowFunction<null, string> = async (ctx) => {
      await ctx.storage.put("live.txt", "live-content");
      const got = await ctx.storage.get("live.txt");
      return got.found && got.bytes !== undefined ? DECODER.decode(got.bytes) : "missing";
    };
    engine.define("wf", wf);

    const handle = await engine.run("wf", null);
    assert.equal(await handle.result(), "live-content", "the live storage bridge round-trips content");
    await engine.close();
  });

  test("live @streetjs/queue satisfies QueueLike and dispatches through ctx.queue (Req 16.1)", async (t) => {
    const mod = await optionalImport("@streetjs/queue");
    if (mod === null) {
      t.skip("@streetjs/queue is not installed; skipping live queue bridge integration");
      return;
    }
    // The in-process FakeQueue test double exported by @streetjs/queue is the
    // zero-config way to exercise the real package without a driver/worker.
    const FakeQueueCtor = mod["FakeQueue"];
    if (typeof FakeQueueCtor !== "function") {
      t.skip("@streetjs/queue present but exposes no FakeQueue; skipping");
      return;
    }
    let queue: unknown;
    try {
      queue = new (FakeQueueCtor as new () => unknown)();
    } catch (error) {
      t.skip(`@streetjs/queue FakeQueue could not be constructed (${String(error)}); skipping`);
      return;
    }
    if (!hasMethods(queue, ["dispatch"])) {
      t.skip("@streetjs/queue instance does not structurally satisfy QueueLike; skipping");
      return;
    }

    const engine = createWorkflow({ clock: CLOCK, bridges: { queue: queue as QueueLike } });
    const wf: WorkflowFunction<null, string> = async (ctx) => ctx.queue.dispatch("live-job", { x: 1 });
    engine.define("wf", wf);

    const handle = await engine.run("wf", null);
    const jobId = await handle.result();
    assert.equal(typeof jobId, "string", "the live queue bridge returns a jobId string");
    assert.equal(await engine.status(handle.runId), "completed");
    await engine.close();
  });

  test("live @streetjs/events satisfies EventsLike and publishes through ctx.events (Req 17.1)", async (t) => {
    const mod = await optionalImport("@streetjs/events");
    if (mod === null) {
      t.skip("@streetjs/events is not installed; skipping live events bridge integration");
      return;
    }
    const factory =
      (typeof mod["createMemoryEvents"] === "function" && mod["createMemoryEvents"]) ||
      (typeof mod["createEvents"] === "function" && mod["createEvents"]);
    if (factory === false || factory === undefined) {
      t.skip("@streetjs/events present but exposes no createEvents/createMemoryEvents factory; skipping");
      return;
    }
    let events: unknown;
    try {
      events = (factory as (config?: unknown) => unknown)({});
    } catch (error) {
      t.skip(`@streetjs/events could not build an in-process instance (${String(error)}); skipping`);
      return;
    }
    if (!hasMethods(events, ["publish", "waitFor", "subscribe"])) {
      t.skip("@streetjs/events instance does not structurally satisfy EventsLike; skipping");
      return;
    }

    const engine = createWorkflow({ clock: CLOCK, bridges: { events: events as EventsLike } });
    const wf: WorkflowFunction<null, string> = async (ctx) => {
      await ctx.events.publish("live.event", { ok: true });
      return "published";
    };
    engine.define("wf", wf);

    const handle = await engine.run("wf", null);
    assert.equal(await handle.result(), "published", "the live events bridge publishes without error");
    assert.equal(await engine.status(handle.runId), "completed");
    await engine.close();
  });

  test("live @streetjs/realtime satisfies RealtimeLike and broadcasts through ctx.realtime (Req 18.1)", async (t) => {
    const mod = await optionalImport("@streetjs/realtime");
    if (mod === null) {
      t.skip("@streetjs/realtime is not installed; skipping live realtime bridge integration");
      return;
    }
    const createRealtime = mod["createRealtime"];
    const MemoryAdapter = mod["MemoryAdapter"];
    if (typeof createRealtime !== "function") {
      t.skip("@streetjs/realtime present but exposes no createRealtime factory; skipping");
      return;
    }
    let realtime: unknown;
    try {
      const adapter = typeof MemoryAdapter === "function" ? new (MemoryAdapter as new () => unknown)() : undefined;
      realtime = (createRealtime as (config?: unknown) => unknown)(
        adapter !== undefined ? { adapter } : {},
      );
    } catch (error) {
      t.skip(`@streetjs/realtime could not build an in-process instance (${String(error)}); skipping`);
      return;
    }
    if (!hasMethods(realtime, ["broadcast"])) {
      t.skip("@streetjs/realtime instance does not structurally satisfy RealtimeLike; skipping");
      return;
    }

    const engine = createWorkflow({ clock: CLOCK, bridges: { realtime: realtime as RealtimeLike } });
    const wf: WorkflowFunction<null, string> = async (ctx) => {
      // Realtime broadcast is best-effort; a wired broadcast never fails the run.
      await ctx.realtime.broadcast("live-channel", { msg: "hi" });
      return "broadcast";
    };
    engine.define("wf", wf);

    const handle = await engine.run("wf", null);
    assert.equal(await handle.result(), "broadcast", "the live realtime bridge broadcast path completes");
    assert.equal(await engine.status(handle.runId), "completed");
    await engine.close();
  });
});

// ── Tier 3b: live Redis-backed store (skip honestly when Redis is unavailable) ───

describe("Redis-backed store (skipped when a live Redis server is unavailable)", () => {
  test("RedisWorkflowStore backs a run against a real Redis server (Req 27.3)", async (t) => {
    const mod = await optionalImport("redis");
    if (mod === null) {
      t.skip("the `redis` client is not installed; skipping live Redis store integration");
      return;
    }
    const createClient = mod["createClient"];
    if (typeof createClient !== "function") {
      t.skip("`redis` present but exposes no createClient; skipping");
      return;
    }

    const url = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
    const client = (createClient as (opts: { url: string }) => RedisLike & {
      on?: (event: string, handler: (err: unknown) => void) => void;
      connect: () => Promise<unknown>;
      quit: () => Promise<unknown>;
    })({ url });
    // Swallow asynchronous client errors so a refused connection never crashes
    // the test process before we can skip honestly.
    client.on?.("error", () => {});

    try {
      await withTimeout(client.connect(), 750);
      await withTimeout(Promise.resolve(client.set("__wf_probe__", "1")), 500);
      await Promise.resolve(client.del("__wf_probe__"));
    } catch (error) {
      try {
        await client.quit();
      } catch {
        // ignore
      }
      t.skip(`no live Redis server reachable at ${url} (${String(error)}); skipping`);
      return;
    }

    const keyPrefix = `wf-int-test:${Date.now()}:`;
    const store = new RedisWorkflowStore({ client, keyPrefix });
    const engine = createWorkflow({ clock: CLOCK, store });

    try {
      const wf: WorkflowFunction<{ n: number }, number> = async (ctx, input) =>
        ctx.activity(() => input.n + 1);
      engine.define("increment", wf);

      const handle = await engine.run("increment", { n: 41 });
      assert.equal(await handle.result(), 42, "the run completes over the live Redis store");
      assert.equal(await engine.status(handle.runId), "completed");

      const persisted = await store.load(handle.runId);
      assert.notEqual(persisted, null, "the live Redis store holds the run");
      assert.equal(persisted!.status, "completed");
    } finally {
      await engine.close();
      // Best-effort cleanup of the keys this test wrote, then disconnect.
      try {
        const ids = await client.sMembers(`${keyPrefix}index`);
        for (const id of ids) {
          await client.del(`${keyPrefix}run:${id}`);
        }
        await client.del(`${keyPrefix}index`);
        await client.del(`${keyPrefix}incomplete`);
      } catch {
        // ignore cleanup failures
      }
      try {
        await client.quit();
      } catch {
        // ignore
      }
    }
  });
});
