// @streetjs/react — React hooks over @streetjs/client. Consumes the client only,
// never StreetJS core internals (RFC 0002). SSR-safe; React is a peer dependency.

export { StreetProvider, useStreetClient } from './context.js';
export type { StreetProviderProps } from './context.js';

export {
  useQuery, useMutation, useSession, useAuth, useSearch, useRealtime, useChannel, useAIChat,
} from './hooks.js';
export type { QueryState, QueryResult, MutationResult, AuthApi, AIChat } from './hooks.js';
