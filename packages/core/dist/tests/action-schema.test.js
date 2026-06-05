import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
// ── Helpers ──────────────────────────────────────────────────────────────────
/** Full path to the composite action definition */
const actionYmlPath = join(process.cwd(), ".github", "actions", "setup", "action.yml");
/** Ensure the action file exists before parsing */
assert.ok(existsSync(actionYmlPath), `action.yml not found at ${actionYmlPath} — run tests from the project root`);
/** Lazily parsed action document (re-reads each describe block for isolation) */
function loadAction() {
    return yaml.load(readFileSync(actionYmlPath, "utf-8"));
}
/** Assert that an object has no keys outside an allowed set */
function assertNoExtraKeys(obj, allowed, label) {
    const keys = new Set(Object.keys(obj));
    for (const k of allowed)
        keys.delete(k);
    assert.equal(keys.size, 0, `Unexpected ${label}: ${[...keys].join(", ")}`);
}
/** 40-character hex SHA used by GitHub Actions for immutable action pinning */
const SHA_RE = /^[a-f0-9]{40}$/;
// ── Tests ────────────────────────────────────────────────────────────────────
describe("composite action schema — top-level", () => {
    const action = loadAction();
    it("has a name", () => {
        assert.equal(typeof action.name, "string");
        assert.ok(action.name.length > 0);
    });
    it("has a description", () => {
        assert.equal(typeof action.description, "string");
        assert.ok(action.description.length > 0);
    });
    it("declares inputs", () => {
        assert.ok(action.inputs);
        assert.equal(typeof action.inputs, "object");
    });
    it("declares runs", () => {
        assert.ok(action.runs);
        assert.equal(typeof action.runs, "object");
    });
    it("has no unexpected top-level keys", () => {
        assertNoExtraKeys(action, new Set(["name", "description", "inputs", "runs"]), "top-level keys");
    });
});
describe("composite action schema — inputs", () => {
    const action = loadAction();
    const inputs = action.inputs;
    it("has a node-version input", () => {
        assert.ok(inputs["node-version"]);
        const nv = inputs["node-version"];
        assert.equal(nv.required, false);
        assert.equal(nv.default, "20");
        assert.equal(typeof nv.description, "string");
    });
    it("has a registry-url input", () => {
        assert.ok(inputs["registry-url"]);
        const ru = inputs["registry-url"];
        assert.equal(ru.required, false);
        assert.equal(ru.default, "");
        assert.equal(typeof ru.description, "string");
    });
    it("has no unexpected inputs", () => {
        assertNoExtraKeys(inputs, new Set(["node-version", "registry-url"]), "inputs");
    });
    it("all inputs are not required (action should provide sensible defaults)", () => {
        for (const [name, input] of Object.entries(inputs)) {
            const def = input.required;
            assert.equal(def, false, `Input "${name}" should not be required (has default)`);
        }
    });
});
describe("composite action schema — runs", () => {
    const action = loadAction();
    const runs = action.runs;
    it("uses the composite runner", () => {
        assert.equal(runs.using, "composite");
    });
    it("has exactly 2 steps", () => {
        assert.ok(Array.isArray(runs.steps));
        assert.equal(runs.steps.length, 2);
    });
});
describe("composite action schema — step 1: setup-node", () => {
    const action = loadAction();
    const steps = action.runs
        .steps;
    const step = steps[0];
    it("has a descriptive name", () => {
        assert.equal(typeof step.name, "string");
        assert.ok(step.name.startsWith("Setup Node.js"));
    });
    it("uses actions/setup-node", () => {
        const uses = step.uses;
        assert.ok(uses.startsWith("actions/setup-node@"));
    });
    it("has an immutable SHA pin", () => {
        const sha = step.uses.split("@")[1];
        assert.match(sha, SHA_RE, `Expected 40-char SHA, got "${sha}"`);
    });
    it("sets node-version from inputs", () => {
        const with_ = step.with;
        assert.ok(with_);
        assert.equal(with_["node-version"], "${{ inputs.node-version }}");
    });
    it("does not enable npm caching (prevents cache poisoning — zizmor finding)", () => {
        const with_ = step.with;
        assert.ok(with_);
        // cache: 'npm' is intentionally absent — setup-node's built-in npm cache
        // caches node_modules which are later executed, creating a cache poisoning
        // vector flagged by zizmor. npm ci is fast enough without caching.
        assert.equal(with_["cache"], undefined);
    });
    it("passes registry-url from inputs", () => {
        const with_ = step.with;
        assert.ok(with_);
        assert.equal(with_["registry-url"], "${{ inputs.registry-url }}");
    });
});
describe("composite action schema — step 2: install dependencies", () => {
    const action = loadAction();
    const steps = action.runs
        .steps;
    const step = steps[1];
    it("has a descriptive name", () => {
        assert.equal(typeof step.name, "string");
        assert.ok(step.name.toLowerCase().includes("install"));
    });
    it("runs npm ci", () => {
        assert.equal(step.run, "npm ci");
    });
    it("uses bash shell (required for composite actions)", () => {
        assert.equal(step.shell, "bash");
    });
});
describe("composite action schema — security", () => {
    const action = loadAction();
    const steps = action.runs
        .steps;
    it("every `uses:` reference is pinned to an immutable SHA", () => {
        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            if (!s.uses)
                continue; // `run:` steps don't have `uses:`
            const uses = s.uses;
            const sha = uses.split("@")[1];
            assert.ok(sha && SHA_RE.test(sha), `Step ${i + 1} ("${s.name || "unnamed"}") uses "${uses}" which is not pinned to a 40-char SHA`);
        }
    });
    it("no step uses a mutable tag reference (e.g., @v1, @latest)", () => {
        const TAG_RE = /@v?\d+(\.\d+)*$/;
        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            if (!s.uses)
                continue;
            assert.doesNotMatch(s.uses, TAG_RE, `Step ${i + 1} uses a mutable tag reference: ${s.uses}`);
        }
    });
});
//# sourceMappingURL=action-schema.test.js.map