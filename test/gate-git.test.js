import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { performGateAction } from '../src/gate-actions.js';
import { gitAddAndCommit, gitStatus } from '../src/git.js';
import { initProject } from '../src/init.js';
import { loadProject } from '../src/project.js';

process.env.GIT_AUTHOR_NAME = 'SpecGate Test';
process.env.GIT_AUTHOR_EMAIL = 'specgate-test@example.com';
process.env.GIT_COMMITTER_NAME = 'SpecGate Test';
process.env.GIT_COMMITTER_EMAIL = 'specgate-test@example.com';

function ctxAnswering(selected) {
  return {
    get(name) {
      if (name !== 'userQuestions') return undefined;
      return {
        async ask() {
          return { answers: [{ id: 'sg-gate', selected: [selected] }] };
        },
      };
    },
  };
}

function makeProject(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-gate-git-'));
  initProject(root, { minimal: true, ...options });
  return root;
}

test('gate confirm requires a clean working tree', async () => {
  const root = makeProject();
  assert.equal(gitStatus(root).dirty, 0);

  const first = await performGateAction(ctxAnswering('通过'), null, undefined, root, {
    gate: 'G1',
    action: 'confirm',
  });
  assert.equal(first.ok, true);
  assert.equal(gitStatus(root).dirty, 1);

  const blocked = await performGateAction(ctxAnswering('通过'), null, undefined, root, {
    gate: 'G2',
    action: 'confirm',
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.text, /未提交/);

  const commit = gitAddAndCommit(root, 'chore: confirm G1');
  assert.equal(commit.committed, true);

  const second = await performGateAction(ctxAnswering('通过'), null, undefined, root, {
    gate: 'G2',
    action: 'confirm',
  });
  assert.equal(second.ok, true);
});

test('--no-git gate confirmation proceeds with a warning', async () => {
  const root = makeProject({ git: false });
  assert.equal(loadProject(root).gitEnabled, false);

  const result = await performGateAction(ctxAnswering('通过'), null, undefined, root, {
    gate: 'G1',
    action: 'confirm',
  });
  assert.equal(result.ok, true);
  assert.match(result.text, /提交纪律未生效/);
});

test('waive also requires a clean working tree', async () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'dirty.txt'), 'x\n');

  const result = await performGateAction(ctxAnswering('确认跳过'), null, undefined, root, {
    gate: 'G4',
    action: 'waive',
    reason: '测试跳过',
  });
  assert.equal(result.ok, false);
  assert.match(result.text, /未提交/);
});
