// src/types.ts
// Shared type utilities for the DI container.

/**
 * A newable class reference — the token type used throughout the container to
 * register, resolve, and key singleton instances.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T;

/** A class, symbol, or string that identifies a dependency binding. */
export type Token<T = unknown> = Constructor<T> | symbol | string;

/** Lifetime used by explicit container bindings. */
export type BindingScope = 'singleton' | 'transient' | 'scoped';
