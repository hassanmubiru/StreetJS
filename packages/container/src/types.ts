// src/types.ts
// Shared type utilities for the DI container.

/**
 * A newable class reference — the token type used throughout the container to
 * register, resolve, and key singleton instances.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T;
