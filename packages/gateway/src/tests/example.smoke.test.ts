import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Smoke test for the runnable edge example. Spawns the COMPILED example exactly
 * as `npm run example` would (`node dist/examples/edge/index.js`) and asserts it
 * exits 0 and prints the expected end-to-end flow markers. This proves the
 * example is genuinely runnable in-process with no network egress.
 */

const here = dirname(fileURLToPath(import.meta.url));
// dist/tests/example.smoke.test.js → dist/examples/edge/index.js
const exampleEntry = resolve(here, "../examples/edge/index.js");

function runExample(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [exampleEntry], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

describe("edge example (runnable, in-process)", () => {
  it("runs to completion, exits 0, and demonstrates the full flow", async () => {
    const { code, stdout, stderr } = await runExample();
    assert.equal(code, 0, `example exited non-zero. stderr:\n${stderr}`);
    // Backend responses routed through the gateway.
    assert.match(stdout, /POST \/v1\/auth\/login → 200/);
    assert.match(stdout, /POST \/v1\/users\s+→ 201/);
    // Compression actually engaged on the padded list response.
    assert.match(stdout, /content-encoding=gzip/);
    // CORS preflight short-circuit and 404 routing.
    assert.match(stdout, /OPTIONS \/v1\/users\s+→ 204/);
    assert.match(stdout, /GET\s+\/v1\/nope\s+→ 404/);
    // Downstream pillar fan-out occurred.
    assert.match(stdout, /events\s+: 2 published/);
    assert.match(stdout, /realtime\s+: 1 broadcast/);
    assert.match(stdout, /Done\. \(all in-process; no network egress\)/);
  });
});
