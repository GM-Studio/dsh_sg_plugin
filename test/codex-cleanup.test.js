import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanupArchivedWorkspaces } from '../src/codex/cleanup.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repository(t) {
  const root = temp(t);
  git(root, ['init', '-q']);
  fs.writeFileSync(path.join(root, 'README.md'), 'baseline\n');
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@local',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'baseline',
  ]);
  return root;
}

test('successful cleanup removes archived worktrees, temporary files and role branches only', (t) => {
  const root = repository(t);
  const worktree = path.join(root, '.specgate/codex/worktrees/change-1/frontend');
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  git(root, ['worktree', 'add', '-q', '-b', 'sg/codex/change-1/frontend', worktree, 'HEAD']);
  fs.mkdirSync(path.join(root, '.specgate/codex/changes/change-1/tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, '.specgate/codex/changes/change-1/tmp/scratch.txt'), 'temp');
  fs.mkdirSync(path.join(root, '.specgate/codex/changes/change-1/evidence'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate/codex/changes/change-1/evidence/keep.log'),
    'evidence',
  );
  fs.mkdirSync(path.join(root, '.specgate/codex/archive/change-1'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate/codex/archive/change-1/report.json'),
    '{"ok":true}\n',
  );

  const result = cleanupArchivedWorkspaces({ projectRoot: root, changeId: 'change-1' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.existsSync(worktree), false);
  assert.equal(fs.existsSync(path.join(root, '.specgate/codex/worktrees/change-1')), false);
  assert.equal(fs.existsSync(path.join(root, '.specgate/codex/changes/change-1/tmp')), false);
  assert.equal(
    fs.existsSync(path.join(root, '.specgate/codex/changes/change-1/evidence/keep.log')),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(root, '.specgate/codex/archive/change-1/report.json')),
    true,
  );
  assert.equal(git(root, ['branch', '--list', 'sg/codex/change-1/frontend']), '');
  assert.doesNotMatch(git(root, ['worktree', 'list', '--porcelain']), /change-1\/frontend/);
});

test('unsafe change ids and source repository cleanup fail closed', (t) => {
  const root = repository(t);
  assert.equal(
    cleanupArchivedWorkspaces({ projectRoot: root, changeId: '../escape' }).code,
    'INVALID_CHANGE_ID',
  );
  assert.equal(
    cleanupArchivedWorkspaces({ projectRoot: process.cwd(), changeId: 'change-1' }).code,
    'SOURCE_REPOSITORY_FORBIDDEN',
  );
});

test('cleanup is idempotent when no temporary workspace exists', (t) => {
  const root = repository(t);
  const first = cleanupArchivedWorkspaces({ projectRoot: root, changeId: 'missing-change' });
  const second = cleanupArchivedWorkspaces({ projectRoot: root, changeId: 'missing-change' });
  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  assert.deepEqual(first.removedWorktrees, []);
  assert.deepEqual(first.removedBranches, []);
});
