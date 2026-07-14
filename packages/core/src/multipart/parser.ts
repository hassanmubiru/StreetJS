// src/multipart/parser.ts
//
// The streaming multipart/form-data parser now lives in the standalone
// @streetjs/multipart package (single source of truth). This module re-exports
// it so the `streetjs/multipart` subpath and all internal `../multipart/parser.js`
// imports keep working unchanged — dependency inversion, not duplication.

export { MultipartParser, BoundedTransform } from '@streetjs/multipart';
export type { ParsedFile, MultipartResult } from '@streetjs/multipart';
