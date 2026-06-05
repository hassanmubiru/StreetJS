export interface ArgDef {
    name: string;
    type: string;
}
export interface FieldDef {
    name: string;
    type: string;
    args?: ArgDef[];
}
export interface TypeDef {
    name: string;
    fields: FieldDef[];
    kind: 'type' | 'input' | 'enum' | 'scalar';
}
export interface ServiceDefinition {
    types: TypeDef[];
    queryType?: string;
    mutationType?: string;
    subscriptionType?: string;
}
/**
 * Very lightweight SDL parser. Handles:
 *   - type / input / enum / scalar definitions
 *   - Fields with zero or more arguments: `field(arg: Type): ReturnType`
 *   - Schema block: `schema { query: Query ... }`
 *   - Block and inline comments (`#`)
 */
export declare function parseSchema(sdl: string): ServiceDefinition;
//# sourceMappingURL=schema.d.ts.map