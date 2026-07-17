// src/errors.ts
// Typed error hierarchy for the media package (zero-dependency).

/** Base class for all media errors. */
export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** A bad option/argument was supplied (e.g. an unsafe raw arg, invalid CRF). */
export class MediaValidationError extends MediaError {}

/** The underlying command (ffmpeg/ffprobe) exited non-zero. */
export class MediaCommandError extends MediaError {
  constructor(
    message: string,
    /** Process exit code. */
    public readonly code: number,
    /** Captured stderr, useful for diagnosing ffmpeg failures. */
    public readonly stderr: string,
  ) {
    super(message);
  }
}

/** ffprobe output could not be parsed into a {@link MediaInfo}. */
export class MediaProbeError extends MediaError {}
