import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { confirmGate, readGate } from '../src/gates.js';
import { createRuntime } from '../src/runtime.js';

function makeProject(paradigm = 'L1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-guard-'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.specgate', 'gates'), { recursive: true });
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'add-login'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'config.yaml'),
    `version: 1\nenabled: true\nenforcement: hybrid\nparadigm: ${paradigm}\n`,
  );
  fs.writeFileSync(
    path.join(root, 'openspec', 'changes', 'add-login', 'proposal.md'),
    '## Intent\nx\n## Scope\ny\n',
  );
  return root;
}

function fakeRuntime(root) {
  const ctx = { get: () => undefined, tools: {} };
  const runtime = createRuntime(ctx, {});
  runtime.lastCwd = root;
  return runtime;
}

function writeExec(root, relative) {
  return {
    name: 'write',
    arguments: { file_path: path.join(root, relative) },
    agent: null,
  };
}

test('design write is blocked until G3 is confirmed', () => {
  const root = makeProject('L1');
  const runtime = fakeRuntime(root);
  const exec = writeExec(root, 'openspec/changes/add-login/design.md');

  const blocked = runtime.checkWrite(exec);
  assert.equal(typeof blocked, 'string');
  assert.match(blocked, /G3/);

  confirmGate(root, 'G1');
  confirmGate(root, 'G2');
  confirmGate(root, 'G3');
  assert.equal(runtime.checkWrite(exec), undefined);
});

test('source write is allowed when no active change exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-guard-empty-'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.specgate', 'gates'), { recursive: true });
  fs.mkdirSync(path.join(root, 'openspec', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'config.yaml'),
    'version: 1\nenabled: true\nenforcement: hybrid\nparadigm: L1\n',
  );
  const runtime = fakeRuntime(root);
  assert.equal(runtime.checkWrite(writeExec(root, 'src/index.js')), undefined);
});

test('L3 source write requires G2/G6/G7 but not G1/G3/G4/G5', () => {
  const root = makeProject('L3');
  const runtime = fakeRuntime(root);
  const exec = writeExec(root, 'src/login.ts');

  const blocked = runtime.checkWrite(exec);
  assert.equal(typeof blocked, 'string');
  assert.match(blocked, /G2/);
  assert.match(blocked, /G6/);
  assert.match(blocked, /G7/);
  assert.equal(blocked.includes('G3 '), false);

  confirmGate(root, 'G2');
  confirmGate(root, 'G6');
  confirmGate(root, 'G7');
  assert.equal(runtime.checkWrite(exec), undefined);
});

test('afterWrite invalidates the downstream gate chain', () => {
  const root = makeProject('L1');
  const runtime = fakeRuntime(root);
  for (const gate of ['G1', 'G2', 'G3', 'G4', 'G5']) confirmGate(root, gate);

  runtime.afterWrite(writeExec(root, 'openspec/changes/add-login/proposal.md'));
  assert.equal(readGate(root, 'G3').confirmed, false);
  assert.equal(readGate(root, 'G4').confirmed, false);
  assert.equal(readGate(root, 'G5').confirmed, false);
  assert.equal(readGate(root, 'G1').confirmed, true);
});

test('classifyWrite identifies artifacts, tests and source', () => {
  const root = makeProject('L1');
  const runtime = fakeRuntime(root);
  assert.equal(runtime.classifyWrite('openspec/changes/x/proposal.md').kind, 'proposal');
  assert.equal(runtime.classifyWrite('openspec/changes/x/design.md').kind, 'design');
  assert.equal(runtime.classifyWrite('openspec/changes/x/specs/login/spec.md').kind, 'specs');
  assert.equal(runtime.classifyWrite('openspec/changes/x/tasks.md').kind, 'tasks');
  assert.equal(runtime.classifyWrite('src/login.test.ts').kind, 'test');
  assert.equal(runtime.classifyWrite('src/login.ts').kind, 'source');
  assert.equal(runtime.classifyWrite('TEST_REPORT.md').kind, null);
  assert.equal(runtime.classifyWrite('tests/readme.md').kind, null);
  assert.equal(runtime.classifyWrite('.specgate/config.yaml').kind, null);
});

test('checking off tasks does not invalidate G6; adding a task does', () => {
  const root = makeProject('L1');
  const change = path.join(root, 'openspec', 'changes', 'add-login');
  fs.writeFileSync(path.join(change, 'design.md'), '## Architecture\nx\n## Technical Approach\ny\n');
  fs.mkdirSync(path.join(change, 'specs', 'login'), { recursive: true });
  fs.writeFileSync(path.join(change, 'specs', 'login', 'spec.md'), '## Requirements\n\nScenario: login\n');
  const tasksPath = path.join(change, 'tasks.md');
  fs.writeFileSync(tasksPath, '- [ ] one\n- [ ] two\n');
  for (const gate of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']) confirmGate(root, gate);

  const runtime = fakeRuntime(root);
  const exec = writeExec(root, 'openspec/changes/add-login/tasks.md');
  assert.equal(runtime.checkWrite(exec), undefined);

  fs.writeFileSync(tasksPath, '- [x] one\n- [x] two\n');
  runtime.afterWrite(exec);
  assert.equal(readGate(root, 'G6').confirmed, true);

  runtime.checkWrite(exec);
  fs.writeFileSync(tasksPath, '- [x] one\n- [x] two\n- [ ] three\n');
  runtime.afterWrite(exec);
  assert.equal(readGate(root, 'G6').confirmed, false);
});
