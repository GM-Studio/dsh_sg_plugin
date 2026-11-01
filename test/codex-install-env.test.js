import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseInstallArgs, installEnvironment } from '../scripts/install-env.mjs';
import { nodeBootstrapArchive } from '../src/codex/core/node-bootstrap.js';
import { componentArchive } from '../src/codex/core/environment-catalog.js';

const roots = [];
const script = fileURLToPath(new URL('../scripts/install-env.mjs', import.meta.url));
function temporary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-safe-installer-'));
  roots.push(root);
  return root;
}
function manifest(root, version = process.versions.node) {
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'installer-real-proof', private: true, engines: { node: version } }),
  );
}
const snapshot = (root) => fs.readdirSync(root, { recursive: true }).sort();
test.after(() => {
  for (const root of roots)
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

test('standalone defaults infer project tools and never opt in to global environment writes', () => {
  const defaults = parseInstallArgs([]);
  assert.deepEqual(defaults.only, []);
  assert.equal(defaults.envWrite, false);
  const selected = parseInstallArgs([
    '--check',
    '--only=node,go,node',
    '--stack=go',
    '--source=official',
    '--no-env-write',
  ]);
  assert.deepEqual(selected.only, ['node', 'go']);
  assert.equal(selected.selection.stack, 'go');
  for (const argument of [
    '--method=winget',
    '--method=apt-get',
    '--reinstall',
    '--yes',
    '--approve-plan=true',
    '--env-write',
    '--toolchain-dir=relative',
    '--only=not-supported',
  ])
    assert.throws(() => parseInstallArgs([argument]), { code: 'INVALID_ARGUMENT' });
});
test('help is independent of discovery, metadata and filesystem mutations', async () => {
  const root = temporary();
  const before = snapshot(root);
  const result = await installEnvironment({ argv: ['--help', '--project=' + root] });
  assert.equal(result.help, true);
  assert.deepEqual(snapshot(root), before);
});
test('native wrapper and shared MCP catalog use the same exact official Node archives', () => {
  for (const platform of ['win32', 'linux']) {
    const bootstrap = nodeBootstrapArchive({ platform, arch: 'x64' });
    assert.deepEqual(componentArchive('node', { platform, source: 'official' }), bootstrap);
    assert.match(bootstrap.checksum, /^[a-f0-9]{64}$/);
  }
  assert.throws(() => nodeBootstrapArchive({ platform: 'darwin', arch: 'arm64' }), {
    code: 'ENV_PLATFORM_UNSUPPORTED',
  });
});
test('a real project check reuses compatible Node/npm without creating cache or changing caller environment', async () => {
  const root = temporary();
  manifest(root);
  const before = snapshot(root),
    environment = { ...process.env };
  const result = await installEnvironment({
    argv: ['--check', '--project=' + root, '--only=node', '--json'],
    confirm: () => assert.fail('read-only check requested consent'),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.environmentReady, true);
  assert.deepEqual(result.required, ['node']);
  assert.equal(result.tools.node.version, process.versions.node);
  assert.equal(result.workflowVerification, 'not-run');
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual({ ...process.env }, environment);
});
test('a nonexistent required Node version blocks before consent, metadata download or installation', async () => {
  const root = temporary();
  manifest(root, '999.0.0');
  const before = snapshot(root);
  let confirmations = 0;
  const result = await installEnvironment({
    argv: ['--project=' + root, '--only=node'],
    confirm: () => {
      confirmations++;
      return true;
    },
  });
  assert.equal(result.code, 'ENV_INSTALL_VERSION_UNAVAILABLE', JSON.stringify(result));
  assert.equal(confirmations, 0);
  assert.deepEqual(snapshot(root), before);
});
test('exact-plan decline and a mismatched expected hash install nothing', async () => {
  const root = temporary();
  manifest(root, '22.22.0');
  const before = snapshot(root);
  let reviewed;
  const result = await installEnvironment({
    argv: ['--project=' + root, '--only=node'],
    confirm: (plan) => {
      reviewed = plan;
      return false;
    },
  });
  assert.equal(result.code, 'ENV_INSTALL_CONSENT_REQUIRED', JSON.stringify(result));
  assert.equal(reviewed.actions.length, 1);
  assert.equal(reviewed.actions[0].archive.version, '22.22.0');
  assert.match(reviewed.planHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(snapshot(root), before);
  await assert.rejects(
    installEnvironment({
      argv: ['--project=' + root, '--only=node', '--expected-plan-hash=' + '0'.repeat(64)],
      confirm: () => assert.fail('changed plan was accepted'),
    }),
    { code: 'ENV_INSTALL_PLAN_CHANGED' },
  );
  assert.deepEqual(snapshot(root), before);
});
test('a real noninteractive CLI produces an exact plan but cannot self-approve it', () => {
  const root = temporary();
  manifest(root, '22.22.0');
  const before = snapshot(root);
  const planned = spawnSync(
    process.execPath,
    [script, '--plan', '--only=node', '--project=' + root],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  );
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);
  const plan = JSON.parse(planned.stdout);
  assert.equal(plan.environmentReady, false);
  assert.equal(plan.code, 'ENV_INSTALL_PLAN_ONLY');
  const attempt = spawnSync(
    process.execPath,
    [
      script,
      '--only=node',
      '--project=' + root,
      '--expected-plan-hash=' + plan.approvalPlan.planHash,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  );
  assert.equal(attempt.status, 1, attempt.stdout);
  assert.equal(JSON.parse(attempt.stdout).code, 'ENV_INSTALL_CONSENT_REQUIRED');
  assert.deepEqual(snapshot(root), before);
});
test('empty new project requires user stack selection and does not install unrelated JDKs', async () => {
  const root = temporary();
  const result = await installEnvironment({ argv: ['--check', '--project=' + root] });
  assert.equal(result.code, 'ENV_STACK_REQUIRED');
  const chosen = await installEnvironment({
    argv: ['--check', '--project=' + root, '--stack=node'],
  });
  assert.deepEqual(chosen.required, ['git', 'node']);
  assert.equal(chosen.environmentReady, true, JSON.stringify(chosen));
  assert.deepEqual(snapshot(root), []);
});
test('standalone scripts remain outside the Core tarball and have no default npm lifecycle install hook', () => {
  const pkg = JSON.parse(
    fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url))),
  );
  for (const name of [
    'scripts/install-env.mjs',
    'scripts/install-env.ps1',
    'scripts/install-env.sh',
  ])
    assert.equal(pkg.files.includes(name), false);
  assert.equal(pkg.scripts['env:install'], undefined);
  assert.equal(pkg.scripts['env:check'], undefined);
});

for (const [stack, only, extra] of [
  ['react', 'node', []],
  ['vue', 'node', []],
  ['python', 'python', ['--python-version=>=3']],
  ['go', 'go', ['--go-version=>=1.24']],
  ['java', 'jdk17,maven', ['--java-version=17']],
])
  test(`new-project standalone ${stack} selection really reuses its available SDK without installing unrelated tools`, async () => {
    const root = temporary(),
      args = ['--check', '--project=' + root, '--stack=' + stack, '--only=' + only, ...extra];
    if (process.env.SPECGATE_E2E_TOOLCHAIN_CACHE)
      args.push('--toolchain-dir=' + path.resolve(process.env.SPECGATE_E2E_TOOLCHAIN_CACHE));
    const result = await installEnvironment({ argv: args });
    assert.equal(result.environmentReady, true, JSON.stringify(result));
    assert.equal(result.selection.stack, stack);
    assert.deepEqual(result.required, only.split(','));
    assert.ok(result.plan.every((entry) => entry.action === 'reuse'));
    assert.deepEqual(snapshot(root), []);
  });
