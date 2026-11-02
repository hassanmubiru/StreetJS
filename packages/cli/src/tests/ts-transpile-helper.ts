// ts-transpile-helper.ts
// Drop-in replacement for ts.transpileModule() compatible with TypeScript 7+.
// TypeScript 7 removed transpileModule from its public API. This helper uses
// esbuild (already a devDep) to provide the same one-shot TS→JS transform the
// tests use to verify generated code compiles without errors.

import { transformSync } from 'esbuild';

export interface TranspileResult {
  outputText: string;
  diagnosticsText?: string;
}

/**
 * Transpile a TypeScript source string to JavaScript.
 * API-compatible with the ts.transpileModule() calls in the test suite:
 *   transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 }})
 */
export function transpileModule(
  source: string,
  _options?: { compilerOptions?: Record<string, unknown> },
): TranspileResult {
  const result = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
    // Ignore missing imports — we're only checking the TS compiles, not that
    // the imports resolve (the template files import 'streetjs' which isn't
    // installed in the CLI package itself).
    logLevel: 'silent',
  });
  return { outputText: result.code };
}

// Enum constants matching ts.ModuleKind and ts.ScriptTarget used in test files.
// Values match the TypeScript compiler enum values (for documentation; the
// transpile helper above ignores them since esbuild uses string targets).
export const ModuleKind = {
  CommonJS: 1,
  AMD: 2,
  UMD: 3,
  System: 4,
  ES2015: 5,
  ES2020: 6,
  ES2022: 7,
  ESNext: 99,
  None: 0,
  Node16: 100,
  NodeNext: 199,
} as const;

export const ScriptTarget = {
  ES3: 0,
  ES5: 1,
  ES2015: 2,
  ES2016: 3,
  ES2017: 4,
  ES2018: 5,
  ES2019: 6,
  ES2020: 7,
  ES2021: 8,
  ES2022: 9,
  ES2023: 10,
  ESNext: 99,
  Latest: 99,
} as const;
