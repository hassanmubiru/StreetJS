import { MemoryWorkflow, FakeWorkflow, FakeClock, WorkflowHarness } from "./dist/testing/index.js";
import assert from "node:assert/strict";

const clock = FakeClock(1000);
assert.equal(clock(), 1000);
clock.advance(500); assert.equal(clock(), 1500);
clock.set(42); assert.equal(clock.now(), 42);

const engine = MemoryWorkflow({ clock: FakeClock(0) });
engine.define("greet", async (_ctx, name) => `hi ${name}`);
const h = await engine.run("greet", "there");
assert.equal(await h.result(), "hi there");
assert.equal(await engine.status(h.runId), "completed");
await engine.close();

const harness = new WorkflowHarness();
harness.engine.define("wf", async (ctx) => { await ctx.state.set("k", 1); return "done"; });
const hh = await harness.engine.run("wf", null);
await harness.assertStatus(hh.runId, "completed");
await harness.assertHistory(hh.runId, ["run.started", "run.status", "run.status"]);
await harness.engine.close();

const fake = new FakeWorkflow();
fake.define("f", async () => 1);
const fh = await fake.run("f", { a: 1 });
await fake.signal(fh.runId, "sig", { p: 2 });
assert.equal(fake.definedWorkflows.length, 1);
assert.equal(fake.startedRuns.length, 1);
assert.equal(fake.deliveredSignals[0].name, "sig");
assert.equal(await fake.status(fh.runId), "running");
await assert.rejects(fh.result());

console.log("SMOKE_OK");
