import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { gitSafeDirectory } from '../src/codex/git-path.js';

test('Git safe.directory paths use forward slashes on Windows', () => {
  const windowsRoot = 'E:\\ai_workflow\\specgate-pilots\\project';
  assert.equal(gitSafeDirectory(windowsRoot), 'E:/ai_workflow/specgate-pilots/project');
});

test('Git safe.directory paths preserve absolute POSIX roots', () => {
  assert.equal(gitSafeDirectory('/srv/specgate/project'), '/srv/specgate/project');
  assert.equal(gitSafeDirectory(path.resolve('.')), path.resolve('.').replaceAll(path.sep, '/'));
});
