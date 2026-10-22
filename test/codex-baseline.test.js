import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { previewAdoption } from '../src/codex/project-adopt.js';
import { runAdoptionBaseline, runBaselineCommand } from '../src/codex/baseline.js';
import { validateProjectBaseline } from '../src/codex/project-model.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-baseline-'));
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

function project(t) {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'pom.xml'), '<project/>\n');
  fs.writeFileSync(
    path.join(root, 'frontend', 'package.json'),
    JSON.stringify({ scripts: { build: 'vite build', test: 'vitest run' } }),
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

test('all passing baseline commands produce a valid green adopted baseline', async (t) => {
  const root = project(t);
  const preview = previewAdoption({ projectRoot: root });
  const result = await runAdoptionBaseline({
    preview,
    runner: async ({ command }) => ({
      commandId: command.id,
      status: 'passed',
      exitCode: 0,
      durationMs: 5,
      stdout: command.id + ' passed',
      stderr: '',
    }),
    createdAt: '2026-10-22T10:00:00.000Z',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.baseline.status, 'green');
  assert.deepEqual(validateProjectBaseline(result.baseline), { ok: true });
  assert.equal(result.baseline.knownFailures.length, 0);
  assert.match(result.baseline.environmentFingerprint, /^[a-f0-9]{64}$/);
});

test('pre-existing failing commands become stable known failures', async (t) => {
  const root = project(t);
  const preview = previewAdoption({ projectRoot: root });
  const result = await runAdoptionBaseline({
    preview,
    runner: async ({ command }) => ({
      commandId: command.id,
      status: command.id === 'frontend-test' ? 'failed' : 'passed',
      exitCode: command.id === 'frontend-test' ? 1 : 0,
      durationMs: 5,
      stdout: command.id,
      stderr: command.id === 'frontend-test' ? 'legacy test timeout' : '',
    }),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.baseline.status, 'known-failures');
  assert.equal(result.baseline.knownFailures.length, 1);
  assert.equal(result.baseline.knownFailures[0].commandId, 'frontend-test');
  assert.equal(validateProjectBaseline(result.baseline).ok, true);
});

test('no discovered commands produce a partial baseline with unverified risk', async (t) => {
  const root = project(t);
  const preview = previewAdoption({ projectRoot: root });
  preview.profile.commands = {
    install: [],
    build: [],
    test: [],
    lint: [],
    format: [],
    runtime: [],
  };
  const result = await runAdoptionBaseline({
    preview,
    runner: async () => assert.fail('runner must not be called'),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.baseline.status, 'partial');
  assert.equal(result.baseline.unverifiedAreas.length > 0, true);
  assert.equal(validateProjectBaseline(result.baseline).ok, true);
});

test('cancelled or malformed baseline runs fail without fabricating a green baseline', async (t) => {
  const root = project(t);
  const preview = previewAdoption({ projectRoot: root });
  const cancelled = await runAdoptionBaseline({
    preview,
    runner: async ({ command }) => ({
      commandId: command.id,
      status: 'cancelled',
      exitCode: null,
    }),
  });
  assert.equal(cancelled.code, 'BASELINE_CANCELLED');
  const malformed = await runAdoptionBaseline({
    preview,
    runner: async () => ({ status: 'passed', exitCode: 0 }),
  });
  assert.equal(malformed.code, 'BASELINE_RESULT_INVALID');
});

test('bounded baseline commands use argv arrays and classify observed failure', async (t) => {
  const root = temp(t);
  const passed = await runBaselineCommand({
    command: {
      id: 'node-pass',
      argv: [process.execPath, '-e', 'console.log("baseline-ok")'],
    },
    cwd: root,
    timeoutMs: 5000,
  });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.exitCode, 0);
  assert.match(passed.stdout, /baseline-ok/);
  const failed = await runBaselineCommand({
    command: {
      id: 'node-fail',
      argv: [process.execPath, '-e', 'console.error("baseline-fail"); process.exit(3)'],
    },
    cwd: root,
    timeoutMs: 5000,
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 3);
  assert.match(failed.stderr, /baseline-fail/);
});
