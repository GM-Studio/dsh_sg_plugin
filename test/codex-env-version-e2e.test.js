import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pickVersion, resolveNode } from '../src/codex/core/env/node.js';
import { satisfiesPython, ensureVenv } from '../src/codex/core/env/python.js';
import { assessTool } from '../src/codex/core/env/compatibility.js';
import { matchesVersion } from '../src/codex/core/env/version-range.js';
import { createEnvironmentService } from '../src/codex/core/environment.js';

const cases = [
  ['3.12.16', '==3.12', false],
  ['3.12.16', '!=3.12', true],
  ['0.9.0', '^0', true],
  ['0.0.9', '^0.0', true],
  ['22.22.0', '>=22.24.0', false],
  ['22.24.0', '>=22.24.0', true],
  ['3.12.16', '==3.11.9', false],
  ['3.11.9', '==3.11.9', true],
  ['3.12.16', '>=3.12.15, <3.13, !=3.12.17', true],
  ['3.12.16', '!=3.12.*', false],
  ['3.12.16', '~=3.12.10', true],
  ['22.23.0', '~22.22.0', false],
  ['0.2.4', '^0.2.3', true],
  ['0.3.0', '^0.2.3', false],
  ['22.22.0', '^22.24.0 || ^24.0.0', false],
  ['24.1.0', '^22.24.0 || ^24.0.0', true],
  ['22.22.0-rc.1', '>=22', false],
  ['22.22.0', '>=22 || nonsense', false],
  ['3.12.16', '==3.*.16', false],
  ['22.22.0', '>=22.*', false],
  ['3.12.16', '~=3', false],
  ['22.22.0', '>=22 ||', false],
];
test('all version entry points reject the audit counterexamples and unsupported syntax', () => {
  for (const [version, requirement, expected] of cases) {
    assert.equal(matchesVersion(version, requirement), expected, `${version} / ${requirement}`);
    assert.equal(
      Boolean(pickVersion(requirement, [version])),
      expected,
      `node ${version}/${requirement}`,
    );
    assert.equal(
      satisfiesPython(version, requirement),
      expected,
      `python ${version}/${requirement}`,
    );
  }
  assert.equal(pickVersion('>=22.24.0', ['22.22.0', '24.1.0', '22.24.0']), '24.1.0');
});
test('compatibility minimums compare complete release tuples and unreadable versions are unknown', () => {
  for (const [version, minimum, state] of [
    ['22.22.0', '22.24.0', 'incompatible'],
    ['3.9.9', '3.10.0', 'incompatible'],
    ['22.24.0', '22.24.0', 'compatible'],
    ['garbage', '22.24.0', 'unknown'],
  ]) {
    assert.equal(
      assessTool({
        tool: 'node',
        probe: { path: process.execPath, version, exitCode: 0 },
        requirement: { minVersion: minimum },
      }).state,
      state,
    );
  }
});
test('real current Node is executed for matching constraints and a higher patch is blocked', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-range-node-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = process.versions.node,
    parts = version.split('.').map(Number);
  const pass = resolveNode({ root, suite: { node: version } });
  assert.equal(pass.ok, true, JSON.stringify(pass));
  const run = spawnSync(process.execPath, ['-p', 'process.versions.node'], {
    encoding: 'utf8',
    env: pass.env,
    timeout: 10000,
  });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), version);
  const requirement = `>=${parts[0]}.${parts[1]}.${parts[2] + 1} <${parts[0]}.${parts[1] + 1}.0`;
  assert.equal(resolveNode({ root, suite: { node: requirement } }).ok, false);
  assert.deepEqual(fs.readdirSync(root), []);
});
test('real checked Python venv reuse rejects a different exact patch without modifying it', async (t) => {
  const parent = process.env.SPECGATE_E2E_EXECUTION_TEMP || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'sg-range-python-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));
  const service = createEnvironmentService({
    root,
    cacheRoot: process.env.SPECGATE_E2E_TOOLCHAIN_CACHE,
  });
  const ctx = await service.executionContext({ stack: 'python' });
  assert.equal(ctx.ok, true, JSON.stringify(ctx.report));
  const python = ctx.report.tools.python;
  assert.ok(python);
  const bin = python.python || python.path;
  const result = spawnSync(bin, ['-m', 'venv', '--without-pip', path.join(root, '.venv')], {
    encoding: 'utf8',
    env: ctx.env,
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const config = fs.readFileSync(path.join(root, '.venv/pyvenv.cfg'), 'utf8');
  const version = python.version;
  assert.equal(ensureVenv({ root, suite: { python: '==' + version }, env: ctx.env }).reused, true);
  const parts = version.split('.').map(Number);
  const wrong = `==${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  assert.equal(
    ensureVenv({ root, suite: { python: wrong }, env: ctx.env }).code,
    'PYTHON_VERSION_MISMATCH',
  );
  assert.equal(fs.readFileSync(path.join(root, '.venv/pyvenv.cfg'), 'utf8'), config);
});
