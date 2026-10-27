// packages/client/src/client.ts
// createStreetClient — the universal SDK entry point. Assembles the HTTP layer,
// REST resources, auth, search, uploads, realtime, and AI streaming. No
// framework assumptions; browser + Node.

import { request, type StreetClientConfig, type RequestOptions, type Query } from './http.js';
import { createRealtime, type RealtimeClient, type RealtimeClientOptions } from './realtime.js';
import { streamChat, type ChatMessage } from './ai.js';

/** Generic REST resource accessor (`/<name>` collection + `/<name>/:id` item). */
export interface ResourceClient<T = unknown> {
  list(query?: Query): Promise<T[]>;
  get(id: string | number): Promise<T>;
  create(body: Partial<T>): Promise<T>;
  update(id: string | number, body: Partial<T>): Promise<T>;
  remove(id: string | number): Promise<void>;
}

function makeResource<T>(config: StreetClientConfig, name: string): ResourceClient<T> {
  const base = `/${name}`;
  const id = (v: string | number): string => `${base}/${encodeURIComponent(String(v))}`;
  return {
    list: (query) => request<T[]>(config, 'GET', base, query ? { query } : {}),
    get: (v) => request<T>(config, 'GET', id(v)),
    create: (body) => request<T>(config, 'POST', base, { body }),
    update: (v, body) => request<T>(config, 'PUT', id(v), { body }),
    remove: (v) => request<void>(config, 'DELETE', id(v)),
  };
}

export interface AuthClient {
  login<R = unknown>(credentials: Record<string, unknown>): Promise<R>;
  register<R = unknown>(body: Record<string, unknown>): Promise<R>;
  logout(): Promise<void>;
  session<R = unknown>(): Promise<R>;
}

export interface StreetClientBase {
  /** Raw typed request escape hatch. */
  request<T = unknown>(method: string, path: string, opts?: RequestOptions): Promise<T>;
  /** Typed REST resource accessor. */
  resource<T = unknown>(name: string): ResourceClient<T>;
  auth: AuthClient;
  /** Full-text search (`GET /search?q=...`). */
  search<T = unknown>(q: string, query?: Query): Promise<T>;
  /** Upload a file via multipart/form-data. */
  uploadFile<R = unknown>(path: string, file: Blob | File, fields?: Record<string, string>): Promise<R>;
  /** Create a realtime (WebSocket) client. */
  realtime(path?: string, options?: RealtimeClientOptions): RealtimeClient;
  /** Stream an AI chat completion (async iterator of text tokens). */
  aiChat(params: { messages: ChatMessage[]; model?: string; path?: string; signal?: AbortSignal }): AsyncGenerator<string, void, unknown>;
}

/** The client, with convenience resource access: `client.users.list()`. */
export type StreetClient = StreetClientBase & Record<string, ResourceClient>;

/**
 * Create a StreetJS client.
 *
 * @example
 * const api = createStreetClient({ baseUrl: '/api' });
 * const users = await api.users.list();
 */
export function createStreetClient(config: StreetClientConfig): StreetClient {
  const auth: AuthClient = {
    login: (credentials) => request(config, 'POST', '/auth/login', { body: credentials }),
    register: (body) => request(config, 'POST', '/auth/register', { body }),
    logout: () => request<void>(config, 'POST', '/auth/logout'),
    session: () => request(config, 'GET', '/auth/session'),
  };

  const base: StreetClientBase = {
    request: (method, path, opts) => request(config, method, path, opts),
    resource: (name) => makeResource(config, name),
    auth,
    search: (q, query) => request(config, 'GET', '/search', { query: { q, ...query } }),
    uploadFile: (path, file, fields) => {
      const form = new FormData();
      form.append('file', file);
      for (const [k, v] of Object.entries(fields ?? {})) form.append(k, v);
      return request(config, 'POST', path, { rawBody: form });
    },
    realtime: (path, options) => createRealtime(config, path, options),
    aiChat: (params) => streamChat(config, params),
  };

  const reserved = new Set(Object.keys(base));
  // Proxy: known members resolve to base; any other property name resolves to a
  // REST resource of that name (`client.users` → resource('users')).
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !reserved.has(prop) && prop !== 'then') {
        return makeResource(config, prop);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as StreetClient;
}
