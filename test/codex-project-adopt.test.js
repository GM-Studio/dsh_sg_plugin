import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyAdoption, commitDirtyBaseline, previewAdoption } from '../src/codex/project-adopt.js';
import { loadProjectReadiness } from '../src/codex/project-state.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-project-adopt-'));
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
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function project(t, { commit = true } = {}) {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'pom.xml'), '<project/>\n');
  fs.writeFileSync(path.join(root, 'backend', 'legacy.java'), 'class Legacy {}\n');
  const packageRoot = path.join(root, 'backend', 'src', 'main', 'java', 'com', 'acme', 'orders');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, 'OrdersApplication.java'),
    'package com.acme.orders;\nclass OrdersApplication {}\n',
  );
  fs.writeFileSync(
    path.join(root, 'frontend', 'package.json'),
    JSON.stringify({ scripts: { build: 'vite build', test: 'vitest run' } }),
  );
  fs.writeFileSync(path.join(root, 'frontend', 'package-lock.json'), '{}\n');
  git(root, ['init', '-q']);
  if (commit) {
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
      'existing baseline',
    ]);
  }
  return root;
}

test('adoption preview is read-only for clean and dirty Java/Vue projects', (t) => {
  for (const dirty of [false, true]) {
    const root = project(t);
    if (dirty) {
      fs.writeFileSync(path.join(root, 'backend', 'legacy.java'), 'class Legacy { int value; }\n');
      fs.writeFileSync(path.join(root, 'frontend', 'draft.txt'), 'draft\n');
    }
    const before = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
    const result = previewAdoption({ projectRoot: root });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.profile.mode, 'adopted');
    assert.equal(result.needsBaselineCommit, dirty);
    assert.equal(result.profile.backendPackage, 'com.acme.orders');
    assert.equal(fs.existsSync(path.join(root, '.specgate/codex')), false);
    assert.equal(git(root, ['status', '--porcelain=v1', '--untracked-files=all']), before);
    if (dirty) {
      assert.deepEqual(result.dirty.files.map((entry) => entry.path).sort(), [
        'backend/legacy.java',
        'frontend/draft.txt',
      ]);
    }
  }
});

test('approved dirty-baseline commit stages only the exact approved file set', async (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, 'backend', 'legacy.java'), 'class Legacy { int changed; }\n');
  fs.writeFileSync(path.join(root, 'frontend', 'draft.txt'), 'draft\n');
  const preview = previewAdoption({ projectRoot: root });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  let challenge;
  const result = await commitDirtyBaseline(
    {
      projectRoot: root,
      previewHash: preview.previewHash,
      paths: preview.dirty.files.map((entry) => entry.path),
      message: 'chore: adopt existing project baseline',
    },
    {
      approvalProvider: {
        requestApproval: async (input) => {
          challenge = input;
          return {
            ok: true,
            record: {
              decision: 'approve',
              artifactHash: input.artifactHash,
              paths: [...input.paths],
            },
          };
        },
      },
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(challenge.artifactHash, preview.previewHash);
  assert.equal(git(root, ['status', '--porcelain=v1', '--untracked-files=all']), '');
  assert.match(
    git(root, ['show', '--stat', '--oneline', 'HEAD']),
    /adopt existing project baseline/,
  );
  assert.match(git(root, ['show', '--name-only', '--format=', 'HEAD']), /backend\/legacy\.java/);
  assert.match(git(root, ['show', '--name-only', '--format=', 'HEAD']), /frontend\/draft\.txt/);
});

test('dirty commit fails closed for missing approval, changed preview, incomplete paths and secrets', async (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, 'backend', 'legacy.java'), 'class Legacy { int changed; }\n');
  fs.writeFileSync(path.join(root, 'frontend', 'draft.txt'), 'draft\n');
  const preview = previewAdoption({ projectRoot: root });
  const allPaths = preview.dirty.files.map((entry) => entry.path);
  const noApproval = await commitDirtyBaseline(
    {
      projectRoot: root,
      previewHash: preview.previewHash,
      paths: allPaths,
      message: 'baseline',
    },
    {
      approvalProvider: {
        requestApproval: async () => ({ ok: false, code: 'APPROVAL_CANCELLED' }),
      },
    },
  );
  assert.equal(noApproval.code, 'APPROVAL_CANCELLED');
  const incomplete = await commitDirtyBaseline(
    {
      projectRoot: root,
      previewHash: preview.previewHash,
      paths: ['backend/legacy.java'],
      message: 'baseline',
    },
    {
      approvalProvider: {
        requestApproval: async () => ({ ok: true, record: { decision: 'approve' } }),
      },
    },
  );
  assert.equal(incomplete.code, 'APPROVED_PATHS_INCOMPLETE');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=abcdefghijklmnop\n');
  const withSecret = previewAdoption({ projectRoot: root });
  const sensitive = await commitDirtyBaseline(
    {
      projectRoot: root,
      previewHash: withSecret.previewHash,
      paths: withSecret.dirty.files.map((entry) => entry.path),
      message: 'baseline',
    },
    {
      approvalProvider: {
        requestApproval: async () => ({ ok: true, record: { decision: 'approve' } }),
      },
    },
  );
  assert.equal(sensitive.code, 'SENSITIVE_BASELINE_COMMIT');
  assert.notEqual(git(root, ['status', '--porcelain=v1', '--untracked-files=all']), '');
});

test('applies an adopted profile and baseline only after a clean preview', (t) => {
  const root = project(t);
  const preview = previewAdoption({ projectRoot: root });
  const baseline = {
    schemaVersion: 2,
    baselineId: 'baseline-adopted',
    projectId: preview.profile.projectId,
    commit: git(root, ['rev-parse', 'HEAD']),
    status: 'green',
    knownFailures: [],
    unverifiedAreas: [],
    commands: ['backend-build'],
    evidence: ['baseline-run'],
    environmentFingerprint: 'd'.repeat(64),
    createdAt: '2026-10-22T10:00:00.000Z',
  };
  const result = applyAdoption({ projectRoot: root, previewHash: preview.previewHash, baseline });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(loadProjectReadiness({ projectRoot: root }).canStartChange, true);
  assert.equal(git(root, ['status', '--porcelain=v1', '--untracked-files=all']), '');
  assert.match(
    git(root, ['show', '--name-only', '--format=', 'HEAD']),
    /\.specgate\/codex\/project\.json/,
  );
  assert.match(
    git(root, ['show', '--name-only', '--format=', 'HEAD']),
    /\.specgate\/codex\/baselines\/current\.json/,
  );
  const second = applyAdoption({ projectRoot: root, previewHash: preview.previewHash, baseline });
  assert.equal(second.code, 'PROJECT_ALREADY_READY');
});
