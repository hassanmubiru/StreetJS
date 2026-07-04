/**
 * In-process stand-ins for the downstream StreetJS pillars used by the edge
 * example. They exist ONLY so the example is fully runnable offline with no
 * external service and no hard dependency on the optional pillar packages
 * (`@streetjs/realtime`, `@streetjs/storage`, `@streetjs/queue`,
 * `@streetjs/events`), which are declared as OPTIONAL peer deps of this package.
 *
 * Each stand-in mirrors the shape of the real pillar's surface closely enough to
 * make the data-flow obvious (Realtime broadcast, Storage KV, Queue enqueue,
 * Events pub/sub); swapping in the real packages is a one-line change at the
 * call sites in `index.ts`.
 */

/** A minimal realtime hub: broadcast a payload to every channel subscriber. */
export class RealtimeHub {
  readonly #subscribers = new Map<string, Array<(msg: unknown) => void>>();
  /** Everything broadcast so far, for assertions/printing. */
  readonly broadcasts: Array<{ channel: string; message: unknown }> = [];

  subscribe(channel: string, fn: (msg: unknown) => void): void {
    const list = this.#subscribers.get(channel) ?? [];
    list.push(fn);
    this.#subscribers.set(channel, list);
  }

  broadcast(channel: string, message: unknown): void {
    this.broadcasts.push({ channel, message });
    for (const fn of this.#subscribers.get(channel) ?? []) fn(message);
  }
}

/** A minimal key/value store standing in for the storage pillar. */
export class KeyValueStore {
  readonly #data = new Map<string, unknown>();

  put(key: string, value: unknown): void {
    this.#data.set(key, value);
  }

  get(key: string): unknown {
    return this.#data.get(key);
  }

  get size(): number {
    return this.#data.size;
  }
}

/** A minimal FIFO queue standing in for the queue pillar. */
export class WorkQueue {
  readonly #jobs: Array<{ name: string; payload: unknown }> = [];
  /** Jobs processed by {@link WorkQueue.drain}, in order. */
  readonly processed: Array<{ name: string; payload: unknown }> = [];

  enqueue(name: string, payload: unknown): void {
    this.#jobs.push({ name, payload });
  }

  get depth(): number {
    return this.#jobs.length;
  }

  /** Process every queued job through `worker`, then clear the queue. */
  async drain(worker: (job: { name: string; payload: unknown }) => Promise<void> | void): Promise<void> {
    while (this.#jobs.length > 0) {
      const job = this.#jobs.shift()!;
      await worker(job);
      this.processed.push(job);
    }
  }
}

/** A minimal event bus standing in for the events pillar. */
export class EventBus {
  readonly #handlers = new Map<string, Array<(payload: unknown) => void>>();
  /** Everything published so far, for assertions/printing. */
  readonly published: Array<{ type: string; payload: unknown }> = [];

  on(type: string, fn: (payload: unknown) => void): void {
    const list = this.#handlers.get(type) ?? [];
    list.push(fn);
    this.#handlers.set(type, list);
  }

  publish(type: string, payload: unknown): void {
    this.published.push({ type, payload });
    for (const fn of this.#handlers.get(type) ?? []) fn(payload);
  }
}
