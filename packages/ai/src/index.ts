// packages/ai/src/index.ts
// Official Street Framework AI module: @streetjs/ai.
//
// A provider-agnostic surface for LLM chat, embeddings, retrieval-augmented
// generation (RAG), and tool calling.
//
//   * AiProvider          — the common contract (chat + embed).
//   * FakeAiProvider      — deterministic, dependency-free; default for tests,
//                            examples, and offline development. Its embeddings
//                            are hashed bag-of-words vectors, so lexical overlap
//                            yields higher cosine similarity (RAG is meaningful
//                            and reproducible without network access).
//   * OpenAiProvider / AnthropicProvider / OllamaProvider — real HTTP adapters
//                            with an injectable `fetch`, so request shaping and
//                            response parsing are unit-testable without network.
//   * VectorStore / InMemoryVectorStore + cosineSimilarity — vector search.
//   * RagPipeline         — embed → store → retrieve → answer.
//   * ChatSession         — a tool-calling loop (model requests tools, we run
//                            registered handlers, feed results back, repeat).

// ── Core types ──────────────────────────────────────────────────────────────

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** A request from the model to invoke a tool. */
export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments object the tool was called with. */
  arguments: Record<string, unknown>;
}

/** A chat message. `toolCalls` is set on assistant turns that request tools; */
/** `toolCallId` links a `tool` message back to the call it answers. */
export interface ChatMessage {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

/** A callable tool exposed to the model. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON-schema-ish parameter description (passed through to the provider). */
  parameters: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  message: ChatMessage;
  finishReason: 'stop' | 'tool_calls' | 'length';
  usage?: TokenUsage;
}

export interface EmbedRequest {
  input: string[];
  model?: string;
}

export interface EmbedResponse {
  /** One embedding vector per input, in order. */
  embeddings: number[][];
  usage?: TokenUsage;
}

/** The common provider contract. */
export interface AiProvider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  embed(request: EmbedRequest): Promise<EmbedResponse>;
}

// ── Vector math ───────────────────────────────────────────────────────────────

/** Cosine similarity of two equal-length vectors. Returns 0 for zero vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Deterministic fake provider ─────────────────────────────────────────────────

const FAKE_DIM = 64;

/** Lowercase alphanumeric tokens. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Stable 32-bit FNV-1a hash. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic hashed bag-of-words embedding: lexical overlap → higher cosine
 * similarity. Not semantic, but reproducible and good enough to exercise RAG.
 */
export function hashEmbedding(text: string, dim = FAKE_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const tok of tokenize(text)) {
    v[fnv1a(tok) % dim]! += 1;
  }
  return v;
}

export interface FakeAiProviderOptions {
  /**
   * Optional scripted chat behaviour. Given the request, return the assistant
   * message and finish reason. Defaults to echoing a summary of the last user
   * message. Use this to script tool-calls in tests.
   */
  chatScript?: (request: ChatRequest) => ChatResponse;
  /** Embedding dimensionality. Default 64. */
  dim?: number;
}

/** Deterministic, network-free provider for tests, examples, and offline dev. */
export class FakeAiProvider implements AiProvider {
  readonly name = 'fake';
  private readonly dim: number;
  private readonly chatScript: ((request: ChatRequest) => ChatResponse) | undefined;

  constructor(options: FakeAiProviderOptions = {}) {
    this.dim = options.dim ?? FAKE_DIM;
    this.chatScript = options.chatScript;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (this.chatScript) return this.chatScript(request);
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const content = lastUser ? `echo: ${lastUser.content}` : 'echo: (no user message)';
    return {
      message: { role: 'assistant', content },
      finishReason: 'stop',
      usage: { promptTokens: countTokens(request.messages), completionTokens: tokenize(content).length },
    };
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    return {
      embeddings: request.input.map((t) => hashEmbedding(t, this.dim)),
      usage: { promptTokens: request.input.reduce((n, t) => n + tokenize(t).length, 0), completionTokens: 0 },
    };
  }
}

function countTokens(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + tokenize(m.content).length, 0);
}

// ── Vector store + RAG ──────────────────────────────────────────────────────────

export interface VectorRecord {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface ScoredRecord {
  record: VectorRecord;
  score: number;
}

/** Pluggable vector store. */
export interface VectorStore {
  upsert(record: VectorRecord): Promise<void>;
  remove(id: string): Promise<boolean>;
  /** Top-`k` records by cosine similarity to `embedding`, score-desc. */
  query(embedding: number[], k: number): Promise<ScoredRecord[]>;
  size(): Promise<number>;
}

/** In-process vector store using exact cosine similarity. */
export class InMemoryVectorStore implements VectorStore {
  private readonly records = new Map<string, VectorRecord>();

  async upsert(record: VectorRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async remove(id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async query(embedding: number[], k: number): Promise<ScoredRecord[]> {
    const scored: ScoredRecord[] = [];
    for (const record of this.records.values()) {
      scored.push({ record, score: cosineSimilarity(embedding, record.embedding) });
    }
    scored.sort((a, b) => b.score - a.score || (a.record.id < b.record.id ? -1 : 1));
    return scored.slice(0, Math.max(0, k));
  }

  async size(): Promise<number> {
    return this.records.size;
  }
}

/** A document to index into a {@link RagPipeline}. */
export interface RagDocument {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface RagAnswer {
  answer: string;
  /** The records used as context, most relevant first. */
  context: ScoredRecord[];
  usage?: TokenUsage;
}

export interface RagPipelineOptions {
  provider: AiProvider;
  store?: VectorStore;
  /** Records to retrieve per query. Default 4. */
  topK?: number;
  /** Embedding model passed to the provider. */
  embedModel?: string;
  /** Chat model passed to the provider. */
  chatModel?: string;
}

/** Retrieval-augmented generation: embed → store → retrieve → answer. */
export class RagPipeline {
  private readonly provider: AiProvider;
  private readonly store: VectorStore;
  private readonly topK: number;
  private readonly embedModel: string | undefined;
  private readonly chatModel: string | undefined;

  constructor(options: RagPipelineOptions) {
    if (!options?.provider) throw new Error('RagPipeline: a provider is required');
    this.provider = options.provider;
    this.store = options.store ?? new InMemoryVectorStore();
    this.topK = options.topK ?? 4;
    this.embedModel = options.embedModel;
    this.chatModel = options.chatModel;
  }

  /** Embed and store documents for later retrieval. */
  async index(docs: RagDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const { embeddings } = await this.provider.embed({ input: docs.map((d) => d.text), model: this.embedModel });
    await Promise.all(
      docs.map((d, i) =>
        this.store.upsert({ id: d.id, text: d.text, embedding: embeddings[i]!, metadata: d.metadata }),
      ),
    );
  }

  /** Retrieve the most relevant records for `query`. */
  async retrieve(query: string, k = this.topK): Promise<ScoredRecord[]> {
    const { embeddings } = await this.provider.embed({ input: [query], model: this.embedModel });
    return this.store.query(embeddings[0]!, k);
  }

  /**
   * Answer `query` grounded in retrieved context. Builds a system prompt from
   * the top-`k` records and asks the chat model. With {@link FakeAiProvider}
   * this is deterministic.
   */
  async answer(query: string, k = this.topK): Promise<RagAnswer> {
    const context = await this.retrieve(query, k);
    const contextBlock = context.map((c, i) => `[${i + 1}] ${c.record.text}`).join('\n');
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Answer the question using only the provided context. ' +
          'If the context is insufficient, say so.\n\nContext:\n' + contextBlock,
      },
      { role: 'user', content: query },
    ];
    const res = await this.provider.chat({ messages, model: this.chatModel });
    return { answer: res.message.content, context, usage: res.usage };
  }
}

// ── Tool-calling session ────────────────────────────────────────────────────────

/** A tool the model may call, paired with its executor. */
export interface RegisteredTool extends ToolDefinition {
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface ChatSessionOptions {
  provider: AiProvider;
  tools?: RegisteredTool[];
  system?: string;
  model?: string;
  /** Max provider round-trips before giving up on a tool loop. Default 5. */
  maxIterations?: number;
}

export interface SendResult {
  message: ChatMessage;
  /** Number of tool calls executed while producing this answer. */
  toolCallsExecuted: number;
}

/**
 * A stateful chat session that drives the tool-calling loop: when the model
 * returns `tool_calls`, the session runs the matching handlers, appends the
 * results as `tool` messages, and re-queries until the model produces a final
 * answer (or `maxIterations` is reached).
 */
export class ChatSession {
  private readonly provider: AiProvider;
  private readonly tools: Map<string, RegisteredTool>;
  private readonly toolDefs: ToolDefinition[];
  private readonly model: string | undefined;
  private readonly maxIterations: number;
  readonly messages: ChatMessage[] = [];

  constructor(options: ChatSessionOptions) {
    if (!options?.provider) throw new Error('ChatSession: a provider is required');
    this.provider = options.provider;
    this.tools = new Map((options.tools ?? []).map((t) => [t.name, t]));
    this.toolDefs = (options.tools ?? []).map(({ name, description, parameters }) => ({ name, description, parameters }));
    this.model = options.model;
    this.maxIterations = options.maxIterations ?? 5;
    if (options.system) this.messages.push({ role: 'system', content: options.system });
  }

  /** Send a user message and resolve to the final assistant message. */
  async send(userMessage: string): Promise<SendResult> {
    this.messages.push({ role: 'user', content: userMessage });
    let toolCallsExecuted = 0;

    for (let i = 0; i < this.maxIterations; i++) {
      const res = await this.provider.chat({
        messages: this.messages,
        tools: this.toolDefs.length > 0 ? this.toolDefs : undefined,
        model: this.model,
      });
      this.messages.push(res.message);

      if (res.finishReason !== 'tool_calls' || !res.message.toolCalls?.length) {
        return { message: res.message, toolCallsExecuted };
      }

      // Execute each requested tool and append its result.
      for (const call of res.message.toolCalls) {
        toolCallsExecuted++;
        const tool = this.tools.get(call.name);
        let content: string;
        try {
          if (!tool) throw new Error(`unknown tool "${call.name}"`);
          const result = await tool.handler(call.arguments);
          content = typeof result === 'string' ? result : JSON.stringify(result);
        } catch (err) {
          content = JSON.stringify({ error: (err as Error).message });
        }
        this.messages.push({ role: 'tool', content, toolCallId: call.id });
      }
    }

    // Loop budget exhausted: return the last assistant message we have.
    const lastAssistant = [...this.messages].reverse().find((m) => m.role === 'assistant');
    return {
      message: lastAssistant ?? { role: 'assistant', content: '' },
      toolCallsExecuted,
    };
  }
}

export * from './providers.js';
