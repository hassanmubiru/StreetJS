// tests/openapi.test.ts
// Unit coverage for the OpenAPI 3.1 generator (http/openapi.ts). Pure function;
// no server, database, or network required.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateOpenApi, type OpenApiRouteInput } from '../http/openapi.js';

describe('http/openapi — generateOpenApi', () => {
  it('emits a 3.1.0 document with info, bearer security scheme, and paths', () => {
    const doc = generateOpenApi([
      { method: 'GET', path: '/items' },
    ]) as Record<string, any>;
    assert.equal(doc.openapi, '3.1.0');
    assert.equal(doc.info.title, 'Street API');
    assert.ok(doc.paths['/items'].get);
    assert.equal(doc.components.securitySchemes.bearerAuth.scheme, 'bearer');
    // Default response is synthesized when none is declared.
    assert.equal(doc.paths['/items'].get.responses['200'].description, 'Success');
    // Default summary is synthesized from method + path.
    assert.equal(doc.paths['/items'].get.summary, 'GET /items');
  });

  it('converts :param to {param} and emits path parameters', () => {
    const doc = generateOpenApi([
      { method: 'GET', path: '/users/:id/posts/:postId' },
    ]) as Record<string, any>;
    const op = doc.paths['/users/{id}/posts/{postId}'].get;
    assert.ok(op);
    const paramNames = op.parameters.map((p: any) => p.name).sort();
    assert.deepEqual(paramNames, ['id', 'postId']);
    for (const p of op.parameters) {
      assert.equal(p.in, 'path');
      assert.equal(p.required, true);
      assert.equal(p.schema.type, 'string');
    }
  });

  it('preserves summary, description, tags, and declared responses with schema', () => {
    const routes: OpenApiRouteInput[] = [
      {
        method: 'POST',
        path: '/items',
        summary: 'Create item',
        description: 'Creates a new item',
        tags: ['items'],
        responses: {
          '201': { description: 'Created', schema: { type: 'object' } },
          '400': { description: 'Bad request' },
        },
      },
    ];
    const doc = generateOpenApi(routes) as Record<string, any>;
    const op = doc.paths['/items'].post;
    assert.equal(op.summary, 'Create item');
    assert.equal(op.description, 'Creates a new item');
    assert.deepEqual(op.tags, ['items']);
    assert.equal(op.responses['201'].content['application/json'].schema.type, 'object');
    // A response without a schema carries only its description (no content).
    assert.equal(op.responses['400'].description, 'Bad request');
    assert.equal(op.responses['400'].content, undefined);
  });

  it('groups multiple methods under the same path', () => {
    const doc = generateOpenApi([
      { method: 'GET', path: '/items/:id' },
      { method: 'DELETE', path: '/items/:id' },
    ]) as Record<string, any>;
    const entry = doc.paths['/items/{id}'];
    assert.ok(entry.get);
    assert.ok(entry.delete);
  });

  it('returns an empty paths object for no routes', () => {
    const doc = generateOpenApi([]) as Record<string, any>;
    assert.deepEqual(Object.keys(doc.paths), []);
  });
});
