import type { OpenApiSpec } from './typescript.js';
export type { OpenApiSpec };
/**
 * Generate a Python SDK from an OpenAPI spec and write the output files
 * to `outputDir`.
 *
 * Files written:
 *   - `<outputDir>/models.py`  — dataclass request/response models
 *   - `<outputDir>/client.py`  — urllib.request-based `ApiClient` class
 */
export declare function generatePythonSdk(spec: OpenApiSpec, outputDir: string): Promise<void>;
//# sourceMappingURL=python.d.ts.map