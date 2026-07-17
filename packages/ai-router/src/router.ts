// src/router.ts
// AiRouter: an AiProvider that routes to one of several providers by model /
// preference / cost, with automatic fallback on failure.

import type {
  AiProvider,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  TranscriptionRequest,
  TranscriptionResponse,
} from '@streetjs/ai';
import { ModelRegistry, type ModelCapability } from './registry.js';

/** Named provider entry for the router. */
export interface NamedProvider {
  name: string;
  provider: AiProvider;
}

/** Routing strategy for selecting a provider order. */
export type RoutingStrategy = 'ordered' | 'cheapest';

export interface AiRouterOptions {
  /** Providers in preference order (first is the default for 'ordered'). */
  providers: NamedProvider[];
  /** Registry mapping model ids → provider names + cost/capabilities. */
  registry?: ModelRegistry;
  /** Selection strategy when a request doesn't pin a known model. Default 'ordered'. */
  strategy?: RoutingStrategy;
  /** Try the remaining providers when the chosen one throws. Default true. */
  fallback?: boolean;
}

/** Raised when every candidate provider fails (or none can serve the request). */
export class AiRoutingError extends Error {
  constructor(message: string, public readonly causes: unknown[] = []) {
    super(message);
    this.name = 'AiRoutingError';
  }
}

/**
 * An {@link AiProvider} that fans a request across several providers. It picks a
 * provider order (by the request's model via the registry, else by strategy),
 * then tries each in turn, falling back on failure. It implements `transcribe`
 * only over providers that support it.
 */
export class AiRouter implements AiProvider {
  readonly name = 'router';
  private readonly providers: Map<string, AiProvider>;
  private readonly order: string[];
  private readonly registry: ModelRegistry;
  private readonly strategy: RoutingStrategy;
  private readonly fallback: boolean;

  constructor(options: AiRouterOptions) {
    if (!options?.providers?.length) {
      throw new AiRoutingError('AiRouter requires at least one provider');
    }
    this.providers = new Map(options.providers.map((p) => [p.name, p.provider]));
    this.order = options.providers.map((p) => p.name);
    this.registry = options.registry ?? new ModelRegistry();
    this.strategy = options.strategy ?? 'ordered';
    this.fallback = options.fallback ?? true;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.route('chat', request.model, (p) => p.chat(request));
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    return this.route('embed', request.model, (p) => p.embed(request));
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    return this.route('transcribe', request.model, (p) => {
      if (typeof p.transcribe !== 'function') {
        throw new Error('provider does not support transcription');
      }
      return p.transcribe(request);
    });
  }

  /** Provider order to try for a capability + optional pinned model. */
  private candidateOrder(capability: ModelCapability, model: string | undefined): string[] {
    // 1. If the request pins a model the registry knows, prefer its provider.
    const pinned = model ? this.registry.providerFor(model) : undefined;

    // 2. Base order by strategy.
    let base: string[];
    if (this.strategy === 'cheapest') {
      // Rank providers by the cheapest model each offers for this capability.
      const cheapest = this.registry.cheapest(capability);
      base = cheapest ? [cheapest.provider, ...this.order] : [...this.order];
    } else {
      base = [...this.order];
    }

    const ordered = pinned ? [pinned, ...base] : base;
    // De-dupe while preserving order, and keep only registered providers.
    const seen = new Set<string>();
    const result: string[] = [];
    for (const name of ordered) {
      if (this.providers.has(name) && !seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }
    return result;
  }

  private async route<T>(
    capability: ModelCapability,
    model: string | undefined,
    call: (provider: AiProvider) => Promise<T>,
  ): Promise<T> {
    const order = this.candidateOrder(capability, model);
    const causes: unknown[] = [];
    for (const name of order) {
      const provider = this.providers.get(name)!;
      try {
        return await call(provider);
      } catch (err) {
        causes.push(err);
        if (!this.fallback) break;
      }
    }
    const detail = causes.map((c) => (c instanceof Error ? c.message : String(c))).join('; ');
    throw new AiRoutingError(
      `All providers failed for ${capability}${model ? ` (model ${model})` : ''}: ${detail}`,
      causes,
    );
  }
}
