/** Kind discriminator for a top-level type definition. */
export type TypeDefKind = 'type' | 'input' | 'enum' | 'scalar' | 'interface' | 'union';
/**
 * Structured reference to a type, modelling the non-null (`!`) and list (`[]`)
 * wrappers as a nested tree. For example `[User!]!` parses to:
 *   { kind: 'nonNull', ofType: { kind: 'list', ofType:
 *     { kind: 'nonNull', ofType: { kind: 'named', name: 'User' } } } }
 */
export interface TypeRef {
    kind: 'named' | 'list' | 'nonNull';
    /** Present only when `kind === 'named'`. */
    name?: string;
    /** Present only when `kind === 'list' | 'nonNull'`. */
    ofType?: TypeRef;
}
/** A single name/value pair supplied to a directive at a usage site. */
export interface DirectiveArg {
    name: string;
    value: unknown;
}
/** A directive applied to a definition, field, argument, or enum value. */
export interface DirectiveNode {
    name: string;
    args: DirectiveArg[];
}
/** A field argument definition: `name: Type = default @directive`. */
export interface ArgDef {
    name: string;
    /** Canonical SDL string form of the type, e.g. `ID!`. Kept for convenience. */
    type: string;
    /** Structured type reference including non-null/list wrappers. */
    typeRef: TypeRef;
    /** Parsed default value, if a `= value` clause is present. */
    defaultValue?: unknown;
    directives?: DirectiveNode[];
    description?: string;
}
/** A field definition on an object/interface/input type. */
export interface FieldDef {
    name: string;
    /** Canonical SDL string form of the return type, e.g. `[User!]!`. */
    type: string;
    /** Structured type reference including non-null/list wrappers. */
    typeRef: TypeRef;
    /** Field arguments, if any. `undefined` when the field takes no arguments. */
    args?: ArgDef[];
    directives?: DirectiveNode[];
    description?: string;
}
/** A single enum value definition: `VALUE @directive`. */
export interface EnumValueDef {
    name: string;
    directives?: DirectiveNode[];
    description?: string;
}
/** A top-level type definition. */
export interface TypeDef {
    name: string;
    kind: TypeDefKind;
    /** Fields for object/interface/input types; empty for scalar/enum/union. */
    fields: FieldDef[];
    /** Interface names listed in an `implements A & B` clause. */
    interfaces?: string[];
    /** Member type names of a union: `union U = A | B`. */
    unionMembers?: string[];
    /** Values of an enum type. */
    enumValues?: EnumValueDef[];
    directives?: DirectiveNode[];
    description?: string;
}
/** A directive *definition*: `directive @name(args) on LOCATIONS`. */
export interface DirectiveDef {
    name: string;
    args: ArgDef[];
    locations: string[];
    repeatable: boolean;
    description?: string;
}
/** The complete parsed schema AST. */
export interface ServiceDefinition {
    types: TypeDef[];
    queryType?: string;
    mutationType?: string;
    subscriptionType?: string;
    /** Directive definitions declared in the SDL. */
    directiveDefs: DirectiveDef[];
}
/** Convenience alias: the schema AST produced by {@link parseSchema}. */
export type SchemaAst = ServiceDefinition;
/** Error thrown when the SDL is syntactically invalid. */
export declare class SchemaParseError extends Error {
    readonly line: number;
    readonly column: number;
    constructor(message: string, line: number, column: number);
}
/** Render a {@link TypeRef} back into canonical SDL string form. */
export declare function typeRefToString(ref: TypeRef): string;
/** Strip non-null `!` and list `[]` wrappers, returning the named type. */
export declare function namedType(ref: TypeRef): string;
/**
 * Parse a GraphQL SDL string into a {@link ServiceDefinition} AST.
 *
 * @throws {SchemaParseError} when the SDL is syntactically invalid.
 */
export declare function parseSchema(sdl: string): ServiceDefinition;
//# sourceMappingURL=schema.d.ts.map