import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createArtifactStore } from '../src/codex/core/artifact-store.js';
import {
  CURRENT_BASELINE_PATH,
  PROJECT_PROFILE_PATH,
  loadProjectReadiness,
  recordNewProjectBaseline,
} from '../src/codex/project-new.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-project-new-'));
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

function project(t, { verificationComplete = true } = {}) {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'pom.xml'), '<project/>\n');
  fs.writeFileSync(
    path.join(root, 'frontend', 'package.json'),
    JSON.stringify({ scripts: { build: 'vite build', test: 'vitest run' } }),
  );
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'init-report.json'),
    JSON.stringify({
      initializationComplete: verificationComplete,
      phase: verificationComplete ? 'VERIFIED' : 'GENERATED_ONLY',
    }),
  );
  fs.writeFileSync(
    path.join(root, '.specgate', 'codex-verify-report.json'),
    JSON.stringify({ ok: verificationComplete, runId: 'verify-1' }),
  );
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

const verification = {
  ok: true,
  runId: 'verify-1',
  sourceHash: 'c'.repeat(64),
  report: {
    status: 'verified',
    environment: {
      java: { version: '21' },
      node: { version: '20.19.0' },
      browser: { version: 'fixture' },
      database: { version: 'none' },
      envNames: ['APP_ADMIN_PASSWORD'],
    },
  },
};

test('records a green new-project baseline only after complete verification', (t) => {
  const root = project(t);
  const sourceCommit = git(root, ['rev-parse', 'HEAD']);
  const result = recordNewProjectBaseline({
    projectRoot: root,
    verification,
    createdAt: '2026-10-22T10:00:00.000Z',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.profile.mode, 'new');
  assert.equal(result.profile.stack, 'java-vue');
  assert.equal(result.profile.pushApproved, false);
  assert.equal(result.baseline.status, 'green');
  assert.equal(result.baseline.commit, sourceCommit);
  assert.notEqual(git(root, ['rev-parse', 'HEAD']), sourceCommit);
  const store = createArtifactStore({ projectRoot: root });
  assert.equal(store.readJson(PROJECT_PROFILE_PATH).ok, true);
  assert.equal(store.readJson(CURRENT_BASELINE_PATH).ok, true);
  const readiness = loadProjectReadiness({ projectRoot: root });
  assert.equal(readiness.ok, true, JSON.stringify(readiness));
  assert.equal(readiness.canStartChange, true);
  assert.equal(readiness.profile.commands.build.length > 0, true);
  assert.equal(git(root, ['status', '--porcelain=v1', '--untracked-files=all']), '');
  assert.match(
    git(root, ['show', '--name-only', '--format=', 'HEAD']),
    /\.specgate\/codex\/project\.json/,
  );
});

test('generation-only and incomplete verification never create project readiness', (t) => {
  const root = project(t, { verificationComplete: false });
  const result = recordNewProjectBaseline({ projectRoot: root, verification });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INITIALIZATION_NOT_VERIFIED');
  assert.equal(fs.existsSync(path.join(root, PROJECT_PROFILE_PATH)), false);
});

test('failed or cancelled verification and source hash drift fail closed', (t) => {
  for (const input of [
    { ...verification, ok: false },
    { ...verification, runId: undefined },
    { ...verification, sourceHash: 'main' },
    { ...verification, report: { ...verification.report, status: 'failed' } },
  ]) {
    const root = project(t);
    const result = recordNewProjectBaseline({ projectRoot: root, verification: input });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(path.join(root, PROJECT_PROFILE_PATH)), false);
  }
});

test('a second new-project finalization cannot overwrite an existing profile', (t) => {
  const root = project(t);
  assert.equal(recordNewProjectBaseline({ projectRoot: root, verification }).ok, true);
  const second = recordNewProjectBaseline({
    projectRoot: root,
    verification: { ...verification, runId: 'verify-2' },
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'PROJECT_ALREADY_READY');
});
