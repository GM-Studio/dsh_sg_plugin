import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  formatGitStatus,
  gitAddAndCommit,
  gitClean,
  gitInit,
  gitStatus,
  isGitRepo,
} from '../src/git.js';

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-git-'));
  gitInit(root);
  execFileSync('git', ['config', 'user.name', 'SpecGate Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'specgate-test@example.com'], { cwd: root });
  return root;
}

test('gitInit creates a repository and status reports branch', () => {
  const root = makeRepo();
  assert.equal(isGitRepo(root), true);
  assert.ok(fs.existsSync(path.join(root, '.git')));
  const status = gitStatus(root);
  assert.equal(status.isRepo, true);
  assert.equal(status.dirty, 0);
  assert.equal(status.lastCommit, null);
});

test('gitAddAndCommit commits changes and makes the tree clean', () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, 'README.md'), '# demo\n');
  const result = gitAddAndCommit(root, 'chore: init');
  assert.equal(result.committed, true);
  assert.equal(result.files, 1);
  assert.ok(result.hash);
  const status = gitStatus(root);
  assert.equal(status.dirty, 0);
  assert.match(status.lastCommit.subject, /chore: init/);
  assert.equal(gitClean(root).ok, true);
});

test('gitAddAndCommit reports no changes instead of creating an empty commit', () => {
  const root = makeRepo();
  const result = gitAddAndCommit(root, 'chore: empty');
  assert.equal(result.committed, false);
  assert.equal(result.reason, 'no changes');
});

test('gitClean reports dirty files and formatGitStatus summarizes', () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, 'dirty.txt'), 'x\n');
  const clean = gitClean(root);
  assert.equal(clean.ok, false);
  assert.equal(clean.code, 'GIT_DIRTY');
  const text = formatGitStatus(gitStatus(root));
  assert.match(text, /Git：/);
  assert.match(text, /dirty 1/);
});
