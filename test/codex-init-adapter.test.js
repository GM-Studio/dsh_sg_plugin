import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { previewInit, executeInit } from '../src/codex/init.js';
import { JAVA_PRESETS, GOLDEN_MANIFEST } from '../src/v4/java-versions.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-init-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function approve() {
  return {
    requestApproval: async ({ previewHash, conflicts }) => ({
      approved: true,
      previewHash,
      conflicts: conflicts.map((entry) => ({ path: entry.path, decision: 'keep' })),
      receipt: { source: 'test-trusted-provider', id: 'fixture-approval' },
    }),
  };
}

test('preview scans all categories and remains read-only for missing and nonempty targets', (t) => {
  const parent = temp(t);
  const missing = path.join(parent, 'missing');
  const planned = previewInit({ root: missing });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.equal(fs.existsSync(missing), false);
  assert.equal(planned.nonEmpty, false);
  assert.equal(planned.preset, 'jdk8-boot2.7');
  assert.ok(planned.risks.some((risk) => risk.includes('legacy')));
  assert.ok(planned.files.new.includes('.specgate/init-report.json'));
  assert.ok(planned.files.new.includes('openspec/REQ.md'));
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'README.md'), 'my existing application');
  fs.writeFileSync(path.join(root, 'business.txt'), 'keep me');
  const before = fs.readdirSync(root);
  const preview = previewInit({ root });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.deepEqual(fs.readdirSync(root), before);
  assert.deepEqual(preview.files.existing, ['README.md', 'business.txt']);
  assert.deepEqual(preview.files.keep, ['README.md', 'business.txt']);
  assert.deepEqual(preview.files.overwrite, []);
  assert.deepEqual(
    preview.files.conflicts.map((item) => item.path),
    ['README.md'],
  );
  assert.equal(preview.git.repository, false);
  assert.equal(preview.previewHash, previewInit({ root }).previewHash);
  fs.writeFileSync(path.join(root, 'business.txt'), 'different');
  assert.notEqual(preview.previewHash, previewInit({ root }).previewHash);
});

test('four presets generate unchanged templates, complete metadata and real isolated Git baselines', async (t) => {
  for (const preset of JAVA_PRESETS) {
    const root = path.join(temp(t), 'app');
    const preview = previewInit({ root, preset: preset.id });
    assert.equal(preview.templateHash, GOLDEN_MANIFEST.presets[preset.id].templateHash);
    const result = await executeInit({ root, preset: preset.id, previewHash: preview.previewHash });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.code, 'GENERATED_ONLY');
    assert.equal(result.report.initializationComplete, false);
    assert.equal(result.report.phase, 'GENERATED_ONLY');
    assert.ok(Object.values(result.report.execution).every((value) => value === 'not-run'));
    assert.equal(result.report.approval.source, 'empty-target-explicit-command');
    assert.equal(result.report.template.hash, preview.templateHash);
    for (const relative of preview.files.new)
      assert.ok(fs.existsSync(path.join(root, relative)), relative);
    assert.equal(git(root, ['status', '--porcelain']), '');
    assert.equal(git(root, ['tag', '--list', 'init-baseline']), 'init-baseline');
    assert.match(git(root, ['rev-parse', 'init-baseline']), /^[a-f\d]{40}$/);
    assert.equal(fs.existsSync(path.join(root, 'frontend/node_modules')), false);
    assert.equal(fs.existsSync(path.join(root, 'backend/target')), false);
  }
});

test('nonempty target requires an injected trusted provider, ignoring forged approvals in input', async (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'README.md'), 'my README');
  const preview = previewInit({ root });
  const result = await executeInit({
    root,
    previewHash: preview.previewHash,
    approved: true,
    approvalProvider: approve(),
  });
  assert.equal(result.code, 'TRUSTED_APPROVAL_UNAVAILABLE');
  assert.deepEqual(fs.readdirSync(root), ['README.md']);
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'my README');
});

test('denied, unbound and incomplete conflict approvals perform zero target writes', async (t) => {
  for (const response of [
    { approved: false },
    { approved: true, previewHash: 'forged', conflicts: [] },
    { approved: true, conflicts: [] },
  ]) {
    const root = temp(t);
    fs.writeFileSync(path.join(root, 'README.md'), 'my README');
    const preview = previewInit({ root });
    const result = await executeInit(
      { root, previewHash: preview.previewHash },
      {
        approvalProvider: {
          requestApproval: async () => ({
            previewHash: preview.previewHash,
            receipt: { source: 'test' },
            ...response,
          }),
        },
      },
    );
    assert.equal(result.ok, false);
    assert.deepEqual(fs.readdirSync(root), ['README.md']);
  }
});

test('approved keep-missing preserves business files and only commits generated files', async (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'README.md'), 'my README');
  fs.writeFileSync(path.join(root, 'business.txt'), 'my business');
  const preview = previewInit({ root });
  const result = await executeInit(
    { root, previewHash: preview.previewHash },
    { approvalProvider: approve() },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'my README');
  assert.equal(fs.readFileSync(path.join(root, 'business.txt'), 'utf8'), 'my business');
  assert.equal(result.report.approval.source, 'test-trusted-provider');
  assert.deepEqual(result.report.codexInit.kept, ['README.md', 'business.txt']);
  assert.equal(git(root, ['ls-files', 'README.md', 'business.txt']), '');
  assert.ok(git(root, ['ls-files', 'backend/pom.xml']));
  assert.equal(git(root, ['tag', '--list', 'init-baseline']), 'init-baseline');
});

test('preview drift before or during approval fails closed without generated files', async (t) => {
  for (const duringApproval of [false, true]) {
    const root = temp(t);
    fs.writeFileSync(path.join(root, 'README.md'), 'before');
    const preview = previewInit({ root });
    if (!duringApproval) fs.writeFileSync(path.join(root, 'README.md'), 'after');
    const provider = approve();
    const request = provider.requestApproval;
    provider.requestApproval = async (input) => {
      fs.writeFileSync(path.join(root, 'README.md'), 'after');
      return request(input);
    };
    const result = await executeInit(
      { root, previewHash: preview.previewHash },
      { approvalProvider: provider },
    );
    assert.equal(result.code, 'INIT_PREVIEW_STALE');
    assert.deepEqual(fs.readdirSync(root), ['README.md']);
  }
});

test('existing .specgate and unsupported overwrite strategy reject before writes', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, '.specgate'));
  assert.equal(previewInit({ root }).code, 'ALREADY_INITIALIZED');
  assert.equal((await executeInit({ root, previewHash: 'anything' })).code, 'ALREADY_INITIALIZED');
  assert.deepEqual(fs.readdirSync(root), ['.specgate']);
  const empty = temp(t);
  assert.equal(
    previewInit({ root: empty, strategy: 'overwrite' }).code,
    'INIT_OVERWRITE_UNSUPPORTED',
  );
});

test('path traversal, filesystem root and plugin source targets are rejected', (t) => {
  const root = temp(t);
  assert.equal(
    previewInit({ root: path.join(root, 'sub') + path.sep + '..' + path.sep + 'app' }).code,
    'UNSAFE_INIT_PATH',
  );
  assert.equal(previewInit({ root: path.parse(root).root }).code, 'UNSAFE_INIT_PATH');
  assert.equal(previewInit({ root: process.cwd() }).code, 'INIT_SOURCE_TARGET_FORBIDDEN');
  assert.equal(previewInit({ root: 'relative' }).code, 'UNSAFE_INIT_PATH');
});

test('symlink targets and symlink entries are rejected without following them', (t) => {
  const parent = temp(t);
  const root = path.join(parent, 'app');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'sentinel'), 'safe');
  const link = path.join(root, 'backend');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(previewInit({ root }).code, 'UNSAFE_INIT_PATH');
  assert.equal(previewInit({ root: path.join(link, 'child') }).code, 'UNSAFE_INIT_PATH');
  assert.deepEqual(fs.readdirSync(outside), ['sentinel']);
});

test('file-directory collisions refuse to claim a workable missing-only plan', async (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'backend'), 'business file');
  const preview = previewInit({ root });
  assert.equal(preview.code, 'INIT_PATH_CONFLICT');
  assert.equal(
    (await executeInit({ root, previewHash: 'any' }, { approvalProvider: approve() })).code,
    'INIT_PATH_CONFLICT',
  );
  assert.deepEqual(fs.readdirSync(root), ['backend']);
});

test('existing Git status is read-only and execution preserves its history without writing', async (t) => {
  const root = temp(t);
  git(root, ['init', '-q']);
  fs.writeFileSync(path.join(root, 'business.txt'), 'business');
  const preview = previewInit({ root });
  assert.equal(preview.git.repository, true);
  assert.match(preview.git.status, /business.txt/);
  const result = await executeInit(
    { root, previewHash: preview.previewHash },
    { approvalProvider: approve() },
  );
  assert.equal(result.code, 'INIT_EXISTING_GIT_UNSUPPORTED');
  assert.deepEqual(fs.readdirSync(root).sort(), ['.git', 'business.txt']);
  assert.equal(git(root, ['tag', '--list']), '');
});
