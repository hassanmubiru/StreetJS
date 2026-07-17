// src/registry.ts
// Model registry: metadata about which models exist, on which provider, their
// capabilities, and their cost — used to route and to pick the cheapest model.

/** A capability a model can serve. */
export type ModelCapability = 'chat' | 'embed' | 'transcribe';

/** Registered metadata for a single model. */
export interface ModelInfo {
  /** Model id as passed to the provider, e.g. 'gpt-4o-mini'. */
  id: string;
  /** Name of the provider that serves this model (matches a router provider). */
  provider: string;
  /** Capabilities this model supports. */
  capabilities: ModelCapability[];
  /** USD cost per 1k input tokens (for cost-aware routing). */
  costPer1kInput?: number;
  /** USD cost per 1k output tokens. */
  costPer1kOutput?: number;
  /** Maximum context window in tokens. */
  contextWindow?: number;
}

/** Registry of known models, queryable by id, capability, and cost. */
export class ModelRegistry {
  private readonly models = new Map<string, ModelInfo>();

  constructor(initial: ModelInfo[] = []) {
    for (const m of initial) this.register(m);
  }

  /** Register (or replace) a model. Returns `this` for chaining. */
  register(info: ModelInfo): this {
    if (!info.id) throw new Error('ModelRegistry.register: model id is required');
    if (!info.provider) throw new Error('ModelRegistry.register: model provider is required');
    if (!info.capabilities?.length) {
      throw new Error(`ModelRegistry.register: model "${info.id}" needs at least one capability`);
    }
    this.models.set(info.id, info);
    return this;
  }

  /** Look up a model by id. */
  get(id: string): ModelInfo | undefined {
    return this.models.get(id);
  }

  /** The provider name serving `modelId`, if registered. */
  providerFor(modelId: string): string | undefined {
    return this.models.get(modelId)?.provider;
  }

  /** All models (optionally filtered to those supporting `capability`). */
  list(capability?: ModelCapability): ModelInfo[] {
    const all = [...this.models.values()];
    return capability ? all.filter((m) => m.capabilities.includes(capability)) : all;
  }

  /**
   * The cheapest model supporting `capability`, ranked by
   * `costPer1kInput + costPer1kOutput` (unspecified costs count as Infinity so
   * priced models are preferred). Ties break by model id for determinism.
   */
  cheapest(capability: ModelCapability): ModelInfo | undefined {
    const candidates = this.list(capability);
    if (candidates.length === 0) return undefined;
    const cost = (m: ModelInfo): number => {
      const input = m.costPer1kInput ?? Infinity;
      const output = m.costPer1kOutput ?? Infinity;
      if (input === Infinity && output === Infinity) return Infinity;
      return (m.costPer1kInput ?? 0) + (m.costPer1kOutput ?? 0);
    };
    return [...candidates].sort((a, b) => cost(a) - cost(b) || (a.id < b.id ? -1 : 1))[0];
  }
}
