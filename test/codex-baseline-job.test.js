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
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'pom.xml'), '<project/>\n');
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
