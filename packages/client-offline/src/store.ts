// src/store.ts
// Default in-memory OfflineStore. Apps wrap localStorage/IndexedDB/AsyncStorage
// behind the same interface for real persistence.

import type { OfflineStore } from './types.js';

/** In-memory {@link OfflineStore} (default). State is lost on reload. */
export class MemoryOfflineStore implements OfflineStore {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}
