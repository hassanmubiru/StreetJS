// src/tests/config.test.ts
// Unit tests for the Configuration Validation Engine (defineConfig / ConfigValidationError).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineConfig, ConfigValidationError, } from '../config/validator.js';
// ── Helpers ───────────────────────────────────────────────────────────────────
/** Save and restore env vars manipulated during a test. */
function withEnv(vars, fn) {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) {
        saved[k] = process.env[k];
        if (v === undefined) {
            delete process.env[k];
        }
        else {
            process.env[k] = v;
        }
    }
    try {
        fn();
    }
    finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) {
                delete process.env[k];
            }
            else {
                process.env[k] = v;
            }
        }
    }
}
const TEST_KEY = 'STREET_TEST_CFG_';
// ── Tests ─────────────────────────────────────────────────────────────────────
describe('ConfigValidationError', () => {
    it('is an instance of Error', () => {
        const err = new ConfigValidationError(['oops']);
        assert.ok(err instanceof Error);
        assert.ok(err instanceof ConfigValidationError);
    });
    it('stores the errors array', () => {
        const msgs = ['field A is bad', 'field B is bad'];
        const err = new ConfigValidationError(msgs);
        assert.deepEqual(err.errors, msgs);
    });
    it('includes all error messages in the Error message', () => {
        const err = new ConfigValidationError(['err1', 'err2']);
        assert.ok(err.message.includes('err1'));
        assert.ok(err.message.includes('err2'));
    });
});
describe('defineConfig — missing required field', () => {
    it('throws ConfigValidationError when a required field is absent', () => {
        const key = `${TEST_KEY}REQUIRED`;
        withEnv({ [key]: undefined }, () => {
            assert.throws(() => defineConfig({
                [key]: { type: 'string', required: true },
            }), (err) => {
                assert.ok(err instanceof ConfigValidationError);
                assert.ok(err.errors.length >= 1);
                assert.ok(err.errors.some((e) => e.includes(key)), `expected error mentioning "${key}", got: ${JSON.stringify(err.errors)}`);
                return true;
            });
        });
    });
});
describe('defineConfig — invalid port range', () => {
    it('throws for port value 99999 (above 65535)', () => {
        const key = `${TEST_KEY}PORT`;
        withEnv({ [key]: '99999' }, () => {
            assert.throws(() => defineConfig({ [key]: { type: 'port' } }), (err) => {
                assert.ok(err instanceof ConfigValidationError);
                assert.ok(err.errors.some((e) => e.includes(key)));
                return true;
            });
        });
    });
    it('throws for port value 0 (below 1)', () => {
        const key = `${TEST_KEY}PORT`;
        withEnv({ [key]: '0' }, () => {
            assert.throws(() => defineConfig({ [key]: { type: 'port' } }), (err) => {
                assert.ok(err instanceof ConfigValidationError);
                return true;
            });
        });
    });
    it('accepts a valid port (e.g. 3000)', () => {
        const key = `${TEST_KEY}PORT`;
        withEnv({ [key]: '3000' }, () => {
            const cfg = defineConfig({ [key]: { type: 'port' } });
            assert.equal(cfg[key], 3000);
        });
    });
});
describe('defineConfig — malformed URL', () => {
    it('throws for a non-URL value', () => {
        const key = `${TEST_KEY}URL`;
        withEnv({ [key]: 'not-a-url' }, () => {
            assert.throws(() => defineConfig({ [key]: { type: 'url' } }), (err) => {
                assert.ok(err instanceof ConfigValidationError);
                assert.ok(err.errors.some((e) => e.includes(key)));
                return true;
            });
        });
    });
    it('accepts a valid HTTP URL', () => {
        const key = `${TEST_KEY}URL`;
        withEnv({ [key]: 'https://example.com' }, () => {
            const cfg = defineConfig({ [key]: { type: 'url' } });
            assert.equal(cfg[key], 'https://example.com');
        });
    });
});
describe('defineConfig — default applied when var is absent', () => {
    it('uses the default value when the env var is not set', () => {
        const key = `${TEST_KEY}WITH_DEFAULT`;
        withEnv({ [key]: undefined }, () => {
            const cfg = defineConfig({
                [key]: { type: 'number', default: 42 },
            });
            assert.equal(cfg[key], 42);
        });
    });
    it('uses a string default', () => {
        const key = `${TEST_KEY}WITH_DEFAULT_STR`;
        withEnv({ [key]: undefined }, () => {
            const cfg = defineConfig({
                [key]: { type: 'string', default: 'fallback' },
            });
            assert.equal(cfg[key], 'fallback');
        });
    });
    it('uses a boolean default', () => {
        const key = `${TEST_KEY}WITH_DEFAULT_BOOL`;
        withEnv({ [key]: undefined }, () => {
            const cfg = defineConfig({
                [key]: { type: 'boolean', default: false },
            });
            assert.equal(cfg[key], false);
        });
    });
});
describe('defineConfig — present-but-invalid value errors even with a default', () => {
    it('throws when an invalid port is set even though a default exists', () => {
        const key = `${TEST_KEY}PORT_WITH_DEFAULT`;
        withEnv({ [key]: '99999' }, () => {
            assert.throws(() => defineConfig({
                [key]: { type: 'port', default: 3000 },
            }), (err) => {
                assert.ok(err instanceof ConfigValidationError);
                assert.ok(err.errors.some((e) => e.includes(key)));
                return true;
            });
        });
    });
    it('throws when an invalid URL is set even though a default exists', () => {
        const key = `${TEST_KEY}URL_WITH_DEFAULT`;
        withEnv({ [key]: 'not-a-url' }, () => {
            assert.throws(() => defineConfig({
                [key]: { type: 'url', default: 'https://fallback.example.com' },
            }), (err) => {
                assert.ok(err instanceof ConfigValidationError);
                return true;
            });
        });
    });
    it('throws when an invalid number is set even though a default exists', () => {
        const key = `${TEST_KEY}NUM_WITH_DEFAULT`;
        withEnv({ [key]: 'not-a-number' }, () => {
            assert.throws(() => defineConfig({
                [key]: { type: 'number', default: 100 },
            }), (err) => {
                assert.ok(err instanceof ConfigValidationError);
                return true;
            });
        });
    });
});
describe('defineConfig — multi-error collection', () => {
    it('collects all errors before throwing (multiple bad fields → single throw)', () => {
        const keyA = `${TEST_KEY}MULTI_A`;
        const keyB = `${TEST_KEY}MULTI_B`;
        const keyC = `${TEST_KEY}MULTI_C`;
        withEnv({ [keyA]: '99999', [keyB]: 'bad-url', [keyC]: undefined }, () => {
            assert.throws(() => defineConfig({
                [keyA]: { type: 'port' },
                [keyB]: { type: 'url' },
                [keyC]: { type: 'string', required: true },
            }), (err) => {
                assert.ok(err instanceof ConfigValidationError);
                // All 3 fields must produce an error in a single throw
                assert.equal(err.errors.length, 3, `expected 3 errors, got ${err.errors.length}: ${JSON.stringify(err.errors)}`);
                assert.ok(err.errors.some((e) => e.includes(keyA)));
                assert.ok(err.errors.some((e) => e.includes(keyB)));
                assert.ok(err.errors.some((e) => e.includes(keyC)));
                return true;
            });
        });
    });
});
describe('defineConfig — type coercion', () => {
    it('coerces string env var to number', () => {
        const key = `${TEST_KEY}NUM`;
        withEnv({ [key]: '42' }, () => {
            const cfg = defineConfig({ [key]: { type: 'number' } });
            assert.equal(cfg[key], 42);
            assert.equal(typeof cfg[key], 'number');
        });
    });
    it('coerces "true" to boolean true', () => {
        const key = `${TEST_KEY}BOOL`;
        withEnv({ [key]: 'true' }, () => {
            const cfg = defineConfig({ [key]: { type: 'boolean' } });
            assert.equal(cfg[key], true);
        });
    });
    it('coerces "false" to boolean false', () => {
        const key = `${TEST_KEY}BOOL`;
        withEnv({ [key]: 'false' }, () => {
            const cfg = defineConfig({ [key]: { type: 'boolean' } });
            assert.equal(cfg[key], false);
        });
    });
});
describe('defineConfig — number min/max', () => {
    it('throws when number is below min', () => {
        const key = `${TEST_KEY}MINMAX`;
        withEnv({ [key]: '5' }, () => {
            assert.throws(() => defineConfig({ [key]: { type: 'number', min: 10 } }), (err) => {
                assert.ok(err instanceof ConfigValidationError);
                return true;
            });
        });
    });
    it('throws when number exceeds max', () => {
        const key = `${TEST_KEY}MINMAX`;
        withEnv({ [key]: '200' }, () => {
            assert.throws(() => defineConfig({ [key]: { type: 'number', max: 100 } }), (err) => {
                assert.ok(err instanceof ConfigValidationError);
                return true;
            });
        });
    });
});
//# sourceMappingURL=config.test.js.map