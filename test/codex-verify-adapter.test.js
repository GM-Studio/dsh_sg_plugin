import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { previewInit, executeInit } from '../src/codex/init.js';
import {
  verifyProject,
  runFrontendRuntime,
  discoverIdeMavenRoots,
  validateVerificationEvidence,
} from '../src/codex/verify.js';
import { projectSourceHash } from '../src/codex/core/template-style.js';
import { VERIFY_STAGES } from '../src/codex/core/java/verify-evidence.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-verify-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

async function initialized(t) {
  const root = path.join(temp(t), 'app');
  const preview = previewInit({ root });
  const result = await executeInit({ root, previewHash: preview.previewHash });
  assert.equal(result.ok, true, JSON.stringify(result));
  return root;
}

function fixture(
  t,
  {
    assetStatus = 200,
    assetContentType = 'application/javascript',
    startup = true,
    ready = true,
  } = {},
) {
  const root = temp(t);
  const directory = path.join(root, '.specgate', 'fixture-evidence');
  fs.mkdirSync(directory, { recursive: true });
  const server = path.join(root, 'http-fixture.mjs');
  fs.writeFileSync(
    server,
    `
import http from 'node:http';
const server = http.createServer((request, response) => {
  if (request.url === '/assets/app.js') {
    response.writeHead(${assetStatus}, {'Content-Type': ${JSON.stringify(assetContentType)}});
    response.end('console.log("fixture asset")');
  } else {
    response.writeHead(${ready ? 200 : 503}, {'Content-Type': 'text/html'});
    response.end('<!doctype html><html><script type="module" src="/assets/app.js"></script></html>');
  }
});
${startup ? "server.listen(Number(process.argv[2]), '127.0.0.1', () => console.log('HTTP fixture listening'));" : "console.error('intentional startup failure'); process.exit(3);"}
`,
  );
  return { root, directory, command: process.execPath, args: [server, '{port}'] };
}

test('uninitialized, partial and source-tree projects reject verification without writes', async (t) => {
  const root = temp(t);
  const missing = path.join(root, 'missing');
  assert.equal((await verifyProject({ root: missing })).code, 'E_NOT_JAVA_PROJECT');
  assert.equal(fs.existsSync(missing), false);
  assert.equal((await verifyProject({ root })).code, 'E_NOT_JAVA_PROJECT');
  assert.deepEqual(fs.readdirSync(root), []);
  fs.mkdirSync(path.join(root, '.specgate'));
  fs.writeFileSync(
    path.join(root, '.specgate/monorepo.json'),
    JSON.stringify({ stack: 'java-vue', preset: 'jdk8-boot2.7' }),
  );
  assert.equal((await verifyProject({ root })).code, 'E_INIT_INCOMPLETE');
  assert.deepEqual(fs.readdirSync(path.join(root, '.specgate')), ['monorepo.json']);
  assert.equal(
    (await verifyProject({ root: process.cwd() })).code,
    'VERIFY_SOURCE_TARGET_FORBIDDEN',
  );
});

test('public input cannot enable downloads, inject commands or bypass path binding', async (t) => {
  const root = temp(t);
  for (const patch of [{ install: true }, { full: true }, { env: {} }, { command: 'anything' }]) {
    assert.equal((await verifyProject({ root, ...patch })).code, 'VERIFY_ARGUMENTS_INVALID');
  }
  assert.equal((await verifyProject({ root: 'relative' })).code, 'UNSAFE_VERIFY_PATH');
  assert.equal(
    (await verifyProject({ root: root + path.sep + '..' + path.sep + 'elsewhere' })).code,
    'UNSAFE_VERIFY_PATH',
  );
  assert.deepEqual(fs.readdirSync(root), []);
});

test('missing toolchains never download and invalidate stale passed reports with all stages not-run', async (t) => {
  const root = await initialized(t);
  const initFile = path.join(root, '.specgate/init-report.json');
  const old = JSON.parse(fs.readFileSync(initFile));
  fs.writeFileSync(
    initFile,
    JSON.stringify({ ...old, phase: 'VERIFIED', initializationComplete: true }),
  );
  fs.writeFileSync(
    path.join(root, '.specgate/codex-verify-report.json'),
    JSON.stringify({ ok: true, v1Complete: true, runId: 'stale' }),
  );
  const result = await verifyProject(
    { root },
    {
      env: { PATH: '', HOME: root, USERPROFILE: root },
      scan: { javaRoots: [], mavenRoots: [], extraMavenRoots: [], homedir: root },
      ideRoots: [],
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VERIFY_BLOCKED');
  assert.equal(result.report.v1Complete, false);
  assert.equal(result.report.reconciliation.notRun, result.report.expectedStages.length);
  assert.ok(result.report.checks.every((check) => check.status === 'not-run'));
  assert.equal(result.legacyReport.status, 'blocked');
  assert.deepEqual(result.legacyReport.environment.provisioned, []);
  assert.equal(fs.existsSync(path.join(root, '.specgate/toolchains')), false);
  const init = JSON.parse(fs.readFileSync(initFile));
  assert.equal(init.initializationComplete, false);
  assert.notEqual(result.report.runId, 'stale');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, '.specgate/codex-verify-report.json'))).ok,
    false,
  );
});

test('cancelled verification records a new incomplete run and executes no quality commands', async (t) => {
  const root = await initialized(t);
  const controller = new AbortController();
  controller.abort();
  const result = await verifyProject({ root }, { signal: controller.signal });
  assert.equal(result.code, 'VERIFY_CANCELLED');
  assert.equal(result.report.v1Complete, false);
  assert.ok(result.report.checks.every((check) => check.status === 'not-run'));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, '.specgate/init-report.json')))
      .initializationComplete,
    false,
  );
  assert.equal(fs.existsSync(path.join(root, '.specgate/codex-verify.lock')), false);
});

test('symlinked source entries are refused before verification writes', async (t) => {
  const root = await initialized(t);
  const outside = temp(t);
  const link = path.join(root, 'frontend', 'src', 'linked');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await verifyProject({ root });
  assert.equal(result.code, 'UNSAFE_VERIFY_PATH');
  assert.equal(fs.existsSync(path.join(root, '.specgate/codex-verify-report.json')), false);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('hardlinked source and verification storage files reject before modifying external files', async (t) => {
  const root = await initialized(t);
  const outside = temp(t);
  for (const relative of [
    '.specgate/init-report.json',
    '.specgate/state.json',
    'README.md',
    '.specgate/codex-verify-report.json',
    '.specgate/verify-report.json.tmp',
  ]) {
    const target = path.join(root, relative);
    const original = fs.existsSync(target) ? fs.readFileSync(target) : null;
    const external = path.join(outside, path.basename(relative));
    const bytes = original || Buffer.from('{"outside":"must remain unchanged"}');
    fs.writeFileSync(external, bytes);
    if (original) fs.unlinkSync(target);
    fs.linkSync(external, target);
    const result = await verifyProject(
      { root },
      { env: { PATH: '' }, scan: { javaRoots: [], mavenRoots: [], homedir: root }, ideRoots: [] },
    );
    assert.equal(result.code, 'UNSAFE_VERIFY_PATH', relative);
    assert.deepEqual(fs.readFileSync(external), bytes, relative);
    assert.equal(fs.existsSync(path.join(root, '.specgate/codex-verify.lock')), false);
    fs.unlinkSync(target);
    if (original) fs.writeFileSync(target, original);
  }
});

test('frontend smoke records actual fixture process, HTTP responses, hashes and logs without claiming Java verification', async (t) => {
  const context = fixture(t);
  const result = await runFrontendRuntime(context, {
    command: context.command,
    args: context.args,
  });
  assert.equal(result.status, 0, JSON.stringify(result));
  assert.equal(result.scope, 'frontend-runtime-only');
  assert.equal(result.fixture, true);
  assert.ok(result.pid > 0);
  assert.equal(result.http.html.status, 200);
  assert.equal(result.http.assets[0].status, 200);
  assert.match(result.http.assets[0].sha256, /^[a-f\d]{64}$/);
  assert.match(
    fs.readFileSync(path.join(context.root, result.log), 'utf8'),
    /HTTP fixture listening/,
  );
  assert.equal(result.terminated, true);
  assert.equal(result.termination.closeObserved, true);
  assert.ok(result.termination.exitCode !== null || result.termination.exitSignal !== null);
});

test('frontend timeout, active cancellation and spawn failure have bounded observed process cleanup', async (t) => {
  for (const cancelled of [false, true]) {
    const context = fixture(t, { ready: false });
    const controller = new AbortController();
    const timer = cancelled ? setTimeout(() => controller.abort(), 200) : null;
    const result = await runFrontendRuntime(
      { ...context, timeoutMs: cancelled ? 5000 : 200, signal: controller.signal },
      { command: context.command, args: context.args },
    );
    if (timer) clearTimeout(timer);
    assert.equal(result.status, 1);
    assert.equal(result.reason, cancelled ? 'cancelled' : 'timeout');
    assert.equal(result.termination.closeObserved, true);
    assert.equal(result.terminated, true);
    assert.ok(result.durationMs < 5000);
  }
  const context = fixture(t);
  const failed = await runFrontendRuntime(
    { ...context, timeoutMs: 1000 },
    { command: path.join(context.root, 'missing-executable'), args: [] },
  );
  assert.equal(failed.status, 1);
  assert.equal(failed.pid, null);
  assert.equal(failed.termination.closeObserved, true);
  assert.equal(failed.terminated, true);
});

test('failed compatibility-state persistence revokes stale success and retains a recovery lock', async (t) => {
  const root = await initialized(t);
  fs.writeFileSync(path.join(root, '.specgate/state.json'), '{broken');
  fs.writeFileSync(
    path.join(root, '.specgate/codex-verify-report.json'),
    JSON.stringify({ ok: true, v1Complete: true, status: 'verified' }),
  );
  const result = await verifyProject({ root });
  assert.equal(result.ok, false);
  assert.equal(result.recoveryRequired, true);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, '.specgate/codex-verify-report.json'))).ok,
    false,
  );
  assert.equal(fs.existsSync(result.lockPath), true);
  assert.equal(validateVerificationEvidence({ root }).code, 'VERIFY_LOCKED');
});

test('frontend smoke fails for broken assets, failed startup and cancellation using real child processes', async (t) => {
  for (const options of [
    { assetStatus: 404 },
    { assetContentType: 'text/html' },
    { startup: false },
  ]) {
    const context = fixture(t, options);
    const result = await runFrontendRuntime(
      { ...context, timeoutMs: 2000 },
      { command: context.command, args: context.args },
    );
    assert.equal(result.status, 1, JSON.stringify(result));
    assert.equal(result.terminated, true);
    assert.ok(fs.existsSync(path.join(context.root, result.log)));
  }
  const context = fixture(t);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await runFrontendRuntime(
    { ...context, signal: controller.signal },
    { command: context.command, args: context.args },
  );
  assert.equal(cancelled.status, 1);
  assert.equal(cancelled.reason, 'cancelled');
});

test('IDE Maven candidates are bounded and discovered from install roots without machine paths', (t) => {
  const root = temp(t);
  const candidate = path.join(root, 'IntelliJ IDEA 2099.1', 'plugins', 'maven', 'lib', 'maven3');
  fs.mkdirSync(path.join(candidate, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(candidate, 'bin', process.platform === 'win32' ? 'mvn.cmd' : 'mvn'),
    '',
  );
  assert.deepEqual(discoverIdeMavenRoots({ roots: [root] }), [candidate]);
  assert.deepEqual(discoverIdeMavenRoots({ roots: [root], maxEntries: 0 }), []);
});

test('read-only evidence validation rejects missing, forged, fixture and stale reports', async (t) => {
  const root = await initialized(t);
  assert.equal(validateVerificationEvidence({ root }).code, 'VERIFY_EVIDENCE_MISSING');
  const runId = 'synthetic-rejection-only';
  const directory = path.join(root, '.specgate/codex-verify-runs', runId);
  fs.mkdirSync(directory, { recursive: true });
  const expectedStages = [...VERIFY_STAGES, 'frontend-runtime'];
  const report = {
    kind: 'codex-v1-local',
    root,
    runId,
    preset: 'jdk8-boot2.7',
    status: 'verified',
    ok: true,
    v1Complete: true,
    sourceHash: projectSourceHash(root),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    expectedStages,
    stages: [],
  };
  const save = () => {
    const text = JSON.stringify(report);
    fs.writeFileSync(path.join(directory, 'report.json'), text);
    fs.writeFileSync(path.join(root, '.specgate/codex-verify-report.json'), text);
  };
  save();
  assert.equal(validateVerificationEvidence({ root }).code, 'VERIFY_EVIDENCE_INCOMPLETE');
  report.stages = expectedStages.map((name) => ({
    name,
    status: 0,
    fixture: true,
    durationMs: 1,
    log: 'synthetic.log',
    command: process.execPath,
    args: [],
  }));
  save();
  assert.equal(validateVerificationEvidence({ root }).code, 'VERIFY_EVIDENCE_INCOMPLETE');
  report.stages.forEach((stage) => {
    stage.fixture = false;
  });
  save();
  assert.equal(validateVerificationEvidence({ root }).code, 'VERIFY_EVIDENCE_INVALID');
  fs.writeFileSync(path.join(root, 'README.md'), 'source changed');
  assert.equal(validateVerificationEvidence({ root }).code, 'VERIFY_SOURCE_CHANGED');
});
