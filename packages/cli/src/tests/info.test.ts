// packages/cli/src/tests/info.test.ts
// Unit tests for InfoCommand, DoctorCommand, and AuditCommand.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { InfoCommand } from '../commands/info.js';
import { DoctorCommand } from '../commands/doctor.js';
import { AuditCommand } from '../commands/audit.js';

// ── Utilities ─────────────────────────────────────────────────────────────────

interface CapturedOutput {
  logs: string[];
  errors: string[];
}

function captureConsole(): { output: CapturedOutput; restore: () => void } {
  const output: CapturedOutput = { logs: [], errors: [] };
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => { output.logs.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { output.errors.push(args.join(' ')); };
  return {
    output,
    restore: () => {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

function makeContext(cwd: string) {
  return {
    cwd,
    args: { command: 'info', positional: [], flags: {} },
  };
}

// ── InfoCommand ───────────────────────────────────────────────────────────────

void describe('InfoCommand', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'street-info-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  void it('reads Street version from node_modules/@streetjs/core/package.json', async () => {
    const corePkgDir = join(tmpDir, 'node_modules', '@streetjs', 'core');
    mkdirSync(corePkgDir, { recursive: true });
    writeFileSync(join(corePkgDir, 'package.json'), JSON.stringify({ name: '@streetjs/core', version: '2.3.4' }));

    const { output, restore } = captureConsole();
    const cmd = new InfoCommand();
    try {
      await cmd.execute(makeContext(tmpDir));
    } finally {
      restore();
    }

    const allOutput = output.logs.join('\n');
    assert.ok(allOutput.includes('v2.3.4'), `Expected Street version v2.3.4 in output:\n${allOutput}`);
  });

  void it('reads Node.js version from process.version', async () => {
    const { output, restore } = captureConsole();
    const cmd = new InfoCommand();
    try {
      await cmd.execute(makeContext(tmpDir));
    } finally {
      restore();
    }

    const allOutput = output.logs.join('\n');
    assert.ok(
      allOutput.includes(process.version),
      `Expected Node.js version ${process.version} in output:\n${allOutput}`,
    );
  });

  void it('detects TypeScript version from node_modules/typescript/package.json', async () => {
    // Use a fresh temp dir to isolate TypeScript resolution
    const tsTestDir = mkdtempSync(join(tmpdir(), 'street-info-ts-'));
    try {
      const tsPkgDir = join(tsTestDir, 'node_modules', 'typescript');
      mkdirSync(tsPkgDir, { recursive: true });
      writeFileSync(join(tsPkgDir, 'package.json'), JSON.stringify({ name: 'typescript', version: '5.4.0' }));

      const { output, restore } = captureConsole();
      const cmd = new InfoCommand();
      try {
        await cmd.execute(makeContext(tsTestDir));
      } finally {
        restore();
      }

      const allOutput = output.logs.join('\n');
      assert.ok(allOutput.includes('v5.4.0'), `Expected TypeScript v5.4.0 in output:\n${allOutput}`);
    } finally {
      rmSync(tsTestDir, { recursive: true, force: true });
    }
  });

  void it('falls back to (not found) when TypeScript is not installed', async () => {
    // Use a fresh empty temp dir with no TypeScript in node_modules
    const emptyDir = mkdtempSync(join(tmpdir(), 'street-info-nots-'));
    try {
      const { output, restore } = captureConsole();
      const cmd = new InfoCommand();
      try {
        await cmd.execute(makeContext(emptyDir));
      } finally {
        restore();
      }

      const allOutput = output.logs.join('\n');
      assert.ok(
        allOutput.includes('(not found)'),
        `Expected '(not found)' when TypeScript is absent:\n${allOutput}`,
      );
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  void it('prints an aligned table (all labels padded to the same width)', async () => {
    const { output, restore } = captureConsole();
    const cmd = new InfoCommand();
    try {
      await cmd.execute(makeContext(tmpDir));
    } finally {
      restore();
    }

    // Each data row has the form: '  <label.padEnd(labelWidth)><value>'
    // Filter rows that look like table entries: start with two spaces + a non-space char,
    // and are not the header / blank lines.
    const dataRows = output.logs.filter((l) =>
      /^ {2}\S/.test(l) && !l.includes('Street Framework') && l.trim() !== '',
    );
    assert.ok(dataRows.length >= 3, `Expected at least 3 table rows, got: ${dataRows.join(' | ')}`);

    // Find where each value starts. The format is:
    //   '  ' + label.padEnd(labelWidth) + value
    // labelWidth = maxLabelLength + 2, so the gap between label text and value
    // is always >=2 spaces. We locate the first run of >=2 consecutive spaces
    // to find where the value column begins.
    const twoSpaces = / {2,}/g;
    const valueStartCols = dataRows.map((row) => {
      // Reset lastIndex for global regex
      twoSpaces.lastIndex = 2; // start searching after the '  ' row prefix
      const m = twoSpaces.exec(row);
      if (!m) return -1;
      return m.index + m[0].length;
    });

    const uniqueCols = new Set(valueStartCols);
    assert.equal(
      uniqueCols.size, 1,
      `Expected all value columns to be aligned, got cols: ${valueStartCols.join(',')} for rows:\n${dataRows.join('\n')}`,
    );
  });

  void it('reads project name and version from package.json', async () => {
    const pkgData = { name: 'my-awesome-app', version: '3.1.4' };
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify(pkgData));

    const { output, restore } = captureConsole();
    const cmd = new InfoCommand();
    try {
      await cmd.execute(makeContext(tmpDir));
    } finally {
      restore();
    }

    const allOutput = output.logs.join('\n');
    assert.ok(allOutput.includes('my-awesome-app'), `Expected project name in output:\n${allOutput}`);
    assert.ok(allOutput.includes('3.1.4'), `Expected project version in output:\n${allOutput}`);
  });
});

// ── DoctorCommand ─────────────────────────────────────────────────────────────

void describe('DoctorCommand', () => {
  void it('detects old Node.js version (< 22) as a failure', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'street-doctor-old-'));
    // Temporarily override process.version to simulate Node 20 (now EOL, below the ≥22 baseline)
    const origVersion = process.version;
    Object.defineProperty(process, 'version', { value: 'v20.0.0', writable: true, configurable: true });
    process.exitCode = 0;

    const { restore } = captureConsole();
    try {
      const cmd = new DoctorCommand();
      await cmd.execute({ cwd: tmpDir, args: { command: 'doctor', positional: [], flags: {} } });
    } finally {
      restore();
      Object.defineProperty(process, 'version', { value: origVersion, writable: true, configurable: true });
      rmSync(tmpDir, { recursive: true, force: true });
    }

    assert.equal(process.exitCode, 1, 'Should set process.exitCode = 1 when Node.js < 22');
    process.exitCode = undefined;
  });

  void it('detects Node.js >= 22 as a pass (no exit code set by Node check)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'street-doctor-new-'));
    const origVersion = process.version;
    Object.defineProperty(process, 'version', { value: 'v22.0.0', writable: true, configurable: true });
    process.exitCode = 0;

    const { output, restore } = captureConsole();
    try {
      const cmd = new DoctorCommand();
      await cmd.execute({ cwd: tmpDir, args: { command: 'doctor', positional: [], flags: {} } });
    } finally {
      restore();
      Object.defineProperty(process, 'version', { value: origVersion, writable: true, configurable: true });
      rmSync(tmpDir, { recursive: true, force: true });
    }

    // The Node.js check line should contain a checkmark for v22
    const allOutput = output.logs.join('\n');
    assert.ok(
      allOutput.includes('v22.0.0') && allOutput.includes('✓'),
      `Expected v22.0.0 ✓ in doctor output:\n${allOutput}`,
    );
  });

  void it('detects missing TypeScript as a failure', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'street-doctor-nots-'));
    process.exitCode = 0;

    // Ensure current Node is >= 20 so only TS check can trigger the failure
    const origVersion = process.version;
    Object.defineProperty(process, 'version', { value: 'v22.0.0', writable: true, configurable: true });

    const { output, restore } = captureConsole();
    try {
      const cmd = new DoctorCommand();
      // Use an empty temp dir so TypeScript is not in node_modules
      await cmd.execute({ cwd: tmpDir, args: { command: 'doctor', positional: [], flags: {} } });
    } finally {
      restore();
      Object.defineProperty(process, 'version', { value: origVersion, writable: true, configurable: true });
      rmSync(tmpDir, { recursive: true, force: true });
    }

    const allOutput = output.logs.join('\n');
    assert.ok(
      allOutput.includes('not found') || allOutput.includes('install TypeScript'),
      `Expected TypeScript missing message in output:\n${allOutput}`,
    );
    assert.equal(process.exitCode, 1, 'Should set process.exitCode = 1 when TypeScript is missing');
    process.exitCode = undefined;
  });

  void it('skips env var check when no .env.example is present', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'street-doctor-noenv-'));
    process.exitCode = 0;

    const origVersion = process.version;
    Object.defineProperty(process, 'version', { value: 'v22.0.0', writable: true, configurable: true });

    const { output, restore } = captureConsole();
    try {
      const cmd = new DoctorCommand();
      await cmd.execute({ cwd: tmpDir, args: { command: 'doctor', positional: [], flags: {} } });
    } finally {
      restore();
      Object.defineProperty(process, 'version', { value: origVersion, writable: true, configurable: true });
      rmSync(tmpDir, { recursive: true, force: true });
    }

    const allOutput = output.logs.join('\n');
    assert.ok(
      allOutput.includes('skipped') || allOutput.includes('no .env.example'),
      `Expected 'skipped' note for missing .env.example:\n${allOutput}`,
    );
  });

  void it('sets process.exitCode = 1 when any check fails', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'street-doctor-exit-'));
    process.exitCode = 0;

    // Use v18 to guarantee a failure
    const origVersion = process.version;
    Object.defineProperty(process, 'version', { value: 'v18.0.0', writable: true, configurable: true });

    const { restore } = captureConsole();
    try {
      const cmd = new DoctorCommand();
      await cmd.execute({ cwd: tmpDir, args: { command: 'doctor', positional: [], flags: {} } });
    } finally {
      restore();
      Object.defineProperty(process, 'version', { value: origVersion, writable: true, configurable: true });
      rmSync(tmpDir, { recursive: true, force: true });
    }

    assert.equal(process.exitCode, 1, 'process.exitCode should be 1 when any check fails');
    process.exitCode = undefined;
  });
});

// ── AuditCommand ──────────────────────────────────────────────────────────────

/**
 * A testable subclass of AuditCommand that overrides runNpmAudit so we can
 * inject arbitrary JSON without spawning a real npm process.
 */
class MockAuditCommand extends AuditCommand {
  constructor(private readonly mockJson: string, private readonly mockCode: number = 0) {
    super();
  }

  override runNpmAudit(_cwd: string): Promise<string> {
    if (this.mockCode !== 0) {
      return Promise.reject({ output: this.mockJson, code: this.mockCode });
    }
    return Promise.resolve(this.mockJson);
  }
}

const AUDIT_WITH_VULNS = JSON.stringify({
  vulnerabilities: {
    lodash: {
      name: 'lodash',
      severity: 'high',
      via: [{ source: 1, name: 'lodash', dependency: 'lodash', title: 'Prototype Pollution', url: 'https://example.com', severity: 'high' }],
      fixAvailable: { name: 'lodash', version: '4.17.21' },
    },
    'some-lib': {
      name: 'some-lib',
      severity: 'critical',
      via: ['lodash'],
      fixAvailable: false,
    },
    'info-pkg': {
      name: 'info-pkg',
      severity: 'info',
      via: ['info-pkg'],
      fixAvailable: true,
    },
  },
  metadata: {
    vulnerabilities: { info: 1, low: 0, moderate: 0, high: 1, critical: 1, total: 3 },
  },
});

const AUDIT_NO_VULNS = JSON.stringify({
  vulnerabilities: {},
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
  },
});

void describe('AuditCommand', () => {
  void it('parses npm audit JSON output with known vulnerabilities and formats a table', async () => {
    process.exitCode = 0;
    const cmd = new MockAuditCommand(AUDIT_WITH_VULNS, 1);
    const { output, restore } = captureConsole();
    try {
      await cmd.execute({ cwd: '/tmp', args: { command: 'audit', positional: [], flags: {} } });
    } finally {
      restore();
    }

    const allOutput = output.logs.join('\n');
    assert.ok(allOutput.includes('lodash'), `Expected 'lodash' in table output:\n${allOutput}`);
    assert.ok(allOutput.includes('some-lib'), `Expected 'some-lib' in table output:\n${allOutput}`);
    assert.ok(allOutput.includes('high'), `Expected 'high' severity in output:\n${allOutput}`);
    assert.ok(allOutput.includes('critical'), `Expected 'critical' severity in output:\n${allOutput}`);
    process.exitCode = undefined;
  });

  void it('shows "No vulnerabilities found" when audit JSON has no vulnerabilities', async () => {
    process.exitCode = 0;
    const cmd = new MockAuditCommand(AUDIT_NO_VULNS, 0);
    const { output, restore } = captureConsole();
    try {
      await cmd.execute({ cwd: '/tmp', args: { command: 'audit', positional: [], flags: {} } });
    } finally {
      restore();
    }

    const allOutput = output.logs.join('\n');
    assert.ok(
      allOutput.includes('No vulnerabilities found'),
      `Expected 'No vulnerabilities found' in output:\n${allOutput}`,
    );
    assert.equal(process.exitCode, 0, 'exitCode should remain 0 when no vulnerabilities found');
  });

  void it('sorts findings by severity — critical before high before info', async () => {
    process.exitCode = 0;
    const cmd = new MockAuditCommand(AUDIT_WITH_VULNS, 1);
    const { output, restore } = captureConsole();
    try {
      await cmd.execute({ cwd: '/tmp', args: { command: 'audit', positional: [], flags: {} } });
    } finally {
      restore();
    }

    // Find the table rows (lines containing package names from our fixture)
    const rows = output.logs.filter((l) => l.includes('some-lib') || l.includes('lodash') || l.includes('info-pkg'));
    assert.ok(rows.length >= 2, `Expected at least 2 table rows, got: ${rows.join(' | ')}`);

    // critical (some-lib) should appear before high (lodash)
    const criticalIdx = rows.findIndex((l) => l.includes('some-lib'));
    const highIdx = rows.findIndex((l) => l.includes('lodash'));
    assert.ok(criticalIdx < highIdx, `Expected critical row before high row. Rows:\n${rows.join('\n')}`);
    process.exitCode = undefined;
  });

  void it('does not fail the process when vulnerabilities are found (CI gating is handled separately)', async () => {
    process.exitCode = 0;
    const cmd = new MockAuditCommand(AUDIT_WITH_VULNS, 1);
    const { restore } = captureConsole();
    try {
      await cmd.execute({ cwd: '/tmp', args: { command: 'audit', positional: [], flags: {} } });
    } finally {
      restore();
    }

    assert.notEqual(process.exitCode, 1, 'audit should print findings without failing the process');
    process.exitCode = undefined;
  });
});
