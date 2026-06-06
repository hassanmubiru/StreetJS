// src/graphql/engine.ts
// Street GraphQL execution engine — no external runtime dependencies.
// Parses a query document, validates against the schema, resolves fields.

'use strict';

import type { MiddlewareFn } from '../core/types.js';
import type { StreetContext } from '../core/context.js';
import type { ServiceDefinition, FieldDef } from './schema.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { ServiceDefinition };

export interface GraphQlEngineOptions {
  schema: ServiceDefinition;
  resolvers: Record<string, Record<string, (parent: unknown, args: unknown, ctx: unknown) => unknown>>;
  maxDepth?: number;
  maxComplexity?: number;
  introspection?: boolean;
}

export interface ExecutionResult {
  data?: unknown;
  errors?: Array<{ message: string }>;
}

/**
 * A subscription source: any async iterable (e.g. produced by an async
 * generator resolver) or a synchronous iterable of source events. A
 * subscription field resolver returns one of these from the resolver map.
 */
export type SubscriptionSource =
  | AsyncIterable<unknown>
  | AsyncIterator<unknown>
  | Iterable<unknown>;

// ─── Tiny Query Parser ────────────────────────────────────────────────────────

interface SelectionSet {
  fields: FieldNode[];
}

interface FieldNode {
  name: string;
  alias?: string;
  args: Record<string, unknown>;
  selectionSet?: SelectionSet;
}

interface OperationDef {
  operation: 'query' | 'mutation' | 'subscription';
  name?: string;
  selectionSet: SelectionSet;
}

/** Minimalist GraphQL query document parser. */
function parseDocument(query: string): OperationDef[] {
  // Strip comments
  const src = query.replace(/#[^\n]*/g, '');
  const ops: OperationDef[] = [];

  // Two forms:
  //   { field ... }             — shorthand query
  //   query/mutation/subscription Name? { ... }
  const opRe = /\b(query|mutation|subscription)\s*(\w*)?\s*(?:\([^)]*\))?\s*(\{)/gi;
  const matched: Array<{ op: string; name: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = opRe.exec(src)) !== null) {
    matched.push({ op: m[1]!.toLowerCase(), name: m[2] ?? '', start: m.index + m[0].length - 1 });
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
    ops.push({ operation: op as 'query' | 'mutation' | 'subscription', name: name || undefined, selectionSet: { fields } });
  }

  return ops;
}

/** Extract the contents of a `{...}` block starting at `pos` (inclusive of the `{`). */
function extractBlock(src: string, pos: number): string {
  let depth = 0;
  let start = -1;
  for (let i = pos; i < src.length; i++) {
    if (src[i] === '{') { if (depth === 0) start = i + 1; depth++; }
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i);
    }
  }
  return '';
}

/** Parse a selection set body into FieldNodes. */
function parseSelectionSet(body: string): FieldNode[] {
  const fields: FieldNode[] = [];
  let i = 0;

  while (i < body.length) {
    // Skip whitespace
    while (i < body.length && /\s/.test(body[i]!)) i++;
    if (i >= body.length) break;

    // Try to read an identifier (alias or field name)
    const identMatch = /^([a-zA-Z_][\w]*)/.exec(body.slice(i));
    if (!identMatch) { i++; continue; }

    let name = identMatch[1]!;
    let alias: string | undefined;
    i += name.length;

    // Skip whitespace
    while (i < body.length && body[i] === ' ') i++;

    // Check for alias
    if (body[i] === ':') {
      alias = name;
      i++; // skip ':'
      while (i < body.length && /\s/.test(body[i]!)) i++;
      const nm = /^([a-zA-Z_][\w]*)/.exec(body.slice(i));
      if (nm) { name = nm[1]!; i += name.length; }
    }

    // Skip whitespace
    while (i < body.length && /\s/.test(body[i]!)) i++;

    // Parse args
    const args: Record<string, unknown> = {};
    if (body[i] === '(') {
      const closeIdx = body.indexOf(')', i);
      if (closeIdx !== -1) {
        const argsStr = body.slice(i + 1, closeIdx);
        i = closeIdx + 1;
        // Parse key: value pairs
        const argRe = /(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null|\$?\w+)/g;
        let am: RegExpExecArray | null;
        while ((am = argRe.exec(argsStr)) !== null) {
          args[am[1]!] = parseArgValue(am[2]!);
        }
      }
    }

    // Skip whitespace
    while (i < body.length && /\s/.test(body[i]!)) i++;

    // Parse nested selection set
    let selectionSet: SelectionSet | undefined;
    if (body[i] === '{') {
      const inner = extractBlock(body, i);
      // Advance past the block
      let depth = 0;
      for (; i < body.length; i++) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}') { depth--; if (depth === 0) { i++; break; } }
      }
      selectionSet = { fields: parseSelectionSet(inner) };
    }

    fields.push({ name, alias, args, selectionSet });
  }

  return fields;
}

function parseArgValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw.startsWith('"')) return raw.slice(1, -1).replace(/\\"/g, '"');
  const n = Number(raw);
  if (!isNaN(n)) return n;
  return raw;
}

// ─── Depth / Complexity ───────────────────────────────────────────────────────

/**
 * Recursively compute the maximum nesting depth of a selection set.
 * The root selection set counts as depth 1; each nested selection set adds 1.
 * Example: `{ a }` → 1, `{ a { b } }` → 2, `{ a { b { c } } }` → 3.
 */
function getDepth(ss: SelectionSet): number {
  let max = 0;
  for (const f of ss.fields) {
    if (f.selectionSet) {
      const d = getDepth(f.selectionSet);
      if (d > max) max = d;
    }
  }
  return max + 1;
}

function getComplexity(ss: SelectionSet): number {
  let count = 0;
  for (const f of ss.fields) {
    count++;
    if (f.selectionSet) count += getComplexity(f.selectionSet);
  }
  return count;
}

// ─── Introspection Guard ──────────────────────────────────────────────────────

const INTROSPECTION_FIELDS = new Set(['__schema', '__type', '__typename']);

function usesIntrospection(ss: SelectionSet): boolean {
  for (const f of ss.fields) {
    if (INTROSPECTION_FIELDS.has(f.name)) return true;
    if (f.selectionSet && usesIntrospection(f.selectionSet)) return true;
  }
  return false;
}

// ─── Resolver Execution ───────────────────────────────────────────────────────

async function executeSelectionSet(
  ss: SelectionSet,
  typeName: string,
  parent: unknown,
  resolvers: Record<string, Record<string, (p: unknown, a: unknown, c: unknown) => unknown>>,
  ctx: unknown,
  schema: ServiceDefinition,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  for (const field of ss.fields) {
    const key = field.alias ?? field.name;

    // __typename special field
    if (field.name === '__typename') {
      result[key] = typeName;
      continue;
    }

    const typeResolvers = resolvers[typeName];
    const resolver = typeResolvers?.[field.name];

    let value: unknown;
    if (resolver) {
      value = await Promise.resolve(resolver(parent, field.args, ctx));
    } else if (parent !== null && parent !== undefined && typeof parent === 'object') {
      value = (parent as Record<string, unknown>)[field.name];
    } else {
      value = null;
    }

    // Recurse into nested selections
    if (field.selectionSet && value !== null && value !== undefined) {
      // Determine the return type for the nested object
      const schemaType = schema.types.find((t) => t.name === typeName);
      const fieldDef: FieldDef | undefined = schemaType?.fields.find((f) => f.name === field.name);
      const nestedTypeName = fieldDef ? stripModifiers(fieldDef.type) : 'Unknown';

      if (Array.isArray(value)) {
        value = await Promise.all(
          value.map((item) =>
            executeSelectionSet(field.selectionSet!, nestedTypeName, item, resolvers, ctx, schema)
          )
        );
      } else {
        value = await executeSelectionSet(field.selectionSet, nestedTypeName, value, resolvers, ctx, schema);
      }
    }

    result[key] = value ?? null;
  }

  return result;
}

/** Strip non-null `!` and list `[]` modifiers from a type name. */
function stripModifiers(type: string): string {
  return type.replace(/[\[\]!]/g, '');
}

// ─── GraphQlEngine ────────────────────────────────────────────────────────────

export class GraphQlEngine {
  private readonly opts: Required<GraphQlEngineOptions>;

  constructor(opts: GraphQlEngineOptions) {
    this.opts = {
      maxDepth: 10,
      maxComplexity: 1000,
      introspection: true,
      ...opts,
    };
  }

  /**
   * Parse a query document, select the first operation, and run the shared
   * introspection/depth/complexity guards. Returns either the prepared
   * operation or a fully-formed error result.
   */
  private prepare(
    query: string,
    variables?: Record<string, unknown>,
  ): { op: OperationDef } | { error: ExecutionResult } {
    // Substitute variables into query (basic support)
    let queryStr = query;
    if (variables) {
      for (const [key, val] of Object.entries(variables)) {
        queryStr = queryStr.replace(new RegExp(`\\$${key}`, 'g'), JSON.stringify(val));
      }
    }

    let ops: ReturnType<typeof parseDocument>;
    try {
      ops = parseDocument(queryStr);
    } catch (e) {
      return { error: { errors: [{ message: `Parse error: ${e instanceof Error ? e.message : String(e)}` }] } };
    }

    if (ops.length === 0) {
      return { error: { errors: [{ message: 'No operations found in query document' }] } };
    }

    const op = ops[0]!;

    // Introspection guard
    if (!this.opts.introspection && usesIntrospection(op.selectionSet)) {
      return { error: { errors: [{ message: 'Introspection is disabled' }] } };
    }

    // Depth limit — reject queries whose nesting depth exceeds maxDepth.
    const depth = getDepth(op.selectionSet);
    if (depth > this.opts.maxDepth) {
      return { error: { errors: [{ message: `Query depth ${depth} exceeds maximum allowed depth ${this.opts.maxDepth}` }] } };
    }

    // Complexity limit
    const complexity = getComplexity(op.selectionSet);
    if (complexity > this.opts.maxComplexity) {
      return { error: { errors: [{ message: `Query complexity ${complexity} exceeds maximum allowed complexity ${this.opts.maxComplexity}` }] } };
    }

    return { op };
  }

  async execute(
    query: string,
    variables?: Record<string, unknown>,
    ctx?: unknown,
  ): Promise<ExecutionResult> {
    const prepared = this.prepare(query, variables);
    if ('error' in prepared) return prepared.error;
    const { op } = prepared;

    // Subscriptions are streamed via executeSubscription(), not execute().
    if (op.operation === 'subscription') {
      return { errors: [{ message: 'Subscriptions not supported' }] };
    }

    // Determine root type name
    const { schema, resolvers } = this.opts;
    const rootTypeName =
      op.operation === 'mutation' ? schema.mutationType ?? 'Mutation' : schema.queryType ?? 'Query';

    try {
      const data = await executeSelectionSet(
        op.selectionSet,
        rootTypeName,
        null,
        resolvers,
        ctx,
        schema,
      );
      return { data };
    } catch (e) {
      return { errors: [{ message: e instanceof Error ? e.message : String(e) }] };
    }
  }

  /**
   * Execute a GraphQL subscription operation, returning an async iterator of
   * {@link ExecutionResult} — one per source event produced by the
   * subscription field's resolver.
   *
   * The subscription field resolver in the resolver map must return a
   * {@link SubscriptionSource} (an async iterable/iterator, e.g. an async
   * generator, or a sync iterable). Each source event is mapped through the
   * remaining selection set: if the field has a sub-selection, the event is
   * resolved as the parent object of that selection; otherwise the raw event
   * value is used. Errors during preparation or per-event resolution are
   * yielded as `{ errors: [...] }` results.
   */
  async *executeSubscription(
    query: string,
    variables?: Record<string, unknown>,
    ctx?: unknown,
  ): AsyncGenerator<ExecutionResult, void, unknown> {
    const prepared = this.prepare(query, variables);
    if ('error' in prepared) {
      yield prepared.error;
      return;
    }
    const { op } = prepared;

    if (op.operation !== 'subscription') {
      yield { errors: [{ message: 'executeSubscription requires a subscription operation' }] };
      return;
    }

    const rootFields = op.selectionSet.fields;
    if (rootFields.length !== 1) {
      yield { errors: [{ message: 'A subscription operation must have exactly one root field' }] };
      return;
    }

    const { schema, resolvers } = this.opts;
    const rootTypeName = schema.subscriptionType ?? 'Subscription';
    const field = rootFields[0]!;
    const key = field.alias ?? field.name;

    const resolver = resolvers[rootTypeName]?.[field.name];
    if (!resolver) {
      yield { errors: [{ message: `No subscription resolver for field "${field.name}"` }] };
      return;
    }

    // Obtain the source event stream from the subscription resolver.
    let source: SubscriptionSource;
    try {
      source = (await Promise.resolve(resolver(null, field.args, ctx))) as SubscriptionSource;
    } catch (e) {
      yield { errors: [{ message: e instanceof Error ? e.message : String(e) }] };
      return;
    }

    if (source === null || source === undefined || typeof source !== 'object') {
      yield { errors: [{ message: `Subscription resolver for "${field.name}" did not return an async iterable` }] };
      return;
    }

    // Resolve the nested return type name for selection-set events.
    const schemaType = schema.types.find((t) => t.name === rootTypeName);
    const fieldDef: FieldDef | undefined = schemaType?.fields.find((f) => f.name === field.name);
    const nestedTypeName = fieldDef ? stripModifiers(fieldDef.type) : 'Unknown';

    for await (const event of toAsyncIterable(source)) {
      try {
        let value: unknown = event;
        if (field.selectionSet && event !== null && event !== undefined) {
          value = await executeSelectionSet(
            field.selectionSet,
            nestedTypeName,
            event,
            resolvers,
            ctx,
            schema,
          );
        }
        yield { data: { [key]: value ?? null } };
      } catch (e) {
        yield { errors: [{ message: e instanceof Error ? e.message : String(e) }] };
      }
    }
  }
}

/** Normalise any {@link SubscriptionSource} into an async iterable. */
function toAsyncIterable(source: SubscriptionSource): AsyncIterable<unknown> {
  if (typeof (source as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
    return source as AsyncIterable<unknown>;
  }
  if (typeof (source as Iterable<unknown>)[Symbol.iterator] === 'function') {
    const iterable = source as Iterable<unknown>;
    return (async function* () {
      for (const item of iterable) yield item;
    })();
  }
  // Bare iterator object exposing next(): wrap into an async iterable.
  const iterator = source as AsyncIterator<unknown>;
  return (async function* () {
    while (true) {
      const res = await Promise.resolve(iterator.next());
      if (res.done) return;
      yield res.value;
    }
  })();
}

// ─── Middleware Factory ───────────────────────────────────────────────────────

/**
 * Create a Street middleware that handles POST requests as GraphQL operations.
 * Reads body (already parsed by streetApp), calls engine.execute(), returns JSON.
 */
export function graphqlMiddleware(engine: GraphQlEngine): MiddlewareFn {
  return async (ctx: StreetContext, next: () => Promise<void>) => {
    if (ctx.method !== 'POST') {
      await next();
      return;
    }

    const body = (ctx as unknown as Record<string, unknown>)['body'] as
      | { query?: string; variables?: Record<string, unknown> }
      | null
      | undefined;

    if (!body || typeof body !== 'object' || typeof body['query'] !== 'string') {
      ctx.json({ errors: [{ message: 'Expected JSON body with "query" field' }] }, 400);
      return;
    }

    const result = await engine.execute(body['query'], body['variables'], ctx);
    const statusCode = result.errors ? 400 : 200;
    ctx.json(result, statusCode);
  };
}
