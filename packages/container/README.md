# @streetjs/container

The StreetJS dependency injection container: an application-scoped IoC registry
that resolves constructor-injected dependency trees, supports explicit tokens
and lifetimes, detects circular dependencies, and owns deterministic disposal.
The exported `container` remains as a process-wide compatibility instance.
ESM, strict-TypeScript, backed by `reflect-metadata`.

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
import { Injectable, createContainer } from '@streetjs/container';

@Injectable()
class Database {
  query(sql: string) { /* ... */ }
}

@Injectable()
class UserService {
  constructor(private readonly db: Database) {}
}

// Database is constructed once and injected as a singleton.
const app = createContainer();
const users = app.resolve(UserService);
await app.dispose();
```

## API

### `@Injectable()`

Class decorator that marks a class as participating in DI. Applying it also
triggers TypeScript's `design:paramtypes` metadata emission, which the container
reads to discover constructor dependencies.

### `createContainer()` / `Container`

`createContainer()` creates an isolated application container. `new Container()`
is equivalent. Child scopes can be created with `createScope()` for scoped
bindings. The exported `container` and `Container.getInstance()` remain the
legacy process-wide compatibility instance.

| Method | Description |
| ------ | ----------- |
| `resolve(token)` | Resolve a class or explicit token. Unregistered classes are singleton by default. |
| `register(token, instance)` | Legacy class-token registration of a singleton instance. |
| `registerValue(token, value)` | Register a class, symbol, or string token as a singleton value. |
| `registerFactory(token, factory, scope?)` | Register a factory as `singleton`, `transient`, or child-`scoped`. |
| `createScope()` | Create an isolated child scope that inherits singleton bindings. |
| `dispose()` | Close/dispose owned instances once, in reverse creation order. |
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
