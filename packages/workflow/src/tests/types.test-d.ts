// src/tests/types.test-d.ts
// @streetjs/workflow — compile-time TYPE tests.
//
// This file is validated purely by the `tsc` build under `strict` mode: if any
// of the assertions below stop holding, the package fails to compile. It is
// intentionally named `.test-d.ts` (not `.test.ts`) so it is NOT picked up by
// `node --test dist/tests/*.test.js` — there is no runtime behavior to run, the
// value of the file is entirely in the types it asserts.
//
// It exercises the public surface exported from `../index.js`:
//   - `createWorkflow()` returns a strongly typed `WorkflowEngine`
//   - `engine.define<I, O>(...)` threads the typed `WorkflowContext` and input
//   - `ctx.activity<Out>(...)` resolves to the declared `Out`
//   - `ctx.parallel.all(...)` preserves positional tuple element typing
//   - `ctx.state.get<T>(...)` returns `T | undefined`
//   - `handle.result()` resolves to the workflow's declared output `O`
//   - `engine.run` rejects a structurally wrong input (`@ts-expect-error`)
//
// Requirements: 12.3, 22.3, 22.6, 27.1, 31.1

import { createWorkflow } from "../index.js";
import type {
  Activity,
  ParallelInput,
  WorkflowContext,
  WorkflowEngine,
  WorkflowHandle,
} from "../index.js";

// ── Type-level assertion helpers ────────────────────────────────────────────────

/** `true` only when `A` and `B` are mutually assignable (exact type equality). */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** Compiles only when `T` is exactly `true`; a failed `Equal<>` breaks the build. */
type Expect<T extends true> = T;

// ── Public-surface shape assertions (module-level, no runtime) ───────────────────

// `createWorkflow` is the single public entry point and returns a WorkflowEngine.
// Exported so the alias is "used" under `noUnusedLocals` while staying a pure
// compile-time assertion (the reference itself breaks the build on regression).
export type _CreateReturnsEngine = Expect<Equal<ReturnType<typeof createWorkflow>, WorkflowEngine>>;

// `ParallelInput<T>` maps a result tuple to a positional tuple of Activities, so
// `ctx.parallel.all` can be strongly typed over an arbitrary result tuple.
export type _ParallelInputMapsTuple = Expect<
  Equal<ParallelInput<[number, string]>, [Activity<number>, Activity<string>]>
>;

// ── Data-flow assertions via explicit typed bindings ─────────────────────────────
//
// Each `const` below is annotated with the type the public API MUST produce. If
// the engine's generics regress (e.g. `ctx.activity` widens to `unknown`, or
// `handle.result()` loses `O`), these annotations fail to compile.

/**
 * Exercised only by `tsc`; never invoked. Marked `export` so its bindings count
 * as used under `noUnusedLocals` while remaining pure compile-time assertions.
 */
export async function __workflowTypeAssertions(): Promise<void> {
  const engine: WorkflowEngine = createWorkflow();

  interface OrderInput {
    readonly id: string;
    readonly quantity: number;
  }
  interface OrderOutput {
    readonly total: number;
  }

  engine.define<OrderInput, OrderOutput>(
    "order",
    async (ctx: WorkflowContext, input: OrderInput): Promise<OrderOutput> => {
      // `ctx.activity<Out>` resolves to the declared `Out` (here: number).
      const price: number = await ctx.activity<number>(async () => 42);

      // `ctx.parallel.all` preserves positional tuple element typing.
      const parts: [number, string, boolean] = await ctx.parallel.all<[number, string, boolean]>([
        async () => 1,
        async () => "two",
        async () => true,
      ]);

      // `ctx.state.get<T>` returns `T | undefined`.
      const seen: number | undefined = ctx.state.get<number>("count");

      const total: number =
        price +
        input.quantity +
        parts[0] +
        parts[1].length +
        (parts[2] ? 1 : 0) +
        (seen ?? 0);
      return { total };
    },
  );

  // `run<I, O>` yields a `WorkflowHandle<O>`; `result()` resolves to `O`.
  const handle: WorkflowHandle<OrderOutput> = await engine.run<OrderInput, OrderOutput>("order", {
    id: "a",
    quantity: 2,
  });
  const out: OrderOutput = await handle.result();
  void out;

  // Enforcement proof: a structurally wrong input (missing `quantity`) is a
  // compile error. The `@ts-expect-error` directive itself fails the build if
  // this call ever type-checks, so the enforcement can never silently regress.
  // @ts-expect-error — `run` requires an `OrderInput`; `{ id }` is missing `quantity`.
  await engine.run<OrderInput, OrderOutput>("order", { id: "a" });
}
