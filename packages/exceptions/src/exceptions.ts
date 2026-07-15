// src/http/exceptions.ts
// Typed HTTP exceptions used by controllers and middleware.

export class StreetException extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): object {
    return {
      error: this.name,
      message: this.message,
      status: this.status,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export class BadRequestException extends StreetException {
  constructor(message = 'Bad Request', details?: unknown) {
    super(400, message, details);
  }
}

export class UnauthorizedException extends StreetException {
  constructor(message = 'Unauthorized') {
    super(401, message);
  }
}

export class ForbiddenException extends StreetException {
  constructor(message = 'Forbidden') {
    super(403, message);
  }
}

export class NotFoundException extends StreetException {
  constructor(message = 'Not Found') {
    super(404, message);
  }
}

export class ConflictException extends StreetException {
  constructor(message = 'Conflict', details?: unknown) {
    super(409, message, details);
  }
}

export class UnprocessableException extends StreetException {
  constructor(message = 'Unprocessable Entity', details?: unknown) {
    super(422, message, details);
  }
}

export class InternalException extends StreetException {
  constructor(message = 'Internal Server Error') {
    super(500, message);
  }
}

export class ServiceUnavailableException extends StreetException {
  constructor(message = 'Service Unavailable') {
    super(503, message);
  }
}

export function isStreetException(err: unknown): err is StreetException {
  return err instanceof StreetException;
}

export class DatabaseConnectionError extends StreetException {
  constructor(
    message = 'Database connection failed',
    public readonly suggestion?: string
  ) {
    super(503, message);
  }

  override toJSON(): object {
    return {
      ...super.toJSON(),
      ...(this.suggestion !== undefined ? { suggestion: this.suggestion } : {}),
    };
  }
}

export class FeatureUnavailableInEdgeRuntimeError extends StreetException {
  constructor(featureName = 'Feature') {
    super(501, `${featureName} is not available in the Edge runtime`);
  }
}
