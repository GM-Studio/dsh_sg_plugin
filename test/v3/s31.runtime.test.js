import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject, readConfig } from '../../src/v3/change.js';
import { load } from '../../src/v3/state.js';
import { runOneSuite, persistRuntime } from '../../src/v3/suites.js';
import { nodeDirCandidates } from '../../src/v3/env/node.js';
import { renderStatus } from '../../src/v3/status.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-runtime-'));
}

test('runOneSuite 记录 Node 版本、安装状态与上次结果', (t) => {
  const has18 = nodeDirCandidates(process.env).some((item) => String(item.version).startsWith('18.'));
  if (!has18) {
    t.skip('本机没有 Node 18');
    return;
  }
  const root = tempRoot();
  initProject(root);
  fs.writeFileSync(path.join(root, 'a.js'), '', 'utf8');
  fs.writeFileSync(
    path.join(root, 'reporter.mjs'),
    `import fs from 'node:fs';
fs.writeFileSync(process.env.SG_REPORT, JSON.stringify({
  schemaVersion: 1,
  cases: [{ id: 'TC-001', ac: ['AC-001'], status: 'pass', file: 'a.js' }],
}));
`,
    'utf8',
  );
  const suite = {
    id: 'api',
    kind: 'node-test',
    argv: [process.execPath, 'reporter.mjs'],
    cwd: '.',
    node: '18',
    install: null,
  };
  const result = runOneSuite({
    suite,
    root,
    worktree: root,
    acs: new Set(['AC-001']),
    plan: { mapping: { requirements: [{ ac: 'AC-001', suite: 'api' }] } },
    knownAcs: new Set(['AC-001']),
    changedFiles: ['a.js'],
    requireChangedFiles: true,
  });
  assert.equal(result.ok, true, result.message);
  assert.match(result.runtime.node.version, /^18\./);
  assert.equal(result.runtime.install.state, 'skipped');
  assert.equal(result.runtime.lastRun.ok, true);

  const saved = persistRuntime(root, [result]);
  assert.equal(saved.ok, true);
  const state = load(root).state;
  assert.match(state.runtime.suites.api.node.version, /^18\./);
  const text = renderStatus({ root, state, config: readConfig(root) });
  assert.match(text, /运行时 api：Node 18/);
});
