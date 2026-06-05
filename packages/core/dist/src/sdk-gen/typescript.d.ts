export interface OpenApiOperation {
    operationId?: string;
    summary?: string;
    parameters?: unknown[];
}
export interface OpenApiSpec {
    paths: Record<string, Record<string, OpenApiOperation>>;
}
/**
 * Generate a TypeScript SDK from an OpenAPI spec and write the output files
 * to `outputDir`.
 *
 * Files written:
 *   - `<outputDir>/types.ts`      — request/response TypeScript interfaces
 *   - `<outputDir>/api-client.ts` — typed fetch-based `ApiClient` class
 */
export declare function generateTypescriptSdk(spec: OpenApiSpec, outputDir: string): Promise<void>;
//# sourceMappingURL=typescript.d.ts.map