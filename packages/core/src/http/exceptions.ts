// src/http/exceptions.ts
// Typed HTTP exceptions used by controllers and middleware.
//
// The implementation now lives in the standalone, zero-dependency
// `@streetjs/exceptions` package. This module re-exports it verbatim so the
// `streetjs/exceptions` subpath and every internal import keep working against a
// single source of truth — no duplication, no shim.

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
} from '@streetjs/exceptions';
