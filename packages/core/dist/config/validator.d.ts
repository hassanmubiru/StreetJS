export type FieldType = 'string' | 'number' | 'boolean' | 'url' | 'port';
export interface ConfigFieldDef {
    type: FieldType;
    required?: boolean;
    default?: string | number | boolean;
    min?: number;
    max?: number;
}
export type ConfigSchema = Record<string, ConfigFieldDef>;
export type ConfigResult<S extends ConfigSchema> = {
    [K in keyof S]: string | number | boolean;
};
export declare class ConfigValidationError extends Error {
    readonly errors: string[];
    constructor(errors: string[]);
}
/**
 * Read process.env, validate every field in `schema`, collect ALL errors, and
 * either return a fully-typed config object or throw ConfigValidationError with
 * the complete error list.
 *
 * Rules:
 *  - Absent variable + default  → use default (no error)
 *  - Absent variable, required  → error
 *  - Present variable           → validate against type/constraints regardless
 *                                 of whether a default exists
 */
export declare function defineConfig<S extends ConfigSchema>(schema: S): ConfigResult<S>;
//# sourceMappingURL=validator.d.ts.map