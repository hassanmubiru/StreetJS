# @streetjs/container

The StreetJS dependency injection container: a process-wide singleton IoC
registry that resolves constructor-injected dependency trees, detects circular
dependencies, and exposes an `@Injectable()` class decorator. ESM,
strict-TypeScript, backed by `reflect-metadata`.

This is the standalone home of the container that also backs the `streetjs`
framework. The framework re-exports this package, so there is a single source of
truth.

## Install

```bash
npm install @streetjs/container reflect-metadata
```

Import `reflect-metadata` **once** at your application entry point, and enable
decorator metadata in your `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Usage

```ts
import 'reflect-metadata';
import { Injectable, container } from '@streetjs/container';

@Injectable()
class Database {
  query(sql: string) { /* ... */ }
}

@Injectable()
class UserService {
  constructor(private readonly db: Database) {}
}

// Database is constructed once and injected as a singleton.
const users = container.resolve(UserService);
```

## API

### `@Injectable()`

Class decorator that marks a class as participating in DI. Applying it also
triggers TypeScript's `design:paramtypes` metadata emission, which the container
reads to discover constructor dependencies.

### `container` / `Container`

A single shared `Container` instance is exported as `container`
(`Container.getInstance()` returns the same singleton).

| Method | Description |
| ------ | ----------- |
| `resolve(token)` | Return the singleton for `token`, constructing it and its dependency tree on first use. |
| `register(token, instance)` | Register a pre-built instance so `resolve(token)` returns it. |
| `has(token)` | `true` if the token has been resolved or registered. |
| `reset()` | Clear all instances — primarily for tests. |

### Circular-dependency detection

If resolution re-enters a token already on the resolution stack, `resolve`
throws with the full chain (`A -> B -> A`) instead of overflowing the stack.

### Unresolvable dependencies

A constructor parameter typed as an interface, a primitive, or an
un-`@Injectable` value erases to `Object`/undefined in emitted metadata. The
container throws a clear error naming the resolution chain and suggesting you
enable `emitDecoratorMetadata` and decorate the dependency.

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/container
```

## License

MIT — see [LICENSE](./LICENSE).
