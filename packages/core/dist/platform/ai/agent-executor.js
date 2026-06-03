// src/platform/ai/agent-executor.ts
// ReAct (Reason + Act) agent executor with tool use and token-budget management.
const DEFAULT_MAX_STEPS = 10;
const DEFAULT_MAX_TOKENS = 4_096;
const SUMMARIZE_THRESHOLD = 0.8;
/**
 * Rough token estimate: ~1 token per 4 characters.
 */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
function estimateHistoryTokens(messages) {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}
/**
 * Parses tool calls from LLM response text.
 * Supports JSON code blocks with format:
 *   ```json
 *   { "tool": "toolName", "args": { ... } }
 *   ```
 * Also supports plain JSON objects at the start of a line.
 */
function parseToolCall(content) {
    // Try to find ```json blocks
    const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)```/);
    if (jsonBlockMatch?.[1]) {
        try {
            const parsed = JSON.parse(jsonBlockMatch[1].trim());
            const toolName = parsed.tool ?? parsed.function ?? parsed.name;
            if (toolName && typeof toolName === 'string') {
                return { name: toolName, args: parsed.args ?? parsed.arguments ?? parsed.input ?? {} };
            }
        }
        catch {
            // not valid JSON
        }
    }
    // Try to find ACTION: toolName(args) pattern
    const actionMatch = content.match(/ACTION:\s*(\w+)\s*\(([^)]*)\)/);
    if (actionMatch?.[1]) {
        let args = {};
        try {
            args = JSON.parse(actionMatch[2] ?? '{}');
        }
        catch {
            args = actionMatch[2] ?? '';
        }
        return { name: actionMatch[1], args };
    }
    // Try raw JSON object
    const rawJsonMatch = content.match(/\{[\s\S]*"tool"\s*:\s*"([^"]+)"[\s\S]*\}/);
    if (rawJsonMatch) {
        try {
            const parsed = JSON.parse(rawJsonMatch[0]);
            return { name: parsed.tool, args: parsed.args ?? {} };
        }
        catch {
            // not valid JSON
        }
    }
    return null;
}
/**
 * Checks whether the LLM response contains a final answer.
 */
function extractFinalAnswer(content) {
    const finalMatch = content.match(/FINAL[\s_]?ANSWER:\s*([\s\S]+)/i);
    if (finalMatch?.[1])
        return finalMatch[1].trim();
    // If no tool calls detected and not a reasoning step, treat as final
    if (!parseToolCall(content) && !content.includes('THOUGHT:') && !content.includes('ACTION:')) {
        return content.trim();
    }
    return null;
}
export class AgentExecutor {
    client;
    tools;
    maxSteps;
    maxTokens;
    constructor(client, tools, opts = {}) {
        this.client = client;
        this.tools = tools;
        this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
        this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    }
    /**
     * Runs the ReAct loop:
     * 1. Send history to LLM
     * 2. Parse tool calls from response
     * 3. Execute tools via ToolRegistry
     * 4. Append observation
     * 5. Repeat until final answer or maxSteps reached
     */
    async run(userMessage, ctx) {
        const systemPrompt = this._buildSystemPrompt();
        const history = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ];
        for (let step = 0; step < this.maxSteps; step++) {
            // Check if we need to summarize history to stay within token budget
            if (estimateHistoryTokens(history) > this.maxTokens * SUMMARIZE_THRESHOLD) {
                await this._summarizeHistory(history);
            }
            const opts = {
                model: 'gpt-4o',
                messages: history,
                maxTokens: this.maxTokens,
                temperature: 0.7,
            };
            const result = await this.client.complete(opts);
            const content = result.content;
            history.push({ role: 'assistant', content });
            this._emitStep(ctx, 'thought', content);
            // Check for final answer
            const finalAnswer = extractFinalAnswer(content);
            if (finalAnswer !== null) {
                this._emitStep(ctx, 'final', finalAnswer);
                return finalAnswer;
            }
            // Parse and execute tool call
            const toolCall = parseToolCall(content);
            if (toolCall) {
                this._emitStep(ctx, 'action', `${toolCall.name}(${JSON.stringify(toolCall.args)})`);
                let observation;
                try {
                    const toolResult = await this.tools.execute(toolCall.name, toolCall.args);
                    observation = typeof toolResult === 'string'
                        ? toolResult
                        : JSON.stringify(toolResult);
                }
                catch (err) {
                    observation = `Error: ${err instanceof Error ? err.message : String(err)}`;
                }
                this._emitStep(ctx, 'observation', observation);
                history.push({ role: 'user', content: `OBSERVATION: ${observation}` });
            }
            else {
                // No tool call and no final answer marker — treat as final
                this._emitStep(ctx, 'final', content);
                return content;
            }
        }
        // maxSteps reached — return last assistant message
        const last = [...history].reverse().find((m) => m.role === 'assistant');
        return last?.content ?? 'Maximum steps reached without a final answer.';
    }
    _buildSystemPrompt() {
        const toolList = this.tools.toFunctionList();
        const toolDescriptions = toolList
            .map((t) => `- ${t.name}: ${t.description ?? 'No description'}`)
            .join('\n');
        return [
            'You are a helpful AI assistant with access to tools.',
            '',
            'Available tools:',
            toolDescriptions || '(none)',
            '',
            'To use a tool, respond with:',
            '```json',
            '{ "tool": "<tool_name>", "args": <args_object> }',
            '```',
            '',
            'When you have a final answer, respond with:',
            'FINAL ANSWER: <your answer>',
        ].join('\n');
    }
    async _summarizeHistory(history) {
        // Keep system message and last 2 exchanges; summarize the rest
        const systemMsg = history.find((m) => m.role === 'system');
        const recentHistory = history.slice(-4);
        const middleHistory = history.slice(systemMsg ? 1 : 0, -4);
        if (middleHistory.length === 0)
            return;
        const summaryRequest = {
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'Summarize the following conversation history concisely.' },
                { role: 'user', content: middleHistory.map((m) => `${m.role}: ${m.content}`).join('\n') },
            ],
            maxTokens: 512,
        };
        const summary = await this.client.complete(summaryRequest);
        history.length = 0;
        if (systemMsg)
            history.push(systemMsg);
        history.push({ role: 'user', content: `[Previous conversation summary: ${summary.content}]` });
        for (const m of recentHistory)
            history.push(m);
    }
    _emitStep(ctx, type, content) {
        if (!ctx)
            return;
        const ctxObj = ctx;
        if (ctxObj['res'] && typeof ctxObj['res']['write'] === 'function') {
            const res = ctxObj['res'];
            const event = JSON.stringify({ type, content });
            res.write(`data: ${event}\n\n`);
        }
    }
}
//# sourceMappingURL=agent-executor.js.map