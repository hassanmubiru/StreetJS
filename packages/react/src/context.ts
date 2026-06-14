// packages/react/src/context.ts
// Provides the @streetjs/client instance via React context.

import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { StreetClient } from '@streetjs/client';

const ClientContext = createContext<StreetClient | null>(null);

export interface StreetProviderProps {
  client: StreetClient;
  children?: ReactNode;
}

/** Provide a StreetJS client to the React tree. */
export function StreetProvider(props: StreetProviderProps): ReturnType<typeof createElement> {
  return createElement(ClientContext.Provider, { value: props.client }, props.children);
}

/** Read the StreetJS client from context. Throws if no provider is present. */
export function useStreetClient(): StreetClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useStreetClient must be used within a <StreetProvider>.');
  return client;
}
