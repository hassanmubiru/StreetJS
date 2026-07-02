// src/cli/generators.ts
// @streetjs/queue — code generators for `make:job` / `make:worker` (Req 15.2,
// 15.3, 15.4, 15.6, 15.7).
//
// Validates a provided name, refuses to overwrite an existing target, and emits
// a typed scaffold that imports only public `@streetjs/queue` symbols and
// compiles under `tsc`. Implemented in task 16.1; the declarations below are
// compiling scaffolds.

/** The outcome of a generator invocation. */
export interface GenerateResult {
  /** Absolute path of the file that was (or would be) written. */
  path: string;
  /** The generated source content. */
  contents: string;
}

/** Validate a `make:job` / `make:worker` name (identifier-safe). */
export function isValidGeneratorName(_name: string): boolean {
  throw new Error('isValidGeneratorName not implemented (task 16.1)');
}

/** Generate a Job scaffold. */
export function generateJob(_name: string): GenerateResult {
  throw new Error('generateJob not implemented (task 16.1)');
}

/** Generate a Worker scaffold. */
export function generateWorker(_name: string): GenerateResult {
  throw new Error('generateWorker not implemented (task 16.1)');
}
