import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { previewAdoption } from '../src/codex/project-adopt.js';
import { getBaselineJob, startBaselineJob } from '../src/codex/baseline-job.js';
import { loadProjectReadiness } from '../src/codex/project-state.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-baseline-job-'));
  t.after(() =>
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 50,
      retryDelay: 100,
    }),
  );
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

function project(t) {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'frontend', 'package.json'),
    JSON.stringify({
      name: 'baseline-job-fixture',
      version: '1.0.0',
      scripts: {
        build:
          "node -e \"require('fs').unlinkSync('generated.txt'); process.stdout.write('build-ok')\"",
      },
    }),
  );
  fs.writeFileSync(path.join(root, 'frontend', 'generated.txt'), 'tracked build output\n');
  git(root, ['init', '-q']);
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

test('detached baseline worker survives the starter and persists readiness', async (t) => {
  const projectRoot = project(t);
  const preview = previewAdoption({ projectRoot });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const started = startBaselineJob({
    projectRoot,
    preview,
    createdAt: '2026-10-22T10:00:00.000Z',
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(started.status, 'running');
  assert.equal(getBaselineJob(projectRoot).runId, started.runId);
  const jobSpecification = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, '.git/specgate/baseline-jobs', started.runId, 'job.json'),
      'utf8',
    ),
  );
  assert.ok(jobSpecification.worktreeRoot.startsWith(path.join(projectRoot, '.git', 'specgate')));

  let readiness;
  let job;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    job = getBaselineJob(projectRoot);
    readiness = loadProjectReadiness({ projectRoot });
    if ((readiness.ok && !job) || job?.status === 'failed') break;
  }
  assert.equal(readiness.ok, true, JSON.stringify({ readiness, job }));
  assert.equal(readiness.canStartChange, true);
  assert.equal(readiness.baseline.status, 'green');
  assert.equal(
    fs.readFileSync(path.join(projectRoot, 'frontend', 'generated.txt'), 'utf8'),
    'tracked build output\n',
  );
  assert.equal(git(projectRoot, ['status', '--porcelain=v1', '--untracked-files=all']), '');
  assert.equal(fs.existsSync(path.join(projectRoot, '.git', 'specgate')), false);
  assert.equal(
    fs.existsSync(
      path.join(projectRoot, '.specgate', 'codex', 'baseline-runs', started.runId, 'summary.json'),
    ),
    true,
  );
});

test('completion during a status read does not become a false failed baseline', async (t) => {
  const { reserveBaselineJob, finishBaselineJob } = await import('../src/codex/baseline-job.js');
  const root = project(t),
    preview = previewAdoption({ projectRoot: root });
  const reserved = reserveBaselineJob({ projectRoot: root, preview });
  assert.equal(reserved.ok, true, JSON.stringify(reserved));
  const job = JSON.parse(fs.readFileSync(reserved.jobPath, 'utf8'));
  const original = fs.readFileSync;
  let intercepted = false;
  fs.readFileSync = function (file, ...args) {
    if (!intercepted && path.resolve(String(file)) === path.resolve(job.statusPath)) {
      intercepted = true;
      finishBaselineJob(job, { success: true });
    }
    return original.call(this, file, ...args);
  };
  let result;
  try {
    result = getBaselineJob(root);
  } finally {
    fs.readFileSync = original;
  }
  assert.equal(intercepted, true);
  assert.equal(result, null, JSON.stringify(result));
  assert.equal(
    loadProjectReadiness({ projectRoot: root }).ok,
    false,
    'absence of a job never fabricates readiness',
  );
});

test('persistent missing status under an active lease still fails closed after bounded rereads', async (t) => {
  const { reserveBaselineJob } = await import('../src/codex/baseline-job.js');
  const root = project(t),
    preview = previewAdoption({ projectRoot: root });
  const reserved = reserveBaselineJob({ projectRoot: root, preview });
  assert.equal(reserved.ok, true, JSON.stringify(reserved));
  fs.unlinkSync(reserved.statusPath);
  const result = getBaselineJob(root);
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'ENOENT');
  assert.equal(fs.existsSync(path.join(root, '.git/specgate/baseline-lease/owner.json')), true);
});
