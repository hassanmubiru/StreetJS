# @streetjs/registry-server

The Street Framework **Network Plugin Registry** — a network-accessible service
that hosts, indexes, and serves signed plugins with a secure publish flow and a
public install flow (Requirement 4).

It is built on the `@streetjs/core` (`streetjs`) signing primitives
(`verifyManifest`, `manifestChecksum`, `signManifest`, `PluginManifest`) and the
core pagination helper (`normalizePageSize`), so the registry and the framework
agree byte-for-byte on what a valid signed manifest is.

## REST API (`/api/v1`)

| Method & path | Operation | Access |
| --- | --- | --- |
| `POST /api/v1/plugins` | Publish a plugin version | **Authenticated + authorized** |
| `GET /api/v1/plugins` | List plugins (paginated) | Public |
| `GET /api/v1/plugins/search` | Search by `q` / `category` / `tag` (paginated) | Public |
| `GET /api/v1/plugins/:name/versions` | Version history | Public |
| `GET /api/v1/plugins/:name/:version/download` | Download package + recorded signature | Public |
| `GET /api/v1/plugins/:name/:version/verify` | Re-check integrity + signature | Public |

`:name` may be a scoped name with a single `/` (e.g. `@acme/widgets`).

## Security model

- **Authentication (AuthN):** bearer token. Publishing requires
  `Authorization: Bearer <api-key>`. The raw API key is never persisted — only
  its SHA-256 hash (`apiKeyHash`) is stored. A request authenticates iff the
  presented key hashes to a registered publisher.
- **Authorization (AuthZ):** namespace ownership. Each publisher owns a set of
  namespaces. A plugin's namespace is the segment before the first `/` with a
  leading `@` stripped (`@acme/widgets` → `acme`, `widgets` → `widgets`). A
  publisher may only publish plugins whose namespace it owns.
- **Reads are public:** download, verify, search, list, and versions require no
  authentication.

## Publish pipeline

On `POST /api/v1/plugins` the service runs, in order, rejecting on the first
failure **without mutating the store** (previously published valid versions are
always preserved):

1. **Authenticate** the bearer token → `401 UNAUTHENTICATED`.
2. **Validate manifest metadata** — identity/name, semver version, declared
   dependencies, declared capabilities → `422 INVALID_MANIFEST` (with the
   offending `field`).
3. **Authorize** the publisher for the manifest's namespace → `403 UNAUTHORIZED`.
4. **Reject duplicates** of an existing `name@version` → `409 DUPLICATE`.
5. **Verify** the Ed25519 signature + manifest checksum against the supplied
   public key → `422 INTEGRITY_FAILED`.
6. **Store** the signed manifest, the publisher public key, the tarball blob,
   and the indexed metadata (name, version, categories, tags, version history).

## Running

```bash
npm run build
STREET_REGISTRY_PUBLISHERS='[{"id":"acme","apiKey":"secret","namespaces":["acme"]}]' \
  PORT=8787 node ./dist/cli.js
```

## Programmatic use

```ts
import { RegistryService, PublisherDirectory, startRegistryServer } from '@streetjs/registry-server';
import { signManifest } from 'streetjs';

const publishers = new PublisherDirectory();
publishers.register('acme', 'secret', ['acme']);
const service = new RegistryService({ publishers });
const handle = await startRegistryServer(service, 8787);
```
