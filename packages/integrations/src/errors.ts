// src/errors.ts
// Typed errors for integration connectors.

/** Base class for all integration errors. */
export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** A vendor API returned a non-2xx response. */
export class IntegrationRequestError extends IntegrationError {
  constructor(
    message: string,
    /** HTTP status code. */
    public readonly status: number,
    /** Raw response body (truncated), for diagnosis. */
    public readonly body: string,
  ) {
    super(message);
  }
}

/** An inbound webhook failed signature verification. */
export class WebhookVerificationError extends IntegrationError {}
