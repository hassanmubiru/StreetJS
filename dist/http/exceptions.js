// src/http/exceptions.ts
// Typed HTTP exceptions used by controllers and middleware.
export class StreetException extends Error {
    status;
    details;
    constructor(status, message, details) {
        super(message);
        this.status = status;
        this.details = details;
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
    toJSON() {
        return {
            error: this.name,
            message: this.message,
            status: this.status,
            ...(this.details !== undefined ? { details: this.details } : {}),
        };
    }
}
export class BadRequestException extends StreetException {
    constructor(message = 'Bad Request', details) {
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
    constructor(message = 'Conflict', details) {
        super(409, message, details);
    }
}
export class UnprocessableException extends StreetException {
    constructor(message = 'Unprocessable Entity', details) {
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
export function isStreetException(err) {
    return err instanceof StreetException;
}
//# sourceMappingURL=exceptions.js.map