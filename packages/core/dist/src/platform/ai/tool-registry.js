// src/platform/ai/tool-registry.ts
// Tool registry for LLM function-calling / tool-use workflows.
export class ToolRegistry {
    tools = new Map();
    /**
     * Registers a tool with a name, implementation, and JSON Schema descriptor.
     */
    register(name, fn, schema) {
        this.tools.set(name, { fn, schema });
    }
    /**
     * Executes a registered tool by name with provided arguments.
     * Arguments can be a plain object or an array.
     */
    async execute(name, args) {
        const entry = this.tools.get(name);
        if (!entry) {
            throw new Error(`Tool not registered: ${name}`);
        }
        if (Array.isArray(args)) {
            return entry.fn(...args);
        }
        else if (args !== null && typeof args === 'object') {
            return entry.fn(args);
        }
        else {
            return entry.fn(args);
        }
    }
    /**
     * Returns the list of tool definitions in the format expected by LLM APIs.
     */
    toFunctionList() {
        const result = [];
        for (const [name, entry] of this.tools) {
            result.push({
                name,
                description: entry.schema['description'],
                parameters: entry.schema,
            });
        }
        return result;
    }
    has(name) {
        return this.tools.has(name);
    }
    get size() {
        return this.tools.size;
    }
}
//# sourceMappingURL=tool-registry.js.map