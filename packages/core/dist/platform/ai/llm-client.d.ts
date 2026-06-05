export interface CompletionOptions {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    maxTokens?: number;
    temperature?: number;
}
export interface CompletionResult {
    content: string;
    tokens?: number;
}
export interface LlmClient {
    complete(opts: CompletionOptions): Promise<CompletionResult>;
    stream(opts: CompletionOptions): AsyncIterableIterator<string>;
}
export declare class OpenAiClient implements LlmClient {
    private readonly apiKey;
    private readonly baseUrl;
    constructor(apiKey: string, baseUrl?: string);
    complete(opts: CompletionOptions): Promise<CompletionResult>;
    stream(opts: CompletionOptions): AsyncIterableIterator<string>;
}
export declare class AnthropicClient implements LlmClient {
    private readonly apiKey;
    private readonly baseUrl;
    constructor(apiKey: string, baseUrl?: string);
    complete(opts: CompletionOptions): Promise<CompletionResult>;
    stream(opts: CompletionOptions): AsyncIterableIterator<string>;
}
export declare class OllamaClient implements LlmClient {
    private readonly baseUrl;
    constructor(baseUrl?: string);
    complete(opts: CompletionOptions): Promise<CompletionResult>;
    stream(opts: CompletionOptions): AsyncIterableIterator<string>;
}
//# sourceMappingURL=llm-client.d.ts.map