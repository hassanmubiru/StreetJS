// src/core/container.ts
// Dependency injection container with singleton registry and circular dep detection.
//
// The implementation now lives in the standalone `@streetjs/container` package
// (single runtime dep: reflect-metadata). This module re-exports it verbatim so
// every internal `../core/container.js` importer and the public `streetjs` API
// keep working against a single source of truth — no duplication, no shim.

export { Container, Injectable, container } from '@streetjs/container';
