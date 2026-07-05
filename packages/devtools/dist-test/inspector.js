// @streetjs/devtools — gated API Inspector flow (Req 7.4 / 7.5 / 7.7).
//
// The API Inspector issues a single request against the inspected app and
// renders the response status, headers, and body (Req 7.4). On failure it
// surfaces an error indication and RETAINS the submitted request input verbatim
// (Req 7.5). Every inspection is funnelled through `DevtoolsAuthGate` first, so
// the read-only + token-gated model is enforced for programmatic callers, not
// just the browser UI (Req 7.7).
//
// The success/failure result shapes reuse the core builders
// (`inspectorSuccess` / `inspectorFailure`) so the framework and the devtools
// agree on the InspectorResult model.
import { inspectorSuccess, inspectorFailure } from 'streetjs';
/**
 * Run a single API Inspector request through the gate. The gate enforces the
 * token-gated, read-only model BEFORE any network call is made:
 *  - a missing/invalid token yields a failure result whose error names the
 *    authentication requirement, with the submitted input retained (Req 7.5);
 *  - a mutating (non read-only) method yields a failure result whose error
 *    names the read-only policy, with the submitted input retained (Req 7.5).
 *
 * Only a request that is both authenticated and read-only reaches the network.
 */
export async function inspect(gate, token, request, fetchImpl) {
    const decision = gate.authorize({ token, method: request.method });
    if (!decision.allowed) {
        // Denied before any side effect: surface the reason and retain the input.
        return inspectorFailure(request, decision.reason ?? decision.code);
    }
    try {
        const res = await fetchImpl(request.url, {
            method: request.method,
            headers: { ...(request.headers ?? {}) },
            ...(request.body !== undefined ? { body: request.body } : {}),
        });
        const headers = {};
        res.headers.forEach((value, key) => {
            headers[key] = value;
        });
        const body = await res.text();
        return inspectorSuccess(request, { status: res.status, headers, body });
    }
    catch (err) {
        // Network/parse failure: error indication + retained input (Req 7.5).
        return inspectorFailure(request, err);
    }
}
//# sourceMappingURL=inspector.js.map