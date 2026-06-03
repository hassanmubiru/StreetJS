// src/platform/ai/tool-registry.ts
// Tool registry for LLM function-calling / tool-use workflows.

export interface LlmFunctionDef {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

interface ToolEntry {
  fn: (...args: unknown[]) => Promise<unknown>;
  schema: Record<string, unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolEntry>();

  /**
   * Registers a tool with a name, implementation, and JSON Schema descriptor.
   */
  register(
    name: string,
    fn: (...args: unknown[]) => Promise<unknown>,
    schema: Record<string, unknown>
  ): void {
    this.tools.set(name, { fn, schema });
  }

  /**
   * Executes a registered tool by name with provided arguments.
   * Arguments can be a plain object or an array.
   */
  async execute(name: string, args: unknown): Promise<unknown> {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new Error(`Tool not registered: ${name}`);
    }

    if (Array.isArray(args)) {
      return entry.fn(...args);
    } else if (args !== null && typeof args === 'object') {
      return entry.fn(args);
    } else {
      return entry.fn(args);
    }
  }

  /**
   * Returns the list of tool definitions in the format expected by LLM APIs.
   */
  toFunctionList(): LlmFunctionDef[] {
    const result: LlmFunctionDef[] = [];
    for (const [name, entry] of this.tools) {
      result.push({
        name,
        description: entry.schema['description'] as string | undefined,
        parameters: entry.schema,
      });
    }
    return result;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get size(): number {
    return this.tools.size;
  }
}
