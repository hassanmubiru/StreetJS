# `street upgrade` — codemods

`street upgrade` applies migration **codemods** to your TypeScript sources so you
can adopt API changes mechanically instead of by hand. It is **dry-run by
default** (it shows what would change) and only writes when you pass `--write`.

The codemod engine lives in `streetjs` (`applyCodemods`, `listCodemods`),
so codemods are unit-testable and reusable outside the CLI.

## Usage

```bash
street upgrade --list                 # show available codemods
street upgrade [path]                 # dry-run over <path> (default: src)
street upgrade [path] --write         # apply changes to disk
street upgrade [path] --codemod <id>  # run a single codemod
```

`node_modules`, `dist`, `.git`, `build`, and `coverage` are always skipped, and
`.d.ts` files are ignored. A path that points at a single file upgrades just
that file.

### Example

```
$ street upgrade src
  would update: src/events.ts (2 changes)

  street upgrade — summary
  mode:           dry-run (use --write to apply)
  files scanned:  37
  files changed:  1
  total changes:  2
    - rename-rabbitmq-transport: 2
```

Re-running after `--write` reports `total changes: 0` — codemods are idempotent.

## Built-in codemods

| id | description |
| --- | --- |
| `rename-rabbitmq-transport` | Rename the deprecated `RabbitMQTransport` alias to the canonical `RabbitMqTransport`. |

Codemods rename **whole-word** identifiers only, so `RabbitMQTransport` is
rewritten while a longer identifier like `RabbitMQTransportFactory` is left
untouched, and the change count is reported per file and per codemod.

## Programmatic API

```ts
import { applyCodemods, listCodemods } from 'streetjs';

const { code, totalChanges, perCodemod } = applyCodemods(source);          // all built-ins
const onlyOne = applyCodemods(source, ['rename-rabbitmq-transport']);       // selected
```

## Verification

- Engine: `packages/core/src/tests/codemods.test.ts` (7 tests) — word-boundary
  renaming, change counting, the built-in rename, selection, unknown-id rejection.
- CLI: `packages/cli/src/tests/upgrade.test.ts` (4 tests) — `--list`, dry-run
  (no mutation, `node_modules` skipped), `--write` (applies to disk), and
  idempotent re-run.

```bash
node --test packages/core/dist/src/tests/codemods.test.js
node --test packages/cli/dist/tests/upgrade.test.js
```
