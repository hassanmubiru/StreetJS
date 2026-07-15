# @streetjs/exceptions

The StreetJS HTTP exceptions foundation: a small, typed exception hierarchy with
HTTP status codes, JSON serialization, and a type guard. **Zero runtime
dependencies**, framework-agnostic, ESM, and tree-shakeable.

This is the standalone home of the exceptions that also back the
`streetjs/exceptions` subpath. The `streetjs` framework re-exports this package,
so there is a single source of truth.

## Install

```bash
npm install @streetjs/exceptions
```

## Usage

```ts
import { NotFoundException, isStreetException } from '@streetjs/exceptions';

function loadUser(id: string) {
  const user = db.get(id);
  if (!user) throw new NotFoundException(`user ${id} not found`);
  return user;
}

// In a framework error handler:
function onError(err: unknown, res: ServerResponse) {
  if (isStreetException(err)) {
    res.writeHead(err.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(err)); // uses toJSON()
    return;
  }
  res.writeHead(500).end(JSON.stringify({ error: 'InternalException', status: 500 }));
}
```

## The hierarchy

Every exception extends `StreetException`, which carries a numeric `status`, a
`message`, and optional `details`. `toJSON()` produces a stable wire shape:
`{ error, message, status, details? }`.

| Class                                  | Status | Notes                                            |
| -------------------------------------- | ------ | ------------------------------------------------ |
| `StreetException`                      | any    | Base class; construct with an explicit status.   |
| `BadRequestException`                  | 400    | Accepts optional `details`.                      |
| `UnauthorizedException`                | 401    |                                                  |
| `ForbiddenException`                   | 403    |                                                  |
| `NotFoundException`                    | 404    |                                                  |
| `ConflictException`                    | 409    | Accepts optional `details`.                      |
| `UnprocessableException`               | 422    | Accepts optional `details`.                      |
| `InternalException`                    | 500    |                                                  |
| `ServiceUnavailableException`          | 503    |                                                  |
| `DatabaseConnectionError`              | 503    | Adds an operator `suggestion` field to the JSON. |
| `FeatureUnavailableInEdgeRuntimeError` | 501    | Formats a message from a feature name.           |

### `isStreetException(err): err is StreetException`

A type guard that narrows `unknown` to `StreetException`. Use it in error
handlers to distinguish framework errors (which carry a safe `status` and JSON
body) from unexpected errors (which should collapse to a generic 500).

## JSON serialization

```ts
new BadRequestException('email is required', { field: 'email' }).toJSON();
// { error: 'BadRequestException', message: 'email is required', status: 400, details: { field: 'email' } }

new DatabaseConnectionError('cannot reach primary', 'check DATABASE_URL');
// JSON: { error: 'DatabaseConnectionError', message: '...', status: 503, suggestion: 'check DATABASE_URL' }
```

`details` and `suggestion` are omitted from the JSON when not provided, keeping
error payloads minimal.

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/exceptions
```

## License

MIT — see [LICENSE](./LICENSE).
