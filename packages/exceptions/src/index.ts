/**
 * @streetjs/exceptions — the StreetJS HTTP exceptions foundation.
 *
 * A typed exception hierarchy with HTTP status codes, JSON serialization, and a
 * type guard. Zero runtime dependencies; framework-agnostic. Public API only.
 *
 * ```ts
 * import { NotFoundException, isStreetException } from '@streetjs/exceptions';
 *
 * throw new NotFoundException('user not found');
 * // in an error handler:
 * if (isStreetException(err)) res.writeHead(err.status).end(JSON.stringify(err));
 * ```
 *
 * > This is the standalone home of the exceptions that also back the
 * > `streetjs/exceptions` subpath; the `streetjs` framework re-exports them, so
 * > there is a single implementation.
 */

export {
  StreetException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  UnprocessableException,
  InternalException,
  ServiceUnavailableException,
  DatabaseConnectionError,
  FeatureUnavailableInEdgeRuntimeError,
  isStreetException,
} from './exceptions.js';
