// packages/ai/src/providers.ts
// Real HTTP adapters for OpenAI, Anthropic, and Ollama. Each takes an injectable
// `fetch`, so request shaping and response parsing are unit-testable without
// network access (pass a stub fetch in tests; the default is global fetch).

import type {
  AiProvider,
  ChatRequest,
  ChatResponse,
  ChatMessage,
  EmbedRequest,
  EmbedResponse,
  ToolCall,
} from './index.js';

/** Subset of the Fetch API this module depends on. */
export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

interface BaseOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  fetch?: FetchLike;
}

function resolveFetch(f: FetchLike | undefined): FetchLike {
  if (f) return f;
  const g = (globalThis as { fetch?: unknown }).fetch;
  if (typeof g !== 'function') {
    throw new Error('No fetch available; pass options.fetch');
  }
  return g as FetchLike;
}

async function readJson(res: { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }, provider: string): Promise<Record<string, unknown>> {
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    throw new Error(`${provider} API error ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

/** OpenAI Chat Completions + Embeddings adapter. */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetch: FetchLike;

  constructor(options: BaseOptions = {}) {
    this.apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.defaultModel = options.defaultModel ?? 'gpt-4o-mini';
    this.fetch = resolveFetch(options.fetch);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.toolCalls
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) }
          : {}),
      })),
    };
    if (request.temperature !== undefined) body['temperature'] = request.temperature;
    if (request.maxTokens !== undefined) body['max_tokens'] = request.maxTokens;
    if (request.tools?.length) {
      body['tools'] = request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }

    const json = await readJson(
      await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
      }),
      this.name,
    );

    const choice = (json['choices'] as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
    const msg = (choice['message'] as Record<string, unknown> | undefined) ?? {};
    const rawToolCalls = msg['tool_calls'] as Array<Record<string, unknown>> | undefined;
    const toolCalls: ToolCall[] | undefined = rawToolCalls?.map((c) => {
      const fn = (c['function'] as Record<string, unknown>) ?? {};
      return { id: String(c['id']), name: String(fn['name']), arguments: safeParse(String(fn['arguments'] ?? '{}')) };
    });
    const finish = String(choice['finish_reason'] ?? 'stop');
    const usage = json['usage'] as Record<string, number> | undefined;

    const message: ChatMessage = { role: 'assistant', content: String(msg['content'] ?? '') };
    if (toolCalls?.length) message.toolCalls = toolCalls;
    return {
      message,
      finishReason: toolCalls?.length ? 'tool_calls' : finish === 'length' ? 'length' : 'stop',
      ...(usage ? { usage: { promptTokens: usage['prompt_tokens'] ?? 0, completionTokens: usage['completion_tokens'] ?? 0 } } : {}),
    };
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const json = await readJson(
      await this.fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: request.model ?? 'text-embedding-3-small', input: request.input }),
      }),
      this.name,
    );
    const data = (json['data'] as Array<Record<string, unknown>>).map((d) => d['embedding'] as number[]);
    const usage = json['usage'] as Record<string, number> | undefined;
    return { embeddings: data, ...(usage ? { usage: { promptTokens: usage['prompt_tokens'] ?? 0, completionTokens: 0 } } : {}) };
  }
}

// ── Anthropic ────────────────────────────────────────────────────────────────

/** Anthropic Messages API adapter (chat only; embed throws). */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly version: string;
  private readonly fetch: FetchLike;

  constructor(options: BaseOptions & { version?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
    this.baseUrl = (options.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, '');
    this.defaultModel = options.defaultModel ?? 'claude-3-5-sonnet-latest';
    this.version = options.version ?? '2023-06-01';
    this.fetch = resolveFetch(options.fetch);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Anthropic takes a top-level system string and user/assistant turns.
    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const turns = request.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      max_tokens: request.maxTokens ?? 1024,
      messages: turns,
    };
    if (system) body['system'] = system;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;

    const json = await readJson(
      await this.fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.version,
        },
        body: JSON.stringify(body),
      }),
      this.name,
    );

    const blocks = (json['content'] as Array<Record<string, unknown>> | undefined) ?? [];
    const text = blocks.filter((b) => b['type'] === 'text').map((b) => String(b['text'] ?? '')).join('');
    const stop = String(json['stop_reason'] ?? 'end_turn');
    const usage = json['usage'] as Record<string, number> | undefined;
    return {
      message: { role: 'assistant', content: text },
      finishReason: stop === 'max_tokens' ? 'length' : 'stop',
      ...(usage ? { usage: { promptTokens: usage['input_tokens'] ?? 0, completionTokens: usage['output_tokens'] ?? 0 } } : {}),
    };
  }

  async embed(_request: EmbedRequest): Promise<EmbedResponse> {
    throw new Error('AnthropicProvider: embeddings are not supported; use OpenAiProvider or OllamaProvider for embeddings');
  }
}

// ── Ollama (local) ───────────────────────────────────────────────────────────

/** Ollama local server adapter (chat + embeddings). */
export class OllamaProvider implements AiProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetch: FetchLike;

  constructor(options: Omit<BaseOptions, 'apiKey'> = {}) {
    this.baseUrl = (options.baseUrl ?? process.env['OLLAMA_HOST'] ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.defaultModel = options.defaultModel ?? 'llama3';
    this.fetch = resolveFetch(options.fetch);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const json = await readJson(
      await this.fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: request.model ?? this.defaultModel,
          stream: false,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          options: request.temperature !== undefined ? { temperature: request.temperature } : undefined,
        }),
      }),
      this.name,
    );
    const msg = (json['message'] as Record<string, unknown> | undefined) ?? {};
    return {
      message: { role: 'assistant', content: String(msg['content'] ?? '') },
      finishReason: json['done'] === true ? 'stop' : 'length',
      usage: {
        promptTokens: Number(json['prompt_eval_count'] ?? 0),
        completionTokens: Number(json['eval_count'] ?? 0),
      },
    };
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const embeddings: number[][] = [];
    for (const input of request.input) {
      const json = await readJson(
        await this.fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: request.model ?? this.defaultModel, prompt: input }),
        }),
        this.name,
      );
      embeddings.push(json['embedding'] as number[]);
    }
    return { embeddings };
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
