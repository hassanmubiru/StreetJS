// Unit tests for the @streetjs/workflow WorkflowPlugin load/unload lifecycle.
//
// Covers:
//   - the `workflow` accessor is `undefined` before `onLoad`, exposes a usable
//     live WorkflowEngine after `onLoad` (a trivial workflow defined + run
//     through it completes), and is `undefined` again after `onUnload`, so the
//     plugin exposes the engine on load and releases it on unload without
//     modifying any existing public API (Requirements 23.1, 23.3).
//   - declarative `wireBridges`: every attach function is invoked with the live
//     engine on load, and the detach function it returns is invoked on unload,
//     so bridge resources are torn down deterministically (Requirement 23.3).
//   - `onLoad` is idempotent per load: a second `onLoad` without an intervening
//     `onUnload` does not re-run the wiring, and `onUnload` on a never-loaded
//     plugin is a safe no-op.
//
// The `SandboxedApp` handed to the hooks is a minimal fake — `{ use, on }` —
// matching the real sandbox surface (it exposes only `use`/`on`), so no
// application/host machinery is needed. Everything runs against the
// zero-dependency default MemoryWorkflowStore with a deterministic injected
// fake Clock, so the tests need no external services.
//
// Requirements: 23.1, 23.3

import test from "node:test";
import assert from "node:assert/strict";

import type { Clock } from "streetjs";
import type { SandboxedApp } from "streetjs";

import { WorkflowPlugin } from "../plugin.js";
import type { WorkflowEngine } from "../engine.js";
import type { WorkflowFunction } from "../types.js";

// ── Test harness ─────────────────────────────────────────────────────────────────

/**
 * A deterministic, injected fake Clock fixed at a constant instant. The trivial
 * workflows used here never park on a timer, so a constant clock keeps behaviour
 * fully reproducible with no wall-clock dependency.
 */
const CLOCK: Clock = () => 1_000;

/**
 * A minimal fake of the `SandboxedApp` the plugin host hands to a plugin. The
 * real sandbox exposes only `use(middleware)` and `on(event, handler)`; the
 * workflow plugin touches neither in `onLoad`/`onUnload` (it resolves its
 * configuration from the plugin options), so no-op implementations suffice.
 */
function fakeApp(): SandboxedApp {
  return { use() {}, on() {} } as unknown as SandboxedApp;
}

// ── 1. Engine exposed on load, released on unload (Req 23.1, 23.3) ─────────────────

test("the workflow accessor exposes a usable engine on load and is released on unload (Req 23.1, 23.3)", async () => {
  const plugin = new WorkflowPlugin({ clock: CLOCK });
  const app = fakeApp();

  // Before load the accessor is undefined — no engine exists yet.
  assert.equal(plugin.workflow, undefined, "the engine is undefined before onLoad");

  await plugin.onLoad(app);

  // After load the accessor returns a live, usable engine.
  const engine = plugin.workflow;
  assert.notEqual(engine, undefined, "the engine is exposed after onLoad");

  // The exposed engine actually works end-to-end: define + run a trivial workflow
  // through it and get a completed result.
  const wf: WorkflowFunction<null, string> = async () => "ok";
  engine!.define("wf", wf);
  const handle = await engine!.run("wf", null);
  assert.equal(await handle.result(), "ok", "the exposed engine runs a workflow to completion");
  assert.equal(await engine!.status(handle.runId), "completed", "the run reaches completed");

  await plugin.onUnload(app);

  // After unload the accessor is undefined again — resources are released.
  assert.equal(plugin.workflow, undefined, "the engine is released (undefined) after onUnload");
});

// ── 2. wireBridges attach/detach lifecycle (Req 23.3) ──────────────────────────────

test("each wireBridges attach fn is called with the engine on load and its detacher on unload (Req 23.3)", async () => {
  const attachCalls: WorkflowEngine[] = [];
  let detachCalls = 0;

  const plugin = new WorkflowPlugin({
    clock: CLOCK,
    wireBridges: [
      (engine) => {
        attachCalls.push(engine);
        return () => {
          detachCalls += 1;
        };
      },
    ],
  });
  const app = fakeApp();

  await plugin.onLoad(app);

  // The attach fn ran exactly once, and was handed the very engine the plugin
  // now exposes through its accessor.
  assert.equal(attachCalls.length, 1, "the attach fn is invoked once on load");
  assert.equal(attachCalls[0], plugin.workflow, "the attach fn receives the live engine");
  assert.equal(detachCalls, 0, "the detacher is not invoked before unload");

  await plugin.onUnload(app);

  // The returned detacher ran exactly once on unload.
  assert.equal(detachCalls, 1, "the returned detacher is invoked on unload");
});

test("a wireBridges attach fn that returns nothing is tolerated on load and unload (Req 23.3)", async () => {
  let attached = 0;
  const plugin = new WorkflowPlugin({
    clock: CLOCK,
    // Returns void — no detacher to collect.
    wireBridges: [
      () => {
        attached += 1;
      },
    ],
  });
  const app = fakeApp();

  await plugin.onLoad(app);
  assert.equal(attached, 1, "the void-returning attach fn is invoked on load");

  // Unload must not throw even though no detacher was collected.
  await plugin.onUnload(app);
  assert.equal(plugin.workflow, undefined, "the engine is released after onUnload");
});

// ── 3. Idempotent load and safe never-loaded unload ────────────────────────────────

test("a second onLoad without an intervening onUnload reuses the engine and does not re-wire (Req 23.3)", async () => {
  let attachCalls = 0;
  const plugin = new WorkflowPlugin({
    clock: CLOCK,
    wireBridges: [
      () => {
        attachCalls += 1;
        return () => {};
      },
    ],
  });
  const app = fakeApp();

  await plugin.onLoad(app);
  const firstEngine = plugin.workflow;

  await plugin.onLoad(app);
  // The same engine is retained and the wiring did not run a second time.
  assert.equal(plugin.workflow, firstEngine, "a repeated onLoad reuses the constructed engine");
  assert.equal(attachCalls, 1, "the bridge wiring is not re-applied on a repeated onLoad");

  await plugin.onUnload(app);
});

test("onUnload on a never-loaded plugin is a safe no-op", async () => {
  const plugin = new WorkflowPlugin({ clock: CLOCK });

  // No engine was ever constructed; unload must not throw and the accessor stays
  // undefined.
  await plugin.onUnload(fakeApp());
  assert.equal(plugin.workflow, undefined, "the accessor stays undefined after a no-op unload");
});
