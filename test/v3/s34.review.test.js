import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../../src/v3/util/git.js';
import {
  collectDiff,
  validateReview,
  createReviewWorktree,
  removeReviewWorktree,
} from '../../src/v3/review.js';

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v34-review-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'a@b.c']);
  git(root, ['config', 'user.name', 'a']);
  fs.writeFileSync(path.join(root, 'a.js'), 'one\n', 'utf8');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  return root;
}

test('collectDiff 返回文件清单与 diff，validateReview 校验证据', () => {
  const root = repo();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'a.js'), 'one\ntwo\n', 'utf8');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'change']);
  const head = git(root, ['rev-parse', 'HEAD']);

  const diff = collectDiff({ cwd: root, base, head });
  assert.ok(diff.text.includes('+two'));
  assert.equal(diff.files[0].file, 'a.js');
  assert.equal(diff.truncated, false);

  const good = validateReview(
    {
      verdict: 'fail',
      blocking: [{ file: 'a.js', line: 2, evidence: '+two', reason: '缺测试' }],
    },
    diff,
  );
  assert.equal(good.ok, true, good.errors.join('; '));

  const badFile = validateReview(
    { verdict: 'fail', blocking: [{ file: 'b.js', line: 2, evidence: '+two', reason: 'x' }] },
    diff,
  );
  assert.equal(badFile.ok, false);
  assert.match(badFile.errors.join('; '), /不在 diff 文件清单/);

  const badEvidence = validateReview(
    { verdict: 'fail', blocking: [{ file: 'a.js', line: 2, evidence: '不存在', reason: 'x' }] },
    diff,
  );
  assert.equal(badEvidence.ok, true);
  assert.match(badEvidence.warnings.join('; '), /未精确匹配/);
});

test('review worktree 创建后可删除', () => {
  const root = repo();
  const head = git(root, ['rev-parse', 'HEAD']);
  const created = createReviewWorktree({ root, change: 'demo', commit: head });
  assert.equal(created.ok, true, created.message);
  assert.ok(fs.existsSync(created.path));
  removeReviewWorktree({ root, path: created.path });
  assert.equal(fs.existsSync(created.path), false);
});
