// src/graphql/engine.ts
// Street GraphQL execution engine — no external runtime dependencies.
// Parses a query document, validates against the schema, resolves fields.
'use strict';
/** Minimalist GraphQL query document parser. */
function parseDocument(query) {
    // Strip comments
    const src = query.replace(/#[^\n]*/g, '');
    const ops = [];
    // Two forms:
    //   { field ... }             — shorthand query
    //   query/mutation/subscription Name? { ... }
    const opRe = /\b(query|mutation|subscription)\s*(\w*)?\s*(?:\([^)]*\))?\s*(\{)/gi;
    const matched = [];
    let m;
    while ((m = opRe.exec(src)) !== null) {
        matched.push({ op: m[1].toLowerCase(), name: m[2] ?? '', start: m.index + m[0].length - 1 });
    }
    // Check for shorthand query: starts with `{`
    const shorthandRe = /^\s*\{/;
    if (matched.length === 0 && shorthandRe.test(src)) {
        const start = src.indexOf('{');
        const body = extractBlock(src, start);
        const fields = parseSelectionSet(body);
        ops.push({ operation: 'query', selectionSet: { fields } });
        return ops;
    }
    for (const { op, name, start } of matched) {
        const body = extractBlock(src, start);
        const fields = parseSelectionSet(body);
        ops.push({ operation: op, name: name || undefined, selectionSet: { fields } });
    }
    return ops;
}
/** Extract the contents of a `{...}` block starting at `pos` (inclusive of the `{`). */
function extractBlock(src, pos) {
    let depth = 0;
    let start = -1;
    for (let i = pos; i < src.length; i++) {
        if (src[i] === '{') {
            if (depth === 0)
                start = i + 1;
            depth++;
        }
        else if (src[i] === '}') {
            depth--;
            if (depth === 0)
                return src.slice(start, i);
        }
    }
    return '';
}
/** Parse a selection set body into FieldNodes. */
function parseSelectionSet(body) {
    const fields = [];
    let i = 0;
    while (i < body.length) {
        // Skip whitespace
        while (i < body.length && /\s/.test(body[i]))
            i++;
        if (i >= body.length)
            break;
        // Try to read an identifier (alias or field name)
        const identMatch = /^([a-zA-Z_][\w]*)/.exec(body.slice(i));
        if (!identMatch) {
            i++;
            continue;
        }
        let name = identMatch[1];
        let alias;
        i += name.length;
        // Skip whitespace
        while (i < body.length && body[i] === ' ')
            i++;
        // Check for alias
        if (body[i] === ':') {
            alias = name;
            i++; // skip ':'
            while (i < body.length && /\s/.test(body[i]))
                i++;
            const nm = /^([a-zA-Z_][\w]*)/.exec(body.slice(i));
            if (nm) {
                name = nm[1];
                i += name.length;
            }
        }
        // Skip whitespace
        while (i < body.length && /\s/.test(body[i]))
            i++;
        // Parse args
        const args = {};
        if (body[i] === '(') {
            const closeIdx = body.indexOf(')', i);
            if (closeIdx !== -1) {
                const argsStr = body.slice(i + 1, closeIdx);
                i = closeIdx + 1;
                // Parse key: value pairs
                const argRe = /(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null|\$?\w+)/g;
                let am;
                while ((am = argRe.exec(argsStr)) !== null) {
                    args[am[1]] = parseArgValue(am[2]);
                }
            }
        }
        // Skip whitespace
        while (i < body.length && /\s/.test(body[i]))
            i++;
        // Parse nested selection set
        let selectionSet;
        if (body[i] === '{') {
            const inner = extractBlock(body, i);
            // Advance past the block
            let depth = 0;
            for (; i < body.length; i++) {
                if (body[i] === '{')
                    depth++;
                else if (body[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        i++;
                        break;
                    }
                }
            }
            selectionSet = { fields: parseSelectionSet(inner) };
        }
        fields.push({ name, alias, args, selectionSet });
    }
    return fields;
}
function parseArgValue(raw) {
    if (raw === 'true')
        return true;
    if (raw === 'false')
        return false;
    if (raw === 'null')
        return null;
    if (raw.startsWith('"'))
        return raw.slice(1, -1).replace(/\\"/g, '"');
    const n = Number(raw);
    if (!isNaN(n))
        return n;
    return raw;
}
// ─── Depth / Complexity ───────────────────────────────────────────────────────
function getDepth(ss) {
    let max = 0;
    for (const f of ss.fields) {
        if (f.selectionSet) {
            const d = 1 + getDepth(f.selectionSet);
            if (d > max)
                max = d;
        }
    }
    return max;
}
function getComplexity(ss) {
    let count = 0;
    for (const f of ss.fields) {
        count++;
        if (f.selectionSet)
            count += getComplexity(f.selectionSet);
    }
    return count;
}
// ─── Introspection Guard ──────────────────────────────────────────────────────
const INTROSPECTION_FIELDS = new Set(['__schema', '__type', '__typename']);
function usesIntrospection(ss) {
    for (const f of ss.fields) {
        if (INTROSPECTION_FIELDS.has(f.name))
            return true;
        if (f.selectionSet && usesIntrospection(f.selectionSet))
            return true;
    }
    return false;
}
// ─── Resolver Execution ───────────────────────────────────────────────────────
async function executeSelectionSet(ss, typeName, parent, resolvers, ctx, schema) {
    const result = {};
    for (const field of ss.fields) {
        const key = field.alias ?? field.name;
        // __typename special field
        if (field.name === '__typename') {
            result[key] = typeName;
            continue;
        }
        const typeResolvers = resolvers[typeName];
        const resolver = typeResolvers?.[field.name];
        let value;
        if (resolver) {
            value = await Promise.resolve(resolver(parent, field.args, ctx));
        }
        else if (parent !== null && parent !== undefined && typeof parent === 'object') {
            value = parent[field.name];
        }
        else {
            value = null;
        }
        // Recurse into nested selections
        if (field.selectionSet && value !== null && value !== undefined) {
            // Determine the return type for the nested object
            const schemaType = schema.types.find((t) => t.name === typeName);
            const fieldDef = schemaType?.fields.find((f) => f.name === field.name);
            const nestedTypeName = fieldDef ? stripModifiers(fieldDef.type) : 'Unknown';
            if (Array.isArray(value)) {
                value = await Promise.all(value.map((item) => executeSelectionSet(field.selectionSet, nestedTypeName, item, resolvers, ctx, schema)));
            }
            else {
                value = await executeSelectionSet(field.selectionSet, nestedTypeName, value, resolvers, ctx, schema);
            }
        }
        result[key] = value ?? null;
    }
    return result;
}
/** Strip non-null `!` and list `[]` modifiers from a type name. */
function stripModifiers(type) {
    return type.replace(/[\[\]!]/g, '');
}
// ─── GraphQlEngine ────────────────────────────────────────────────────────────
export class GraphQlEngine {
    opts;
    constructor(opts) {
        this.opts = {
            maxDepth: 10,
            maxComplexity: 1000,
            introspection: true,
            ...opts,
        };
    }
    async execute(query, variables, ctx) {
        // Substitute variables into query (basic support)
        let queryStr = query;
        if (variables) {
            for (const [key, val] of Object.entries(variables)) {
                queryStr = queryStr.replace(new RegExp(`\\$${key}`, 'g'), JSON.stringify(val));
            }
        }
        let ops;
        try {
            ops = parseDocument(queryStr);
        }
        catch (e) {
            return { errors: [{ message: `Parse error: ${e instanceof Error ? e.message : String(e)}` }] };
        }
        if (ops.length === 0) {
            return { errors: [{ message: 'No operations found in query document' }] };
        }
        const op = ops[0];
        // Subscriptions not supported
        if (op.operation === 'subscription') {
            return { errors: [{ message: 'Subscriptions not supported' }] };
        }
        // Introspection guard
        if (!this.opts.introspection && usesIntrospection(op.selectionSet)) {
            return { errors: [{ message: 'Introspection is disabled' }] };
        }
        // Depth limit
        const depth = getDepth(op.selectionSet);
        if (depth >= this.opts.maxDepth) {
            return { errors: [{ message: `Query depth ${depth} exceeds maximum allowed depth ${this.opts.maxDepth}` }] };
        }
        // Complexity limit
        const complexity = getComplexity(op.selectionSet);
        if (complexity > this.opts.maxComplexity) {
            return { errors: [{ message: `Query complexity ${complexity} exceeds maximum allowed complexity ${this.opts.maxComplexity}` }] };
        }
        // Determine root type name
        const { schema, resolvers } = this.opts;
        let rootTypeName;
        if (op.operation === 'mutation') {
            rootTypeName = schema.mutationType ?? 'Mutation';
        }
        else {
            rootTypeName = schema.queryType ?? 'Query';
        }
        try {
            const data = await executeSelectionSet(op.selectionSet, rootTypeName, null, resolvers, ctx, schema);
            return { data };
        }
        catch (e) {
            return { errors: [{ message: e instanceof Error ? e.message : String(e) }] };
        }
    }
}
// ─── Middleware Factory ───────────────────────────────────────────────────────
/**
 * Create a Street middleware that handles POST requests as GraphQL operations.
 * Reads body (already parsed by streetApp), calls engine.execute(), returns JSON.
 */
export function graphqlMiddleware(engine) {
    return async (ctx, next) => {
        if (ctx.method !== 'POST') {
            await next();
            return;
        }
        const body = ctx['body'];
        if (!body || typeof body !== 'object' || typeof body['query'] !== 'string') {
            ctx.json({ errors: [{ message: 'Expected JSON body with "query" field' }] }, 400);
            return;
        }
        const result = await engine.execute(body['query'], body['variables'], ctx);
        const statusCode = result.errors ? 400 : 200;
        ctx.json(result, statusCode);
    };
}
//# sourceMappingURL=engine.js.map