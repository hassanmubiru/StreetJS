// @streetjs/devtools — devtools data assembly (Req 7.2 / 7.3 / 7.1).
//
// The browser experience renders three framework-sourced datasets:
//  - the route tree    (Route Explorer, Req 7.2)            → buildRouteTree
//  - the dependency    (Dependency Graph Visualizer, Req 7.3) → buildDependencyGraph
//  - the OpenAPI doc   (Playground + OpenAPI viewer, Req 7.1) → app.openApiSpec()
//
// The pure builders live in @streetjs/core (`streetjs`); this module gathers
// them into a single `DevtoolsData` payload that the bundle renders. It also
// provides a small, self-contained demo dataset so the static docs-site
// experience renders meaningfully without a live application attached.

import { buildRouteTree, buildDependencyGraph } from 'streetjs';
import type { RouteNode, DepGraph, StreetApp } from 'streetjs';

export type { RouteNode, DepGraph } from 'streetjs';

/** The complete dataset the devtools browser experience renders. */
export interface DevtoolsData {
  /** Display title for the experience. */
  title: string;
  /** Base URL the Playground / API Inspector issue read-only requests to. */
  baseUrl: string;
  /** OpenAPI document powering the Playground + OpenAPI viewer (Req 7.1). */
  openApi: unknown;
  /** Route tree for the Route Explorer (Req 7.2). */
  routeTree: RouteNode[];
  /** Module dependency graph for the Visualizer (Req 7.3). */
  depGraph: DepGraph;
}

export interface BuildDevtoolsDataOptions {
  title?: string;
  baseUrl?: string;
  /** Entry source file for the dependency graph walk (Req 7.3). */
  dependencyEntry?: string;
}

/**
 * Assemble the devtools dataset from a live application and an optional
 * dependency-graph entry point. Pure with respect to the app: it only reads the
 * registered routes (via the OpenAPI surface) and statically walks imports.
 */
export function buildDevtoolsData(app: StreetApp, opts: BuildDevtoolsDataOptions = {}): DevtoolsData {
  const openApi = app.openApiSpec();
  return {
    title: opts.title ?? 'Street DevTools',
    baseUrl: opts.baseUrl ?? '',
    openApi,
    routeTree: buildRouteTree(app),
    depGraph: opts.dependencyEntry ? buildDependencyGraph(opts.dependencyEntry) : { nodes: [], edges: [] },
  };
}

/**
 * A self-contained demo dataset for the published docs-site experience. It lets
 * a visitor explore every tool (Route Explorer, Dependency Graph, Playground,
 * API Inspector) without attaching a running application. The Playground and
 * API Inspector point at no base URL by default, so a visitor must supply both
 * a base URL and an access token before any (read-only) request can be issued.
 */
export function demoDevtoolsData(): DevtoolsData {
  return {
    title: 'Street DevTools',
    baseUrl: '',
    openApi: {
      openapi: '3.1.0',
      info: { title: 'Street Demo API', version: '1.0.0' },
      paths: {
        '/health/live': { get: { summary: 'Liveness probe' } },
        '/health/ready': { get: { summary: 'Readiness probe' } },
        '/users': {
          get: { summary: 'List users' },
          post: { summary: 'Create a user (mutating — blocked by read-only policy)' },
        },
        '/users/{id}': {
          get: { summary: 'Fetch a user by id' },
        },
      },
    },
    routeTree: [
      {
        method: '',
        path: '/health',
        children: [
          { method: 'GET', path: '/health/live' },
          { method: 'GET', path: '/health/ready' },
        ],
      },
      {
        method: '',
        path: '/users',
        children: [
          { method: 'GET', path: '/users' },
          { method: 'POST', path: '/users' },
          {
            method: '',
            path: '/users/{id}',
            children: [{ method: 'GET', path: '/users/{id}' }],
          },
        ],
      },
    ],
    depGraph: {
      nodes: ['src/main.ts', 'src/routes/users.ts', 'src/services/user.service.ts', 'src/db/pool.ts'],
      edges: [
        ['src/main.ts', 'src/routes/users.ts'],
        ['src/routes/users.ts', 'src/services/user.service.ts'],
        ['src/services/user.service.ts', 'src/db/pool.ts'],
      ],
    },
  };
}
