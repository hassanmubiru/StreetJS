// packages/config/src/schema.ts
// Typed, chainable schema builder. A schema is a (possibly nested) shape of
// field descriptors; the config value type is inferred from it at compile time.
//
//   const schema = defineSchema({
//     port: s.number({ integer: true, min: 1, max: 65535 }).default(3000),
//     database: {
//       url: s.url({ protocols: ['postgres'] }).secret(),
//       poolSize: s.number({ integer: true }).default(10),
//     },
//     logLevel: s.enum(['debug', 'info', 'warn', 'error'] as const).default('info'),
//   });
//   type Cfg = Infer<typeof schema>;

import type { ConfigValueType } from './types.js';
import {
  makeErr,
  validateArray,
  validateBoolean,
  validateDuration,
  validateEmail,
  validateEnum,
  validateHostname,
  validateIp,
  validateNumber,
  validateObject,
  validatePath,
  validateString,
  validateUrl,
  type ArrayOptions,
  type NumberOptions,
  type Outcome,
  type StringOptions,
  type UrlOptions,
} from './validator.js';

/** A resolved field descriptor consumed by the loader. */
export interface FieldDescriptor<T> {
  readonly kind: 'field';
  readonly type: ConfigValueType;
  readonly isSecret: boolean;
  readonly required: boolean;
  readonly hasDefault: boolean;
  readonly defaultValue: T | undefined;
  readonly description: string | undefined;
  /** Validate + coerce a raw source value (does not apply the transform). */
  validate(raw: unknown): Outcome<T>;
  /** Apply the optional post-validation transform. Identity when none set. */
  applyTransform(value: T): T;
  /** Phantom marker carrying the inferred output type. Never read at runtime. */
  readonly __type?: T;
}

/** A nested schema shape: fields and/or sub-shapes. */
export interface SchemaShape {
  readonly [key: string]: FieldDescriptor<unknown> | SchemaShape;
}

/** Infer the strongly-typed configuration object from a schema shape. */
export type Infer<S> = {
  -readonly [K in keyof S]: S[K] extends FieldDescriptor<infer T>
    ? T
    : S[K] extends SchemaShape
      ? Infer<S[K]>
      : never;
};

type Check<T> = (value: T) => true | string;

interface InternalDef<T> {
  readonly type: ConfigValueType;
  readonly baseValidate: (raw: unknown) => Outcome<T>;
  readonly checks: readonly Check<T>[];
  readonly transformFn: ((v: T) => T) | undefined;
  readonly secret: boolean;
  readonly required: boolean;
  readonly hasDefault: boolean;
  readonly defaultValue: T | undefined;
  readonly description: string | undefined;
}

/** Immutable, chainable field builder. Every method returns a new builder. */
export class Field<T> implements FieldDescriptor<T> {
  readonly kind = 'field' as const;

  /** @internal */
  constructor(private readonly def: InternalDef<T>) {}

  get type(): ConfigValueType {
    return this.def.type;
  }
  get isSecret(): boolean {
    return this.def.secret;
  }
  get required(): boolean {
    return this.def.required;
  }
  get hasDefault(): boolean {
    return this.def.hasDefault;
  }
  get defaultValue(): T | undefined {
    return this.def.defaultValue;
  }
  get description(): string | undefined {
    return this.def.description;
  }

  validate(raw: unknown): Outcome<T> {
    const base = this.def.baseValidate(raw);
    if (!base.ok) return base;
    for (const check of this.def.checks) {
      const res = check(base.value);
      if (res !== true) return makeErr(this.def.type, res);
    }
    return base;
  }

  applyTransform(value: T): T {
    return this.def.transformFn ? this.def.transformFn(value) : value;
  }

  /** Provide a default used when no source supplies the value. Marks it optional-to-source. */
  default(value: T): Field<T> {
    return new Field<T>({ ...this.def, hasDefault: true, defaultValue: value, required: false });
  }

  /** Make the field optional (absent → `undefined`). Widens the inferred type. */
  optional(): Field<T | undefined> {
    return new Field<T | undefined>({
      ...(this.def as unknown as InternalDef<T | undefined>),
      required: false,
      hasDefault: false,
      defaultValue: undefined,
    });
  }

  /** Mark the value secret: masked in serialize(), redacted in errors, never logged. */
  secret(): Field<T> {
    return new Field<T>({ ...this.def, secret: true });
  }

  /** Attach a human-readable description (surfaced in metadata / docs). */
  describe(description: string): Field<T> {
    return new Field<T>({ ...this.def, description });
  }

  /** Add a custom check. Return `true` to pass or a message string to fail. */
  check(fn: Check<T>): Field<T> {
    return new Field<T>({ ...this.def, checks: [...this.def.checks, fn] });
  }

  /** Transform the validated value (applied after validation, before freeze). */
  transform(fn: (value: T) => T): Field<T> {
    return new Field<T>({ ...this.def, transformFn: fn });
  }
}

function field<T>(type: ConfigValueType, baseValidate: (raw: unknown) => Outcome<T>): Field<T> {
  return new Field<T>({
    type,
    baseValidate,
    checks: [],
    transformFn: undefined,
    secret: false,
    required: true,
    hasDefault: false,
    defaultValue: undefined,
    description: undefined,
  });
}

/** Field factories. Each returns a required field by default. */
export const s = {
  string: (opts?: StringOptions): Field<string> => field('string', (r) => validateString(r, opts)),
  number: (opts?: NumberOptions): Field<number> => field('number', (r) => validateNumber(r, opts)),
  boolean: (): Field<boolean> => field('boolean', (r) => validateBoolean(r)),
  enum: <const V extends string>(values: readonly V[]): Field<V> =>
    field('enum', (r) => validateEnum<V>(r, values)),
  array: <T>(item: Field<T>, opts?: ArrayOptions): Field<T[]> =>
    field('array', (r) => validateArray<T>(r, (i) => item.validate(i), opts)),
  object: (): Field<Record<string, unknown>> => field('object', (r) => validateObject(r)),
  duration: (): Field<number> => field('duration', (r) => validateDuration(r)),
  url: (opts?: UrlOptions): Field<string> => field('url', (r) => validateUrl(r, opts)),
  path: (): Field<string> => field('path', (r) => validatePath(r)),
  hostname: (): Field<string> => field('hostname', (r) => validateHostname(r)),
  ip: (version?: 4 | 6): Field<string> => field('ip', (r) => validateIp(r, version)),
  email: (): Field<string> => field('email', (r) => validateEmail(r)),
  /** A fully custom field: supply a validator returning the typed value or a message. */
  custom: <T>(validate: (raw: unknown) => Outcome<T>): Field<T> => field('custom', validate),
} as const;

/** Identity helper that fixes the schema type for inference. Alias: `schema`. */
export function defineSchema<S extends SchemaShape>(shape: S): S {
  return shape;
}

/** Alias of {@link defineSchema} (matches the documented `schema()` API name). */
export const schema = defineSchema;

/** @internal Runtime discriminator: is this shape entry a field or a sub-shape? */
export function isField(x: FieldDescriptor<unknown> | SchemaShape): x is FieldDescriptor<unknown> {
  return (x as { kind?: unknown }).kind === 'field';
}
