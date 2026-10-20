import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  startJavaInit,
  completeJavaInit,
  resumeJavaInitialization,
  finalizeJavaInitialization,
} from '../../src/v4/java-init.js';
async function fixture(t, quality = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-continuation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = await startJavaInit({
    root,
    quality,
    userQuestions: { ask: async () => ({ answers: [{ selected: ['确认'] }] }) },
  });
  assert.equal(result.code, 'MAIN_AGENT_PENDING', result.message);
  return {
    root,
    result,
    read: () => JSON.parse(fs.readFileSync(path.join(root, '.specgate/init-report.json'))),
    write: (value) =>
      fs.writeFileSync(path.join(root, '.specgate/init-report.json'), JSON.stringify(value)),
    git: (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }),
  };
}
const acceptedFixture = {
  ok: true,
  accepted: true,
  archiveAllowed: true,
  stages: [],
  testFixture: true,
};
test('ignored report cannot downgrade approved quality or enable execution', async (t) => {
  const f = await fixture(t, { mode: 'strict' });
  const report = f.read();
  report.quality.mode = 'lenient';
  f.write(report);
  const before = f.git(['rev-parse', 'HEAD']).stdout;
  assert.equal((await resumeJavaInitialization({ root: f.root })).ok, false);
  assert.equal(f.git(['rev-parse', 'HEAD']).stdout, before);
  report.quality.mode = 'strict';
  report.execution.installToolchain = true;
  f.write(report);
  assert.equal((await resumeJavaInitialization({ root: f.root })).ok, false);
});
test('tracked gate metadata and deleted repair fail before source commits', async (t) => {
  const f = await fixture(t);
  const before = f.git(['rev-parse', 'HEAD']).stdout;
  fs.appendFileSync(path.join(f.root, '.specgate/config.yaml'), 'tampered: true');
  assert.equal((await resumeJavaInitialization({ root: f.root })).code, 'E_INIT_REPAIR_SCOPE');
  f.git(['restore', '.specgate/config.yaml']);
  fs.unlinkSync(path.join(f.root, 'frontend/package.json'));
  assert.equal((await resumeJavaInitialization({ root: f.root })).code, 'E_INIT_REPAIR_SCOPE');
  assert.equal(f.git(['rev-parse', 'HEAD']).stdout, before);
});
test('malformed JSON and non-root path return structured failures', async (t) => {
  const f = await fixture(t);
  f.write(null);
  assert.equal((await resumeJavaInitialization({ root: f.root })).ok, false);
  assert.equal(
    (await finalizeJavaInitialization({ root: f.root, token: f.result.token, reports: {} })).ok,
    false,
  );
  assert.equal(
    (await resumeJavaInitialization({ root: path.join(f.root, 'backend') })).code,
    'E_INIT_SCOPE',
  );
});
test('archive failure retries trusted exact snapshot; concurrent retries commit once and finalize idempotently', async (t) => {
  const f = await fixture(t);
  const head = f.git(['rev-parse', 'HEAD']).stdout.trim();
  const failed = completeJavaInit(f.root, f.read(), acceptedFixture, {
    gitRunner: () => ({ status: 1, stderr: 'injected archive failure' }),
  });
  assert.equal(failed.code, 'E_ARCHIVE_GIT');
  assert.equal(f.read().initializationComplete, false);
  const results = await Promise.all([
    resumeJavaInitialization({ root: f.root }),
    finalizeJavaInitialization({ root: f.root, token: f.result.token, reports: {} }),
  ]);
  assert.ok(
    results.every((x) => x.ok),
    JSON.stringify(results),
  );
  const report = f.read();
  assert.equal(report.phase, 'IDLE');
  assert.equal(report.initializationComplete, true);
  assert.equal(f.git(['rev-parse', report.archiveCommit + '^']).stdout.trim(), head);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.root, report.archive))).phase,
    'QUALITY_ACCEPTED',
  );
  const duplicate = await finalizeJavaInitialization({
    root: f.root,
    token: f.result.token,
    reports: {},
  });
  assert.equal(duplicate.phase, 'IDLE');
  assert.equal(f.git(['rev-parse', 'HEAD']).stdout.trim(), report.archiveCommit);
  assert.equal(
    (await finalizeJavaInitialization({ root: f.root, token: { wrong: true }, reports: {} })).code,
    'E_INIT_TOKEN',
  );
});
test('prepared archive mutation rejects retry without committing', async (t) => {
  const f = await fixture(t);
  completeJavaInit(f.root, f.read(), acceptedFixture, {
    gitRunner: () => ({ status: 1, stderr: 'injected' }),
  });
  const head = f.git(['rev-parse', 'HEAD']).stdout;
  fs.appendFileSync(path.join(f.root, 'openspec/REQ.md'), 'unrelated tampering');
  const retry = await resumeJavaInitialization({ root: f.root });
  assert.equal(retry.ok, false);
  assert.match(retry.message, /artifact changed/);
  assert.equal(f.git(['rev-parse', 'HEAD']).stdout, head);
});
test('ancestor junction repair cannot escape root', async (t) => {
  const f = await fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-continuation-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const frontend = path.join(f.root, 'frontend');
  fs.renameSync(frontend, path.join(f.root, 'frontend-original'));
  try {
    fs.symlinkSync(outside, frontend, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('Symlink privilege unavailable');
      return;
    }
    throw error;
  }
  fs.writeFileSync(path.join(outside, 'package.json'), '{}');
  const before = f.git(['rev-parse', 'HEAD']).stdout;
  const result = await resumeJavaInitialization({ root: f.root });
  assert.equal(result.code, 'E_INIT_REPAIR_SCOPE');
  assert.equal(f.git(['rev-parse', 'HEAD']).stdout, before);
});
test('only matching pinned frontend lock is a controlled resume repair', async (t) => {
  const f = await fixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root, 'frontend/package.json')));
  const packages = { '': structuredClone(manifest) };
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'])
    for (const [name, version] of Object.entries(manifest[field] || {}))
      packages['node_modules/' + name] = { version };
  const lock = { lockfileVersion: 3, packages };
  const file = path.join(f.root, 'frontend/package-lock.json');
  const before = f.git(['rev-parse', 'HEAD']).stdout;
  lock.packages[''].dependencies = { ...manifest.dependencies, vue: '^3.0.0' };
  fs.writeFileSync(file, JSON.stringify(lock));
  assert.equal((await resumeJavaInitialization({ root: f.root })).code, 'E_INIT_REPAIR_SCOPE');
  assert.equal(f.git(['rev-parse', 'HEAD']).stdout, before);
  lock.packages[''].dependencies = manifest.dependencies;
  fs.writeFileSync(file, JSON.stringify(lock));
  const result = await resumeJavaInitialization({ root: f.root });
  assert.equal(result.code, 'MAIN_AGENT_PENDING', result.message);
  assert.notEqual(f.git(['rev-parse', 'HEAD']).stdout, before);
  assert.equal(f.git(['ls-files', '--error-unmatch', 'frontend/package-lock.json']).status, 0);
});
test('forged ARCHIVE_FAILED cannot promote unsigned report into accepted archive', async (t) => {
  const f = await fixture(t);
  const report = f.read();
  report.phase = 'ARCHIVE_FAILED';
  report.verification = acceptedFixture;
  f.write(report);
  assert.equal(
    (await resumeJavaInitialization({ root: f.root })).code,
    'E_ARCHIVE_RETRY_UNTRUSTED',
  );
});
