import test from "node:test";
import assert from "node:assert/strict";

import { compose, runPipeline } from "../middleware.js";
import type {
  GatewayRequest,
  GatewayResponse,
  Middleware,
  NextFn,
  RequestContext,
} from "../types.js";

/**
 * `compose` is typed to return a zero-argument {@link NextFn}, but the composed
 * pipeline threads the {@link RequestContext} supplied at invocation. This helper
 * invokes it with a context, mirroring how {@link runPipeline} drives it.
 */
function invoke(pipeline: NextFn, ctx: RequestContext): Promise<GatewayResponse> {
  return (pipeline as (c: RequestContext) => Promise<GatewayResponse>)(ctx);
}

// ── Fixtures ────────────────────────────────────────────────────────────────────

/** A minimal request used by these unit tests. */
function makeRequest(): GatewayRequest {
  return {
    method: "GET",
    url: "/x",
    path: "/x",
    headers: {},
  };
}

/** A fresh, minimal request context. */
function makeCtx(): RequestContext {
  return {
    request: makeRequest(),
    requestId: "req-1",
    identity: null,
    state: {},
  };
}

/** A response helper. */
function res(status: number): GatewayResponse {
  return { status, headers: {} };
}

/**
 * A middleware that records `"<name>:in"` before delegating and `"<name>:out"`
 * after the downstream chain resolves.
 */
function recorder(name: string, log: string[]): Middleware {
  return async (_ctx: RequestContext, next: NextFn): Promise<GatewayResponse> => {
    log.push(`${name}:in`);
    const response = await next();
    log.push(`${name}:out`);
    return response;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────────

test("runs middlewares outermost-first and unwinds in reverse", async () => {
  const log: string[] = [];
  const a = recorder("a", log);
  const b = recorder("b", log);
  const terminal: NextFn = async () => {
    log.push("terminal");
    return res(200);
  };

  const response = await runPipeline(makeCtx(), [a, b], terminal);

  assert.equal(response.status, 200);
  assert.deepEqual(log, ["a:in", "b:in", "terminal", "b:out", "a:out"]);
});

test("the terminal handler's response propagates back out unchanged", async () => {
  const terminalResponse = res(201);
  const a: Middleware = async (_ctx, next) => next();
  const b: Middleware = async (_ctx, next) => next();
  const terminal: NextFn = async () => terminalResponse;

  const response = await runPipeline(makeCtx(), [a, b], terminal);

  assert.equal(response, terminalResponse);
  assert.equal(response.status, 201);
});

test("a middleware can short-circuit without invoking downstream", async () => {
  const log: string[] = [];
  const outer = recorder("outer", log);
  const shortCircuit: Middleware = async () => {
    log.push("short:handled");
    return res(403);
  };
  const downstream: Middleware = async (_ctx, next) => {
    log.push("downstream:in");
    return next();
  };
  let terminalRan = false;
  const terminal: NextFn = async () => {
    terminalRan = true;
    return res(200);
  };

  const response = await runPipeline(makeCtx(), [outer, shortCircuit, downstream], terminal);

  assert.equal(response.status, 403);
  assert.equal(terminalRan, false);
  // outer wraps the short-circuit; downstream and terminal are never reached.
  assert.deepEqual(log, ["outer:in", "short:handled", "outer:out"]);
});

test("compose returns a NextFn-compatible pipeline that runs the chain", async () => {
  const log: string[] = [];
  const a = recorder("a", log);
  const terminal: NextFn = async () => {
    log.push("terminal");
    return res(200);
  };

  const pipeline = compose([a], terminal);
  const response = await invoke(pipeline, makeCtx());

  assert.equal(response.status, 200);
  assert.deepEqual(log, ["a:in", "terminal", "a:out"]);
});

test("calling next() more than once throws a clear error", async () => {
  const doubleNext: Middleware = async (_ctx, next) => {
    await next();
    // Second call must throw.
    return next();
  };
  const terminal: NextFn = async () => res(200);

  await assert.rejects(runPipeline(makeCtx(), [doubleNext], terminal), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /more than once/);
    return true;
  });
});

test("a composed pipeline may be reused across requests", async () => {
  const log: string[] = [];
  const a = recorder("a", log);
  const terminal: NextFn = async () => {
    log.push("terminal");
    return res(200);
  };
  const pipeline = compose([a], terminal);

  await invoke(pipeline, makeCtx());
  await invoke(pipeline, makeCtx());

  assert.deepEqual(log, [
    "a:in",
    "terminal",
    "a:out",
    "a:in",
    "terminal",
    "a:out",
  ]);
});
