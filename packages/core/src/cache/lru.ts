// src/cache/lru.ts
//
// The LRU cache implementation now lives in the standalone @streetjs/cache
// package (single source of truth). This module re-exports it so the
// `streetjs/cache` subpath and all internal `../cache/lru.js` imports keep
// working unchanged — dependency inversion, not duplication.

export { LruCache } from '@streetjs/cache';
export type { LruOptions } from '@streetjs/cache';
