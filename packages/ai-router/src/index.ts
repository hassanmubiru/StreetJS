/**
 * @streetjs/ai-router — model registry + a routing AI provider.
 *
 * `ModelRegistry` records which models exist, on which provider, with what
 * capabilities and cost. `AiRouter` implements the `@streetjs/ai` `AiProvider`
 * contract (`chat`/`embed`/`transcribe`) by selecting a provider — by the
 * request's model (via the registry), by preference order, or by cost — and
 * falling back to the remaining providers on failure.
 *
 * ```ts
 * import { AiRouter, ModelRegistry } from '@streetjs/ai-router';
 *
 * const registry = new ModelRegistry([
 *   { id: 'gpt-4o-mini', provider: 'openai', capabilities: ['chat', 'embed'], costPer1kInput: 0.15 },
 *   { id: 'llama3',      provider: 'ollama', capabilities: ['chat', 'embed'], costPer1kInput: 0 },
 * ]);
 * const ai = new AiRouter({
 *   providers: [{ name: 'openai', provider: openai }, { name: 'ollama', provider: ollama }],
 *   registry, fallback: true,
 * });
 * await ai.chat({ messages: [{ role: 'user', content: 'hi' }], model: 'llama3' });
 * ```
 */

export { AiRouter, AiRoutingError } from './router.js';
export type { AiRouterOptions, NamedProvider, RoutingStrategy } from './router.js';

export { ModelRegistry } from './registry.js';
export type { ModelInfo, ModelCapability } from './registry.js';
