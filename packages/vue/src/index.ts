// @streetjs/vue — Vue 3 composables over @streetjs/client. Consumes the client
// only, never StreetJS core internals (RFC 0002). Vue is a peer dependency.

import {
  inject, provide, ref, shallowRef, onScopeDispose, watch,
  type App, type InjectionKey, type Ref, type ShallowRef,
} from 'vue';
import {
  createStreetClient, type StreetClient, type StreetClientConfig,
  type RealtimeClient, type RealtimeMessage,
} from '@streetjs/client';

const KEY: InjectionKey<StreetClient> = Symbol('streetjs.client');

/** Provide a client to descendants (call in setup of a root component / plugin). */
export function provideStreetClient(clientOrConfig: StreetClient | StreetClientConfig): StreetClient {
  const client = 'request' in clientOrConfig ? (clientOrConfig as StreetClient) : createStreetClient(clientOrConfig as StreetClientConfig);
  provide(KEY, client);
  return client;
}

/** Inject the client. Throws if no client was provided. */
export function useApi(): StreetClient {
  const client = inject(KEY, null);
  if (!client) throw new Error('No StreetJS client provided — call provideStreetClient() in a parent setup().');
  return client;
}

/**
 * App-level install: provide a client to an entire Vue app (use outside setup,
 * e.g. from `app.use(...)` or a Nuxt plugin). Returns the resolved client.
 */
export function installStreetClient(app: App, clientOrConfig: StreetClient | StreetClientConfig): StreetClient {
  const client = 'request' in clientOrConfig ? (clientOrConfig as StreetClient) : createStreetClient(clientOrConfig as StreetClientConfig);
  app.provide(KEY, client);
  return client;
}

export interface QueryComposable<T> {
  data: ShallowRef<T | undefined>;
  error: ShallowRef<unknown>;
  loading: Ref<boolean>;
  refetch: () => void;
}

/** Reactive async query; re-runs when reactive `deps` change or via `refetch()`. */
export function useQuery<T>(fetcher: () => Promise<T>, deps: Ref<unknown>[] = []): QueryComposable<T> {
  const data = shallowRef<T>();
  const error = shallowRef<unknown>();
  const loading = ref(true);
  let token = 0;
  const run = (): void => {
    const my = ++token;
    loading.value = true;
    fetcher()
      .then((d) => { if (my === token) { data.value = d; error.value = undefined; loading.value = false; } })
      .catch((e) => { if (my === token) { error.value = e; loading.value = false; } });
  };
  run();
  if (deps.length) watch(deps, run);
  return { data, error, loading, refetch: run };
}

/** Current session (or null). */
export function useSession<S = unknown>(): QueryComposable<S | null> {
  const client = useApi();
  return useQuery<S | null>(() => client.auth.session<S>().catch(() => null));
}

/** Auth state + actions; actions refresh the session. */
export function useAuth<S = unknown>() {
  const client = useApi();
  const q = useSession<S>();
  const login = (c: Record<string, unknown>) => client.auth.login(c).then((r) => { q.refetch(); return r; });
  const register = (b: Record<string, unknown>) => client.auth.register(b).then((r) => { q.refetch(); return r; });
  const logout = () => client.auth.logout().then(() => q.refetch());
  return { session: q.data, loading: q.loading, error: q.error, login, register, logout, refetch: q.refetch };
}

/** Full-text search; re-runs when the query ref changes. */
export function useSearch<T = unknown>(query: Ref<string>): QueryComposable<T> {
  const client = useApi();
  return useQuery<T>(() => client.search<T>(query.value), [query]);
}

/** A connected realtime client, closed automatically when the scope is disposed. */
export function useRealtime(path?: string): RealtimeClient {
  const client = useApi();
  const rt = client.realtime(path);
  rt.connect();
  onScopeDispose(() => rt.close());
  return rt;
}

/** Subscribe to a channel for the lifetime of the current scope. */
export function useChannel<T = unknown>(channel: string, handler: (m: RealtimeMessage<T>) => void, path?: string): void {
  const rt = useRealtime(path);
  const off = rt.subscribe<T>(channel, handler);
  onScopeDispose(off);
}

/** Stateful AI chat with streaming assistant tokens. */
export function useAI(opts?: { model?: string; path?: string }) {
  const client = useApi();
  const messages = ref<{ role: 'system' | 'user' | 'assistant'; content: string }[]>([]);
  const streaming = ref(false);
  const send = async (content: string): Promise<void> => {
    const base = [...messages.value, { role: 'user' as const, content }];
    messages.value = [...base, { role: 'assistant' as const, content: '' }];
    streaming.value = true;
    let acc = '';
    try {
      for await (const token of client.aiChat({ messages: base, ...(opts?.model ? { model: opts.model } : {}), ...(opts?.path ? { path: opts.path } : {}) })) {
        acc += token;
        const copy = messages.value.slice();
        copy[copy.length - 1] = { role: 'assistant', content: acc };
        messages.value = copy;
      }
    } finally {
      streaming.value = false;
    }
  };
  return { messages, streaming, send };
}

export { createStreetClient } from '@streetjs/client';
export type { StreetClient, StreetClientConfig } from '@streetjs/client';
