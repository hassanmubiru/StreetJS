// packages/cli/src/tests/argv.test.ts
// Unit tests for the argument parser.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { argvParser } from '../argv.js';
void describe('argvParser', () => {
    void it('parses a simple command with no flags or args', () => {
        const result = argvParser(['node', 'street', 'create']);
        assert.equal(result.command, 'create');
        assert.deepEqual(result.positional, []);
        assert.deepEqual(result.flags, {});
    });
    void it('parses a command with positional arguments', () => {
        const result = argvParser(['node', 'street', 'create', 'my-app']);
        assert.equal(result.command, 'create');
        assert.deepEqual(result.positional, ['my-app']);
        assert.deepEqual(result.flags, {});
    });
    void it('parses long --flag=value syntax', () => {
        const result = argvParser(['node', 'street', 'generate', '--type=controller', 'users']);
        assert.equal(result.command, 'generate');
        assert.deepEqual(result.positional, ['users']);
        assert.equal(result.flags['type'], 'controller');
    });
    void it('parses long --flag value syntax', () => {
        const result = argvParser(['node', 'street', 'dev', '--port', '4000']);
        assert.equal(result.command, 'dev');
        assert.deepEqual(result.positional, []);
        assert.equal(result.flags['port'], '4000');
    });
    void it('parses long --flag as boolean (no next value)', () => {
        const result = argvParser(['node', 'street', 'create', 'app', '--install']);
        assert.equal(result.command, 'create');
        assert.equal(result.flags['install'], true);
    });
    void it('parses short -f value syntax', () => {
        const result = argvParser(['node', 'street', 'start', '-p', '8080']);
        assert.equal(result.command, 'start');
        assert.equal(result.flags['p'], '8080');
    });
    void it('parses short -f as boolean (no next value)', () => {
        const result = argvParser(['node', 'street', 'dev', '-v']);
        assert.equal(result.command, 'dev');
        assert.equal(result.flags['v'], true);
    });
    void it('parses multiple positional arguments after the command', () => {
        const result = argvParser(['node', 'street', 'generate', 'controller', 'users']);
        assert.equal(result.command, 'generate');
        assert.deepEqual(result.positional, ['controller', 'users']);
    });
    void it('parses subcommands with hyphens', () => {
        const result = argvParser(['node', 'street', 'migrate:create', 'add_users_table']);
        assert.equal(result.command, 'migrate:create');
        assert.deepEqual(result.positional, ['add_users_table']);
    });
    void it('parses a mix of flags and positional args', () => {
        const result = argvParser([
            'node', 'street', 'generate', 'controller', 'team',
            '--dry-run', '-f',
        ]);
        assert.equal(result.command, 'generate');
        assert.deepEqual(result.positional, ['controller', 'team']);
        assert.equal(result.flags['dry-run'], true);
        assert.equal(result.flags['f'], true);
    });
    void it('handles empty args (just node and script)', () => {
        const result = argvParser(['node', 'street']);
        assert.equal(result.command, null);
        assert.deepEqual(result.positional, []);
        assert.deepEqual(result.flags, {});
    });
    void it('handles --version flag', () => {
        const result = argvParser(['node', 'street', '--version']);
        assert.equal(result.command, null);
        assert.equal(result.flags['version'], true);
    });
    void it('handles -v flag', () => {
        const result = argvParser(['node', 'street', '-v']);
        assert.equal(result.command, null);
        assert.equal(result.flags['v'], true);
    });
    void it('handles --help flag', () => {
        const result = argvParser(['node', 'street', '--help']);
        assert.equal(result.command, null);
        assert.equal(result.flags['help'], true);
    });
    void it('treats -- as end-of-options separator', () => {
        const result = argvParser(['node', 'street', '--', 'create']);
        assert.equal(result.command, null);
        assert.deepEqual(result.flags, {});
        assert.deepEqual(result.positional, ['create']);
    });
    void it('preserves everything after -- as positional, even flag-like tokens', () => {
        const result = argvParser(['node', 'street', 'cmd', '--', '--flag', 'value']);
        assert.equal(result.command, 'cmd');
        assert.deepEqual(result.positional, ['--flag', 'value']);
    });
    void it('parses numeric flag values as strings', () => {
        const result = argvParser(['node', 'street', 'build', '--parallel', '4']);
        assert.equal(result.flags['parallel'], '4');
        assert.equal(typeof result.flags['parallel'], 'string');
    });
    void it('resolves first non-flag token as command even when flags precede it', () => {
        const result = argvParser(['node', 'street', '--verbose', 'create', 'app']);
        assert.equal(result.command, 'create');
        assert.equal(result.flags['verbose'], true);
        assert.deepEqual(result.positional, ['app']);
    });
});
//# sourceMappingURL=argv.test.js.map