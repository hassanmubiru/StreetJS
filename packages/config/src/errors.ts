// packages/config/src/errors.ts
// Error types for @streetjs/config. All errors are secret-safe: a value marked
// secret is never included verbatim in a message, `issues` payload, or `toJSON`.

import type { ConfigValueType, SourceRef } from './types.js';

/** Placeholder substituted wherever a secret value would otherwise be shown. */
export const REDACTED = '<redacted>';

/** A single validation failure with full diagnostic context. */
export interface ValidationIssue {
  /** Dotted key path of the failing field. */
  readonly key: string;
  /** Source that supplied the value, or `null` when the value was absent. */
  readonly source: SourceRef | null;
  /**
   * The offending value — already redacted to {@link REDACTED} when the field is
   * marked secret, so secrets never surface through an error.
   */
  readonly invalidValue: unknown;
  /** The declared/expected type (or a refined descriptor like `"one of: a, b"`). */
  readonly expectedType: ConfigValueType | string;
  /** Human-readable explanation of why the value was rejected. */
  readonly message: string;
  /** Whether the field is secret (its value has been redacted above). */
  readonly secret: boolean;
}

/** Base class for every error thrown by this package. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Aggregated schema/validation failure. Reports every failing field at once. */
export class ConfigValidationError extends ConfigError {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(ConfigValidationError.format(issues));
    this.name = 'ConfigValidationError';
    this.issues = Object.freeze([...issues]);
  }

  private static renderValue(issue: ValidationIssue): string {
    if (issue.secret) return REDACTED;
    const v = issue.invalidValue;
    if (v === undefined) return '(absent)';
    if (typeof v === 'string') return JSON.stringify(v);
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return '[unserializable]';
    }
  }

  private static format(issues: ValidationIssue[]): string {
    const header =
      issues.length === 1
        ? 'Configuration validation failed (1 issue):'
        : `Configuration validation failed (${issues.length} issues):`;
    const lines = issues.map((i) => {
      const where = i.source
        ? `${i.source.provider}${i.source.location ? `:${i.source.location}` : ''}`
        : 'default/absent';
      return (
        `  • ${i.key} — ${i.message}\n` +
        `      expected: ${i.expectedType}\n` +
        `      received: ${ConfigValidationError.renderValue(i)}\n` +
        `      source:   ${where}`
      );
    });
    return `${header}\n${lines.join('\n')}`;
  }

  /** Structured, secret-safe representation for programmatic handling. */
  override toJSON(): { name: string; issues: readonly ValidationIssue[] } {
    return { name: this.name, issues: this.issues };
  }
}

/** A configuration source could not be parsed (malformed JSON/YAML/TOML, etc.). */
export class ConfigParseError extends ConfigError {
  readonly source: SourceRef;

  constructor(source: SourceRef, detail: string) {
    super(
      `Failed to parse configuration from ${source.provider}` +
        `${source.location ? `:${source.location}` : ''}: ${detail}`,
    );
    this.name = 'ConfigParseError';
    this.source = source;
  }
}

/** An illegal operation on a config/builder (unknown key, mutation, reload disabled). */
export class ConfigStateError extends ConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigStateError';
  }
}
