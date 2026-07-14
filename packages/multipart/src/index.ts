/**
 * @streetjs/multipart — the StreetJS multipart/form-data foundation.
 *
 * A streaming parser that writes uploaded files directly to disk (never
 * buffering the whole upload in heap), enforces a byte limit before buffering,
 * sanitizes filenames, and cleans up partial files on failure. Zero runtime
 * dependencies. Public API only.
 *
 * ```ts
 * import { MultipartParser } from '@streetjs/multipart';
 *
 * const parser = new MultipartParser(boundary, '/tmp/uploads', 10 * 1024 * 1024);
 * const { fields, files } = await parser.parse(req); // req: IncomingMessage
 * ```
 *
 * > This is the standalone home of the parser that also backs the
 * > `streetjs/multipart` subpath; the `streetjs` framework re-exports it, so
 * > there is a single implementation.
 */

export {
  MultipartParser,
  BoundedTransform,
  type ParsedFile,
  type MultipartResult,
} from './parser.js';
