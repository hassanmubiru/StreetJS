export declare class StreetException extends Error {
    readonly status: number;
    readonly details?: unknown | undefined;
    constructor(status: number, message: string, details?: unknown | undefined);
    toJSON(): object;
}
export declare class BadRequestException extends StreetException {
    constructor(message?: string, details?: unknown);
}
export declare class UnauthorizedException extends StreetException {
    constructor(message?: string);
}
export declare class ForbiddenException extends StreetException {
    constructor(message?: string);
}
export declare class NotFoundException extends StreetException {
    constructor(message?: string);
}
export declare class ConflictException extends StreetException {
    constructor(message?: string, details?: unknown);
}
export declare class UnprocessableException extends StreetException {
    constructor(message?: string, details?: unknown);
}
export declare class InternalException extends StreetException {
    constructor(message?: string);
}
export declare class ServiceUnavailableException extends StreetException {
    constructor(message?: string);
}
export declare function isStreetException(err: unknown): err is StreetException;
//# sourceMappingURL=exceptions.d.ts.map