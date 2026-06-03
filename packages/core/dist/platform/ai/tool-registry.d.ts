export interface LlmFunctionDef {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
}
export declare class ToolRegistry {
    private readonly tools;
    /**
     * Registers a tool with a name, implementation, and JSON Schema descriptor.
     */
    register(name: string, fn: (...args: unknown[]) => Promise<unknown>, schema: Record<string, unknown>): void;
    /**
     * Executes a registered tool by name with provided arguments.
     * Arguments can be a plain object or an array.
     */
    execute(name: string, args: unknown): Promise<unknown>;
    /**
     * Returns the list of tool definitions in the format expected by LLM APIs.
     */
    toFunctionList(): LlmFunctionDef[];
    has(name: string): boolean;
    get size(): number;
}
//# sourceMappingURL=tool-registry.d.ts.map