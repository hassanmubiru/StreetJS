// packages/react/src/hooks.ts
// React hooks over @streetjs/client. Each is a thin, SSR-safe wrapper; data
// hooks expose { data, error, loading, refetch }.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, RealtimeClient, RealtimeMessage } from '@streetjs/client';
import { useStreetClient } from './context.js';

export interface QueryState<T> { data?: T; error?: unknown; loading: boolean; }
export interface QueryResult<T> extends QueryState<T> { refetch: () => void; }

/** Run an async fetcher, re-running when `deps` change or `refetch()` is called. */
export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[] = []): QueryResult<T> {
  const [state, setState] = useState<QueryState<T>>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fetcher()
      .then((data) => { if (!cancelled) setState({ data, loading: false }); })
      .catch((error) => { if (!cancelled) setState({ error, loading: false }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refetch };
}

export interface MutationResult<V, R> extends QueryState<R> { mutate: (vars: V) => Promise<R>; }

/** Wrap an async action; exposes loading/data/error and a `mutate` trigger. */
export function useMutation<V, R>(fn: (vars: V) => Promise<R>): MutationResult<V, R> {
  const [state, setState] = useState<QueryState<R>>({ loading: false });
  const mutate = useCallback(async (vars: V) => {
    setState({ loading: true });
    try {
      const data = await fn(vars);
      setState({ data, loading: false });
      return data;
    } catch (error) {
      setState({ error, loading: false });
      throw error;
    }
  }, [fn]);
  return { ...state, mutate };
}

/** Current session (or null), refetched after login/logout/register. */
export function useSession<S = unknown>(): QueryResult<S | null> {
  const client = useStreetClient();
  return useQuery<S | null>(() => client.auth.session<S>().catch(() => null), []);
}

export interface AuthApi<S> {
  session?: S | null;
  loading: boolean;
  error?: unknown;
  login: (credentials: Record<string, unknown>) => Promise<unknown>;
  register: (body: Record<string, unknown>) => Promise<unknown>;
  logout: () => Promise<void>;
  refetch: () => void;
}

/** Auth state + actions; actions refresh the session on success. */
export function useAuth<S = unknown>(): AuthApi<S> {
  const client = useStreetClient();
  const q = useSession<S>();
  const refetchRef = useRef(q.refetch);
  refetchRef.current = q.refetch;
  const login = useCallback(async (c: Record<string, unknown>) => { const r = await client.auth.login(c); refetchRef.current(); return r; }, [client]);
  const register = useCallback(async (b: Record<string, unknown>) => { const r = await client.auth.register(b); refetchRef.current(); return r; }, [client]);
  const logout = useCallback(async () => { await client.auth.logout(); refetchRef.current(); }, [client]);
  return { session: q.data, loading: q.loading, error: q.error, login, register, logout, refetch: q.refetch };
}

/** Full-text search for a query string. */
export function useSearch<T = unknown>(q: string): QueryResult<T> {
  const client = useStreetClient();
  return useQuery<T>(() => client.search<T>(q), [q]);
}

/** A connected realtime client, opened on mount and closed on unmount. */
export function useRealtime(path?: string): RealtimeClient {
  const client = useStreetClient();
  const ref = useRef<RealtimeClient | null>(null);
  if (!ref.current) ref.current = client.realtime(path);
  useEffect(() => {
    const rt = ref.current!;
    rt.connect();
    return () => rt.close();
  }, []);
  return ref.current;
}

/** Subscribe to a realtime channel for the lifetime of the component. */
export function useChannel<T = unknown>(channel: string, handler: (msg: RealtimeMessage<T>) => void, path?: string): void {
  const rt = useRealtime(path);
  const cb = useRef(handler);
  cb.current = handler;
  useEffect(() => rt.subscribe<T>(channel, (m) => cb.current(m)), [rt, channel]);
}

export interface AIChat {
  messages: ChatMessage[];
  streaming: boolean;
  send: (content: string) => Promise<void>;
}

/** Stateful AI chat: appends user + streaming assistant messages. */
export function useAIChat(opts?: { initial?: ChatMessage[]; model?: string; path?: string }): AIChat {
  const client = useStreetClient();
  const [messages, setMessages] = useState<ChatMessage[]>(opts?.initial ?? []);
  const [streaming, setStreaming] = useState(false);
  const ref = useRef(messages);
  ref.current = messages;

  const send = useCallback(async (content: string) => {
    const base: ChatMessage[] = [...ref.current, { role: 'user', content }];
    setMessages([...base, { role: 'assistant', content: '' }]);
    setStreaming(true);
    let acc = '';
    try {
      for await (const token of client.aiChat({ messages: base, ...(opts?.model ? { model: opts.model } : {}), ...(opts?.path ? { path: opts.path } : {}) })) {
        acc += token;
        setMessages((m) => { const copy = m.slice(); copy[copy.length - 1] = { role: 'assistant', content: acc }; return copy; });
      }
    } finally {
      setStreaming(false);
    }
  }, [client, opts?.model, opts?.path]);

  return { messages, streaming, send };
}
