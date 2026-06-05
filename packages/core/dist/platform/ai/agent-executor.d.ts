import type { LlmClient } from './llm-client.js';
import type { ToolRegistry } from './tool-registry.js';
export interface AgentExecutorOptions {
    maxSteps?: number;
    maxTokens?: number;
}
export declare class AgentExecutor {
    private readonly client;
    private readonly tools;
    private readonly maxSteps;
    private readonly maxTokens;
    constructor(client: LlmClient, tools: ToolRegistry, opts?: AgentExecutorOptions);
    /**
     * Runs the ReAct loop:
     * 1. Send history to LLM
     * 2. Parse tool calls from response
     * 3. Execute tools via ToolRegistry
     * 4. Append observation
     * 5. Repeat until final answer or maxSteps reached
     */
    run(userMessage: string, ctx?: unknown): Promise<string>;
    private _buildSystemPrompt;
    private _summarizeHistory;
    private _emitStep;
}
//# sourceMappingURL=agent-executor.d.ts.map