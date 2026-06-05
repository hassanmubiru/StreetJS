// src/tests/graphql.test.ts
// Tests for the GraphQL schema parser and execution engine.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchema } from '../graphql/schema.js';
import { GraphQlEngine } from '../graphql/engine.js';
// ─── Schema Parser Tests ──────────────────────────────────────────────────────
describe('parseSchema — basic type parsing', () => {
    it('parses a simple query type with one field', () => {
        const sdl = `
      type Query {
        hello: String
      }
    `;
        const def = parseSchema(sdl);
        assert.equal(def.types.length, 1);
        assert.equal(def.types[0].name, 'Query');
        assert.equal(def.types[0].kind, 'type');
        assert.equal(def.types[0].fields.length, 1);
        assert.equal(def.types[0].fields[0].name, 'hello');
        assert.equal(def.types[0].fields[0].type, 'String');
    });
    it('detects queryType automatically from type name "Query"', () => {
        const sdl = `type Query { hi: String }`;
        const def = parseSchema(sdl);
        assert.equal(def.queryType, 'Query');
    });
    it('parses fields with arguments', () => {
        const sdl = `
      type Query {
        user(id: ID!): User
      }
    `;
        const def = parseSchema(sdl);
        const field = def.types[0].fields[0];
        assert.equal(field.name, 'user');
        assert.ok(field.args);
        assert.equal(field.args.length, 1);
        assert.equal(field.args[0].name, 'id');
        assert.equal(field.args[0].type, 'ID!');
    });
    it('parses multiple types', () => {
        const sdl = `
      type Query { users: [User!]! }
      type User { id: ID name: String }
    `;
        const def = parseSchema(sdl);
        assert.equal(def.types.length, 2);
        const names = def.types.map((t) => t.name);
        assert.ok(names.includes('Query'));
        assert.ok(names.includes('User'));
    });
    it('parses input types', () => {
        const sdl = `input CreateUserInput { name: String! email: String! }`;
        const def = parseSchema(sdl);
        assert.equal(def.types[0].kind, 'input');
    });
    it('parses scalar types', () => {
        const sdl = `scalar DateTime`;
        const def = parseSchema(sdl);
        assert.equal(def.types[0].kind, 'scalar');
        assert.equal(def.types[0].fields.length, 0);
    });
    it('parses schema block for custom operation type names', () => {
        const sdl = `
      schema { query: RootQuery mutation: RootMutation }
      type RootQuery { ping: Boolean }
      type RootMutation { noop: Boolean }
    `;
        const def = parseSchema(sdl);
        assert.equal(def.queryType, 'RootQuery');
        assert.equal(def.mutationType, 'RootMutation');
    });
    it('strips # comments', () => {
        const sdl = `
      # This is a comment
      type Query {
        # another comment
        hello: String
      }
    `;
        const def = parseSchema(sdl);
        assert.equal(def.types[0].fields[0].name, 'hello');
    });
});
// ─── Engine Tests ─────────────────────────────────────────────────────────────
const simpleSchema = parseSchema(`
  type Query {
    hello: String
    greet(name: String): String
    user(id: ID): User
  }
  type User {
    id: ID
    name: String
    email: String
  }
  type Mutation {
    createUser(name: String): User
  }
`);
const simpleResolvers = {
    Query: {
        hello: () => 'world',
        greet: (_p, args) => `Hello, ${args['name'] ?? 'stranger'}!`,
        user: (_p, args) => args['id'] === '1'
            ? { id: '1', name: 'Alice', email: 'alice@example.com' }
            : null,
    },
    Mutation: {
        createUser: (_p, args) => ({
            id: '42',
            name: args['name'] ?? 'Unknown',
            email: '',
        }),
    },
};
describe('GraphQlEngine — basic execution', () => {
    it('executes a simple scalar query', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers });
        const result = await engine.execute('{ hello }');
        assert.deepEqual(result, { data: { hello: 'world' } });
    });
    it('executes a query with arguments', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers });
        const result = await engine.execute('{ greet(name: "Bob") }');
        assert.deepEqual(result, { data: { greet: 'Hello, Bob!' } });
    });
    it('executes a nested object query', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers });
        const result = await engine.execute('{ user(id: "1") { id name } }');
        assert.deepEqual(result, { data: { user: { id: '1', name: 'Alice' } } });
    });
    it('returns null when resolver returns null', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers });
        const result = await engine.execute('{ user(id: "999") { id } }');
        assert.deepEqual(result, { data: { user: null } });
    });
    it('executes a mutation', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers });
        const result = await engine.execute('mutation { createUser(name: "Carol") { id name } }');
        assert.deepEqual(result, { data: { createUser: { id: '42', name: 'Carol' } } });
    });
    it('returns error on parse failure', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers });
        const result = await engine.execute('');
        assert.ok(result.errors && result.errors.length > 0);
    });
});
describe('GraphQlEngine — depth limiting', () => {
    it('rejects query exceeding maxDepth', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers, maxDepth: 1 });
        const result = await engine.execute('{ user(id: "1") { id name } }');
        assert.ok(result.errors && result.errors.length > 0);
        assert.ok(result.errors[0].message.includes('depth'));
    });
    it('accepts query within maxDepth', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers, maxDepth: 3 });
        const result = await engine.execute('{ hello }');
        assert.ok(!result.errors);
    });
});
describe('GraphQlEngine — complexity limiting', () => {
    it('rejects query exceeding maxComplexity', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers, maxComplexity: 1 });
        const result = await engine.execute('{ hello greet(name: "x") }');
        assert.ok(result.errors && result.errors.length > 0);
        assert.ok(result.errors[0].message.includes('complexity'));
    });
    it('accepts query within maxComplexity', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers, maxComplexity: 10 });
        const result = await engine.execute('{ hello }');
        assert.ok(!result.errors);
    });
});
describe('GraphQlEngine — subscriptions', () => {
    it('returns error for subscription operation', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers });
        const result = await engine.execute('subscription { onMessage { id } }');
        assert.ok(result.errors && result.errors.length > 0);
        assert.ok(result.errors[0].message.toLowerCase().includes('subscription'));
    });
});
describe('GraphQlEngine — introspection guard', () => {
    it('allows __schema when introspection=true (default)', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers, introspection: true });
        // We don't have a real introspection resolver, but it should not be blocked by the guard
        const result = await engine.execute('{ __schema { types { name } } }');
        // No introspection error - null data is fine (resolver not defined)
        assert.ok(!result.errors || !result.errors[0].message.includes('disabled'));
    });
    it('blocks __schema when introspection=false', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers, introspection: false });
        const result = await engine.execute('{ __schema { types { name } } }');
        assert.ok(result.errors && result.errors.length > 0);
        assert.ok(result.errors[0].message.includes('disabled'));
    });
    it('blocks __type when introspection=false', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers, introspection: false });
        const result = await engine.execute('{ __type(name: "Query") { name } }');
        assert.ok(result.errors && result.errors.length > 0);
    });
});
describe('GraphQlEngine — variables', () => {
    it('substitutes variables into the query', async () => {
        const engine = new GraphQlEngine({ schema: simpleSchema, resolvers: simpleResolvers });
        const result = await engine.execute('{ greet(name: $name) }', { name: 'Dave' });
        assert.deepEqual(result, { data: { greet: 'Hello, Dave!' } });
    });
});
//# sourceMappingURL=graphql.test.js.map