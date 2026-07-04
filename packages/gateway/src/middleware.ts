/**
 * @streetjs/gateway — middleware composition.
 *
 * A classic "onion" middleware model. {@link compose} folds an ordered list of
 * {@link Middleware} into a single {@link NextFn}: the first middleware in the
 * array is the outermost layer and the `terminal` handler sits at the core. Each
 * middleware receives the shared {@link RequestContext} and a `next` closure that
 * invokes the remainder of the chain.
 *
 * Because {@link NextFn} is a zero-argument thunk, the request context is supplied
 * when the composed function is invoked (see {@link runPipeline}); the `next`
 * closures handed to each middleware then close over that same context.
 *
 * Every `next` closure is guarded so it can be invoked at most once; a second
 * invocation throws, surfacing a common middleware bug (calling `next()` twice)
 * rather than silently re-running downstream layers.
 */

import type { GatewayResponse, Middleware, NextFn, RequestContext } from "./types.js";

/**
 * Compose `middlewares` into a single {@link NextFn} around `terminal`.
 *
 * Runs the middlewares in array order — `middlewares[0]` is the outermost layer,
 * wrapping `middlewares[1]`, and so on, with `terminal` at the core. The returned
 * thunk starts the chain when invoked; supply the {@link RequestContext} at
 * invocation time. Each invocation builds a fresh set of once-guards, so a
 * composed pipeline may be reused across requests.
 *
 * Each `next` handed to a middleware may be called at most once; a second call
 * throws an {@link Error}.
 */
export function compose(middlewares: readonly Middleware[], terminal: NextFn): NextFn {
  return (ctx?: RequestContext): Promise<GatewayResponse> => {
    if (ctx === undefined) {
      throw new Error("compose(...): the composed pipeline must be invoked with a RequestContext");
    }
    // Fold from the innermost layer outward so index 0 ends up outermost. Guards
    // are created per invocation so the pipeline can be safely reused.
    let chain: NextFn = guardOnce(terminal, -1);
    for (let i = middlewares.length - 1; i >= 0; i--) {
      const mw = middlewares[i]!;
      const downstream = chain;
      chain = guardOnce(() => mw(ctx, downstream), i);
    }
    return chain();
  };
}

/**
 * Compose `middlewares` around `terminal` and immediately invoke the chain with
 * `ctx`, returning the final {@link GatewayResponse}.
 */
export function runPipeline(
  ctx: RequestContext,
  middlewares: readonly Middleware[],
  terminal: NextFn,
): Promise<GatewayResponse> {
  return compose(middlewares, terminal)(ctx);
}

/**
 * Wrap a chain step so it can only be invoked once. `index` identifies the layer
 * for a clear diagnostic (`-1` denotes the terminal handler).
 */
function guardOnce(fn: NextFn, index: number): NextFn {
  let called = false;
  return (): Promise<GatewayResponse> => {
    if (called) {
      const where = index === -1 ? "the terminal handler" : `middleware[${index}]`;
      throw new Error(
        `next() was called more than once from ${where}; each layer may advance the chain at most once`,
      );
    }
    called = true;
    return fn();
  };
}
