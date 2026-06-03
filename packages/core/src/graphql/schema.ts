// src/graphql/schema.ts
// Minimal SDL (Schema Definition Language) parser for the Street GraphQL engine.
// Parses `type Foo { field(arg: Type): ReturnType }` patterns into a TypeDef AST.

'use strict';

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

// ─── SDL Parser ────────────────────────────────────────────────────────────────

/**
 * Very lightweight SDL parser. Handles:
 *   - type / input / enum / scalar definitions
 *   - Fields with zero or more arguments: `field(arg: Type): ReturnType`
 *   - Schema block: `schema { query: Query ... }`
 *   - Block and inline comments (`#`)
 */
export function parseSchema(sdl: string): ServiceDefinition {
  // Strip comments
  const src = sdl.replace(/#[^\n]*/g, '');

  const types: TypeDef[] = [];
  let queryType: string | undefined;
  let mutationType: string | undefined;
  let subscriptionType: string | undefined;

  // Match schema block first
  const schemaBlockRe = /\bschema\s*\{([^}]*)\}/g;
  let sbm: RegExpExecArray | null;
  while ((sbm = schemaBlockRe.exec(src)) !== null) {
    const body = sbm[1]!;
    const queryMatch = /\bquery\s*:\s*(\w+)/.exec(body);
    const mutMatch  = /\bmutation\s*:\s*(\w+)/.exec(body);
    const subMatch  = /\bsubscription\s*:\s*(\w+)/.exec(body);
    if (queryMatch)  queryType        = queryMatch[1];
    if (mutMatch)    mutationType     = mutMatch[1];
    if (subMatch)    subscriptionType = subMatch[1];
  }

  // Match type/input/enum/scalar blocks
  const blockRe = /\b(type|input|enum|scalar)\s+(\w+)(?:\s+implements\s+[\w&\s]+)?\s*(?:\{([^}]*)\})?/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(src)) !== null) {
    const kindRaw = bm[1] as 'type' | 'input' | 'enum' | 'scalar';
    const name    = bm[2]!;
    const body    = bm[3] ?? '';

    // Skip schema keyword block (handled above)
    if (name === 'schema') continue;

    const fields: FieldDef[] = [];

    if (kindRaw === 'scalar') {
      // Scalars have no fields
      types.push({ name, kind: 'scalar', fields: [] });
      continue;
    }

    if (kindRaw === 'enum') {
      // Enum values become pseudo-fields with an empty type
      const lines = body.split('\n');
      for (const line of lines) {
        const val = line.trim();
        if (val && /^\w+$/.test(val)) {
          fields.push({ name: val, type: '' });
        }
      }
      types.push({ name, kind: 'enum', fields });
      continue;
    }

    // type / input: parse field lines
    // Each field may look like:
    //   fieldName: Type
    //   fieldName(arg1: T1, arg2: T2): Type
    const fieldRe = /(\w+)\s*(?:\(([^)]*)\))?\s*:\s*([\w!\[\]]+)/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(body)) !== null) {
      const fieldName = fm[1]!;
      const argsRaw   = fm[2];
      const returnType = fm[3]!;

      const args: ArgDef[] = [];
      if (argsRaw) {
        // Parse comma-separated arg: Type pairs
        const argRe = /(\w+)\s*:\s*([\w!\[\]]+)/g;
        let am: RegExpExecArray | null;
        while ((am = argRe.exec(argsRaw)) !== null) {
          args.push({ name: am[1]!, type: am[2]! });
        }
      }

      fields.push({ name: fieldName, type: returnType, args: args.length ? args : undefined });
    }

    types.push({ name, kind: kindRaw, fields });
  }

  // Infer query/mutation/subscription type names from root type names if not declared
  if (!queryType) {
    const hasQuery = types.find((t) => t.name === 'Query');
    if (hasQuery) queryType = 'Query';
  }
  if (!mutationType) {
    const hasMutation = types.find((t) => t.name === 'Mutation');
    if (hasMutation) mutationType = 'Mutation';
  }
  if (!subscriptionType) {
    const hasSub = types.find((t) => t.name === 'Subscription');
    if (hasSub) subscriptionType = 'Subscription';
  }

  return { types, queryType, mutationType, subscriptionType };
}
