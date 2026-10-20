# ADR 0020: Roll back a failed PluginHost sandbox

- **Status:** Accepted
- **Date:** 2026-10-20
- **Scope:** formal `PluginHost`; not HTTP/HTTP2 application plugin loaders

## Decision

If `onInstall` or `onLoad` throws, dispose that enable attempt's sandbox,
remove it from the host, and preserve the previous registered/disabled state.
Invoke synchronous cleanup callbacks in reverse registration order, exactly
once, continuing after failures. Clear middleware and listener registrations
even when cleanup throws. Retrying creates a fresh sandbox.

When rollback succeeds, rethrow the original startup value unchanged. When
rollback fails, throw `AggregateError` with the startup value as `cause` and
`errors` equal to `[startupValue, ...cleanupFailures]` in execution order.
These are internal lifecycle errors, not an HTTP response serialization format.

## Compatibility and boundaries

The SDK remains unchanged; cleanup is synchronous per ADR 0014. Promises
returned by cleanup callbacks are not awaited. Successful installation remains
recorded if loading subsequently fails; failed installation is retried.
Failed loads do not call `onUnload`. Enabled dependencies remain enabled,
including dependencies enabled by the failed call: graph-wide transactional
startup is not provided by this change. Concurrent enable/disable is not covered.

The same sandbox disposal routine now exhausts all cleanup callbacks during
normal disable, but throwing `onUnload` and disable failure-state handling
remain separate work. External resources acquired without a registered cleanup
are not automatically recovered. HTTP/HTTP2 loader parity remains unverified.

## Evidence

Compile and run the existing focused suite from the repository root:

```sh
./node_modules/.bin/tsc -p packages/core/tsconfig.json
node --test packages/core/dist/src/tests/plugin-host.test.js
```

Eight added tests cover zero/one/three resource rollback, continued cleanup
after multiple failures, error identity, retained registration references,
fresh retry, disabled state, manual disposer idempotence, installation failure,
and dependency ownership. Before the fix: 18 pass, 8 fail. After: 26 pass,
0 fail, 0 skipped. Root verification does not automatically run this focused
suite; run it explicitly until lifecycle coverage is integrated there.
