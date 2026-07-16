# Changelog

All notable changes to `@streetjs/context` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial standalone release of the StreetJS request/response context, extracted
  verbatim from the `streetjs` core (`src/core/context.ts`).
- `createContext(req, res, path, query)` returning a strict `StreetContext` with
  `json`/`text`/`html`/`send` responders, a single-write `sent` guard, header
  normalization (lowercased keys, joined array values), request-cookie reading,
  and secure-by-default `setCookie`.
- `serializeCookie(name, value, options?)` — the pure `Set-Cookie` builder with
  `httpOnly`/`secure`/`sameSite` default resolution and stable attribute order.
- Public types: `StreetContext`, `AuthenticatedUser`, `CookieOptions`.
- Type-only dependencies on `node:http` and `@streetjs/multipart` (`ParsedFile`);
  ESM. 17 tests (no real socket), 100% line coverage, and a runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/context-v1.0.0
