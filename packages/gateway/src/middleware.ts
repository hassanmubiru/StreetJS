/**
 * @streetjs/gateway — middleware composition.
 *
 * A classic "onion" middleware model. {@link compose} folds an ordered list of
 * {@link Middleware} into a single {@link NextFn}: the first middleware in the
 * array is the outermost layer and the `terminal` handler sits at the core. Each
 * middleware receives the shared {@link RequestContext} and a `next` closure that
 * invokes the remainder of the chain.
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
 * function starts the chain when invoked.
 *
 * Each `next` handed to a middleware may be called at most once; a second call
 * throws an {@link Error}.
 */
export function compose(middlewares: readonly Middleware[], terminal: NextFn): NextFn {
  // Fold from the innermost layer outward so index 0 ends up outermost.
  let chain: NextFn = guardOnce(terminal, middlewares.length);
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const mw = middlewares[i]!;
    const downstream = chain;
    const wrapped: NextFn = (ctx: RequestContext) => mw(ctx, downstream as NextFn);
    // `next` closures are guarded so a middleware cannot advance the chain twice.
    chain = guardOnce(wrapped, i);
  }
  return chain;
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
 * for a clear diagnostic (`length` denotes the terminal handler).
 */
function guardOnce(fn: NextFn, index: number): NextFn {
  let called = false;
  return (ctx: RequestContext) => {
    if (called) {
      const where = index === -1 ? "the pipeline" : `middleware[${index}]`;
      throw new Error(
        `next() was called more than once from ${where}; each middleware may advance the chain at most once`,
      );
    }
    called = true;
    return fn(ctx);
  };
}
