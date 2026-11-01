import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { detectStack, MAX_TOP_LEVEL_DIRECTORIES } from '../src/codex/core/discovery/stack.js';
import { createEnvironmentService } from '../src/codex/core/environment.js';
import { previewAdoption } from '../src/codex/project-adopt.js';
import { runBaselineCommand } from '../src/codex/baseline.js';
import { mcpClient } from './environment-mcp-client.mjs';
import { projectCommandSpec } from '../src/codex/core/project-command.js';
const roots = [];
test.after(() => {
  for (const r of roots)
    fs.rmSync(r, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
});
function root(parent = os.tmpdir()) {
  fs.mkdirSync(parent, { recursive: true });
  const r = fs.mkdtempSync(path.join(parent, 'sg-workspace-scan-'));
  roots.push(r);
  return r;
}
function write(r, f, s) {
  const p = path.join(r, f);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
}
function run(r, bin, args, environment = process.env) {
  const spec = projectCommandSpec(bin, args, { env: environment });
  const v = spawnSync(spec.command, spec.args, {
    cwd: r,
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
    timeout: 30000,
  });
  assert.equal(v.status, 0, v.stderr || v.error?.message);
  return v.stdout;
}
function commit(r) {
  run(r, 'git', ['init', '-q', '-b', 'main']);
  run(r, 'git', ['config', 'user.name', 'Workspace fixture']);
  run(r, 'git', ['config', 'user.email', 'fixture@localhost']);
  run(r, 'git', ['add', '.']);
  run(r, 'git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
}

test('deep declared workspace and Go workspace facts are found with bounded explicit scope', () => {
  const r = root();
  write(r, 'package.json', JSON.stringify({ private: true, workspaces: ['a/b/c/d/e/web'] }));
  write(r, 'a/b/c/d/e/web/package.json', JSON.stringify({ scripts: { test: 'node test.js' } }));
  write(r, 'go.work', 'go 1.27.3\nuse ./services/a/b/c/d/api\n');
  write(r, 'services/a/b/c/d/api/go.mod', 'module example.com/api\ngo 1.27.3\n');
  const found = detectStack({ root: r });
  assert.equal(found.scan.complete, true, JSON.stringify(found));
  assert.ok(found.modules.some((m) => m.root === 'a/b/c/d/e/web'));
  assert.ok(found.modules.some((m) => m.root === 'services/a/b/c/d/api'));
  assert.ok(found.workspaces.some((w) => w.kind === 'go'));
  assert.ok(found.workspaces.some((w) => w.kind === 'npm'));
});
test('entry, directory and depth exhaustion are visible and never described as complete', () => {
  const r = root();
  write(r, 'package.json', '{}');
  for (let i = 0; i < 5; i++) write(r, `dir-${i}/deep/package.json`, '{}');
  for (const budget of [{ maxDirectories: 2 }, { maxEntries: 2 }, { maxDepth: 1 }]) {
    const v = detectStack({ root: r, ...budget });
    assert.equal(v.ok, true);
    assert.equal(v.scan.complete, false, JSON.stringify(budget));
    assert.equal(v.scan.truncated, true);
    assert.ok(v.gaps.some((g) => /扫描不完整/.test(g)));
  }
});
test('unsupported, escaping and missing workspace declarations block environment readiness', async () => {
  for (const patterns of [['../outside'], ['missing'], ['packages/{a,b}']]) {
    const r = root();
    write(r, 'package.json', JSON.stringify({ workspaces: patterns }));
    const found = detectStack({ root: r });
    assert.equal(found.scan.complete, false);
    const checked = await createEnvironmentService({ root: r }).check();
    assert.equal(checked.environmentReady, false);
    assert.equal(checked.code, 'ENV_STACK_UNSUPPORTED');
  }
  const r = root();
  write(r, 'package.json', '{}');
  for (let i = 0; i < MAX_TOP_LEVEL_DIRECTORIES + 2; i++) fs.mkdirSync(path.join(r, 'dir-' + i));
  const preview = previewAdoption({ projectRoot: r });
  assert.equal(preview.code, 'STACK_SCAN_INCOMPLETE');
  assert.equal((await createEnvironmentService({ root: r }).check()).environmentReady, false);
});
test('pnpm workspace patterns and inherited package manager remain explicit facts', () => {
  const r = root();
  write(r, 'package.json', JSON.stringify({ private: true, packageManager: 'pnpm@12.14.0' }));
  write(r, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/ignored'\n");
  write(r, 'packages/web/package.json', JSON.stringify({ scripts: { test: 'node proof.js' } }));
  write(r, 'packages/ignored/package.json', '{}');
  const v = detectStack({ root: r });
  assert.equal(v.scan.complete, true, JSON.stringify(v));
  assert.equal(v.modules.find((m) => m.root === 'packages/web').packageManager, 'pnpm');
  assert.ok(
    v.workspaces.some((w) => w.kind === 'pnpm' && w.patterns.includes('!packages/ignored')),
  );
});
test('native npm workspace installs once at its lock root and real MCP adoption tests local workspace links', async (t) => {
  const r = root();
  write(r, '.gitignore', 'node_modules/\n.specgate/\n');
  write(
    r,
    'package.json',
    JSON.stringify({
      name: 'workspace-root',
      private: true,
      version: '1.0.0',
      workspaces: ['packages/*'],
    }),
  );
  write(
    r,
    'packages/lib/package.json',
    JSON.stringify({ name: 'workspace-proof-lib', version: '1.0.0', main: 'index.cjs' }),
  );
  write(r, 'packages/lib/index.cjs', "module.exports='real-workspace-dependency';\n");
  write(
    r,
    'packages/web/package.json',
    JSON.stringify({
      name: 'workspace-proof-web',
      version: '1.0.0',
      dependencies: { 'workspace-proof-lib': '1.0.0' },
      scripts: { test: 'node proof.cjs' },
    }),
  );
  write(
    r,
    'packages/web/proof.cjs',
    "require('node:assert/strict').equal(require('workspace-proof-lib'),'real-workspace-dependency');console.log('workspace-link-ok');\n",
  );
  run(r, 'npm', [
    'install',
    '--package-lock-only',
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ]);
  commit(r);
  const preview = previewAdoption({ projectRoot: r });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(
    preview.profile.commands.install.length,
    1,
    JSON.stringify(preview.profile.commands.install),
  );
  assert.equal(preview.profile.commands.install[0].cwd, '.');
  const client = await mcpClient(t, r);
  const p = (await client.call('sg_adopt_preview')).structuredContent;
  assert.equal(p.ok, true, JSON.stringify(p));
  const start = (await client.call('sg_adopt_apply', { previewHash: p.previewHash }))
    .structuredContent;
  assert.equal(start.ok, true, JSON.stringify(start));
  let status;
  for (let i = 0; i < 500; i++) {
    status = (await client.call('sg_project_status')).structuredContent;
    if (status.projectReady || status.baselineRun?.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(status.projectReady, true, JSON.stringify(status));
  assert.equal(status.baseline.status, 'green');
  const summary = JSON.parse(
    fs.readFileSync(path.join(r, '.specgate/codex/baseline-runs', start.runId, 'summary.json')),
  );
  assert.ok(summary.commands.some((c) => c.kind === 'test' && /workspace-link-ok/.test(c.stdout)));
});
test('discovered Go and Python test commands really execute with the checked SDKs', async () => {
  const r = root();
  write(r, 'go.work', 'go 1.27.3\nuse (\n ./services/api\n)\n');
  write(r, 'services/api/go.mod', 'module example.com/workspace\ngo 1.27.3\n');
  write(r, 'services/api/proof.go', 'package proof\nfunc Value() int { return 42 }\n');
  write(
    r,
    'services/api/proof_test.go',
    'package proof\nimport "testing"\nfunc TestValue(t *testing.T) { if Value()!=42 { t.Fatal("wrong value") } }\n',
  );
  write(r, 'services/worker/requirements.txt', '');
  write(
    r,
    'services/worker/test_proof.py',
    'import unittest\nclass Proof(unittest.TestCase):\n def test_value(self): self.assertEqual(6*7,42)\n',
  );
  const found = detectStack({ root: r });
  assert.equal(found.scan.complete, true, JSON.stringify(found));
  const commands = found.commands.test.filter((c) => ['go', 'python'].includes(c.argv[0]));
  assert.equal(commands.length, 2, JSON.stringify(found.commands));
  assert.ok(
    commands.every((command) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(command.id)),
    JSON.stringify(commands),
  );
  const temp = root(process.env.SPECGATE_E2E_EXECUTION_TEMP || os.tmpdir());
  const ctx = await createEnvironmentService({
    root: r,
    cacheRoot: process.env.SPECGATE_E2E_TOOLCHAIN_CACHE,
    env: {
      ...process.env,
      GOPROXY: 'off',
      GOSUMDB: 'off',
      GOTOOLCHAIN: 'local',
      GOTMPDIR: temp,
      TMPDIR: temp,
      TEMP: temp,
      TMP: temp,
      GOCACHE: path.join(temp, 'cache'),
    },
  }).executionContext();
  assert.equal(ctx.ok, true, JSON.stringify(ctx.report));
  for (const command of commands) {
    const result = await runBaselineCommand({
      command,
      cwd: path.join(r, command.cwd),
      executionContext: ctx,
    });
    assert.equal(result.status, 'passed', JSON.stringify(result));
    assert.ok(path.isAbsolute(result.argv[0]));
  }
});

test('linked and oversized metadata are rejected without following external content', () => {
  const outside = root();
  write(outside, 'secret.json', JSON.stringify({ secret: 'must-not-read-external-metadata' }));
  for (const kind of ['hardlink', 'symlink']) {
    const r = root();
    const target = path.join(r, 'package.json');
    if (kind === 'hardlink') fs.linkSync(path.join(outside, 'secret.json'), target);
    else fs.symlinkSync(path.join(outside, 'secret.json'), target, 'file');
    const v = detectStack({ root: r });
    assert.equal(v.scan.complete, false, kind);
    assert.equal(JSON.stringify(v).includes('must-not-read-external-metadata'), false);
  }
  const r = root();
  write(r, 'package.json', ' '.repeat(1024 * 1024 + 1));
  const v = detectStack({ root: r });
  assert.equal(v.scan.complete, false);
  assert.ok(v.scan.issues.some((i) => i.code === 'METADATA_LIMIT'));
});
test('Go workspace minimum version participates in the real environment gate', async () => {
  const r = root();
  write(r, 'go.work', 'go 999.1.0\nuse ./api\n');
  write(r, 'api/go.mod', 'module example.com/api\ngo 1.23\n');
  const checked = await createEnvironmentService({
    root: r,
    cacheRoot: process.env.SPECGATE_E2E_TOOLCHAIN_CACHE,
  }).check();
  assert.equal(checked.environmentReady, false);
  assert.ok(
    checked.selection.requirements.find((r) => r.id === 'go').constraints.includes('>=999.1.0'),
  );
});

test('workspace matching treats literal punctuation literally and globstar exclusions include zero levels', async () => {
  const { workspaceOwner } = await import('../src/codex/core/discovery/scan.js');
  const workspaces = [
    {
      root: '.',
      patterns: ['packages/foo.bar', 'components/**', '!**/test/**'],
      packageManager: 'pnpm',
    },
  ];
  assert.equal(workspaceOwner(workspaces, 'packages/fooXbar'), null);
  assert.equal(workspaceOwner(workspaces, 'packages/foo.bar').packageManager, 'pnpm');
  assert.equal(workspaceOwner(workspaces, 'test/a'), null);
  assert.equal(workspaceOwner(workspaces, 'components/test/a'), null);
  assert.equal(workspaceOwner(workspaces, 'components/a/b').packageManager, 'pnpm');
});

test('native rootless pnpm workspace installs at the workspace root and completes real MCP adoption', async (t) => {
  const r = root();
  const base =
    process.env.SPECGATE_E2E_FORMATTER_TOOLS || path.resolve('.tmp/workflow-repair-tools');
  const receipt = path.join(base, 'pnpm-12.14.0/native/receipt.json');
  const native = fs.existsSync(receipt)
    ? path.dirname(JSON.parse(fs.readFileSync(receipt)).command)
    : '';
  const env = {
    ...process.env,
    PATH: [native, process.env.PATH || process.env.Path].filter(Boolean).join(path.delimiter),
    COREPACK_ENABLE_NETWORK: '0',
    COREPACK_ENABLE_AUTO_PIN: '0',
    npm_config_offline: 'true',
    PNPM_DISABLE_SELF_UPDATE_CHECK: 'true',
  };
  write(r, '.gitignore', 'node_modules/\n.specgate/\n');
  write(r, 'pnpm-workspace.yaml', "packages:\n - 'packages/*'\n");
  write(
    r,
    'packages/web/package.json',
    JSON.stringify({
      name: 'rootless-pnpm-workspace-proof',
      version: '1.0.0',
      private: true,
      scripts: { test: 'node proof.cjs' },
    }),
  );
  write(
    r,
    'packages/web/proof.cjs',
    "require('node:assert/strict').equal(6*7,42);console.log('rootless-pnpm-real-ok');\n",
  );
  run(r, 'pnpm', ['install', '--lockfile-only', '--offline', '--ignore-scripts'], env);
  commit(r);
  const preview = previewAdoption({ projectRoot: r });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const { detectProject } = await import('../src/codex/project-detect.js');
  assert.equal(detectProject({ root: r }).packageManager, 'pnpm');
  assert.equal(preview.profile.commands.install.length, 1);
  assert.equal(preview.profile.commands.install[0].cwd, '.');
  assert.equal(preview.profile.commands.install[0].argv[0], 'pnpm');
  const client = await mcpClient(t, r, { env });
  const p = (await client.call('sg_adopt_preview')).structuredContent;
  assert.equal(p.ok, true, JSON.stringify(p));
  const start = (await client.call('sg_adopt_apply', { previewHash: p.previewHash }))
    .structuredContent;
  assert.equal(start.ok, true, JSON.stringify(start));
  let status;
  for (let i = 0; i < 500; i++) {
    status = (await client.call('sg_project_status')).structuredContent;
    if (status.projectReady || status.baselineRun?.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(status.projectReady, true, JSON.stringify(status));
  assert.equal(status.baseline.status, 'green');
  assert.equal(
    fs.existsSync(path.join(r, 'package.json')),
    false,
    'the original workspace stays rootless',
  );
});

test('scan counters do not invalidate actual environment identity or approved install scope', async () => {
  const { approvalPlan } = await import('../scripts/install-env.mjs');
  const r = root();
  write(r, 'package.json', JSON.stringify({ engines: { node: process.versions.node } }));
  const service = createEnvironmentService({ root: r });
  const first = await service.check();
  assert.equal(first.environmentReady, true, JSON.stringify(first));
  const before = approvalPlan(first, path.join(r, '.specgate/toolchains'));
  write(r, 'README.md', 'A non-toolchain source change\n');
  fs.mkdirSync(path.join(r, '.specgate/toolchains'), { recursive: true });
  const next = await service.check();
  assert.notEqual(first.selection.scan.entries, next.selection.scan.entries);
  assert.equal(first.fingerprint, next.fingerprint);
  assert.equal(approvalPlan(next, path.join(r, '.specgate/toolchains')).planHash, before.planHash);
  write(r, 'services/api/go.mod', 'module example.com/new\ngo 999.1.0\n');
  const changed = await service.check();
  assert.equal(changed.environmentReady, false);
  assert.notEqual(changed.fingerprint, next.fingerprint);
  assert.notEqual(
    approvalPlan(changed, path.join(r, '.specgate/toolchains')).planHash,
    before.planHash,
  );
});

test('Go workspace ownership never substitutes a Node package manager in a mixed module', async () => {
  const r = root();
  write(r, 'go.work', 'go 1.27.3\nuse ./service\n');
  write(r, 'service/go.mod', 'module example.com/mixed\ngo 1.27.3\n');
  write(r, 'service/go.sum', '');
  write(r, 'service/package.json', JSON.stringify({ scripts: { test: 'node proof.cjs' } }));
  const v = detectStack({ root: r });
  assert.equal(v.scan.complete, true, JSON.stringify(v));
  assert.notEqual(v.modules.find((m) => m.root === 'service').packageManager, 'go');
  assert.equal(v.workspaces.find((w) => w.kind === 'go').packageManager, 'go');
  const checked = await createEnvironmentService({
    root: r,
    cacheRoot: process.env.SPECGATE_E2E_TOOLCHAIN_CACHE,
  }).check();
  assert.deepEqual(checked.required, ['git', 'node', 'go']);
});

test('an explicitly selected new stack prepares existing SDKs before its directory exists without claiming a scan', async () => {
  const parent = root(),
    target = path.join(parent, 'new-project');
  const v = await createEnvironmentService({ root: target }).check({ stack: 'node' });
  assert.equal(v.environmentReady, true, JSON.stringify(v));
  assert.equal(v.selection.scan.status, 'not-created');
  assert.equal(v.selection.scan.complete, null);
  assert.equal(fs.existsSync(target), false);
  const file = path.join(parent, 'not-a-directory');
  write(parent, 'not-a-directory', 'keep');
  const bad = await createEnvironmentService({ root: file }).check({ stack: 'node' });
  assert.equal(bad.environmentReady, false);
  assert.equal(bad.code, 'ENV_STACK_UNSUPPORTED');
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
});

test('partial invalid-manifest analysis remains readable while actual adoption stays blocked', async () => {
  const { detectProject } = await import('../src/codex/project-detect.js');
  const r = root();
  write(r, 'package.json', '{}');
  commit(r);
  write(r, 'package.json', 'invalid dirty manifest');
  const analysis = detectProject({ root: r });
  assert.equal(analysis.ok, true);
  assert.equal(analysis.git.clean, false);
  assert.equal(analysis.scan.complete, false);
  assert.ok(analysis.gaps.some((g) => /扫描不完整/.test(g)));
  assert.equal(previewAdoption({ projectRoot: r }).code, 'STACK_SCAN_INCOMPLETE');
  assert.equal((await createEnvironmentService({ root: r }).check()).environmentReady, false);
});

test('native Yarn workspace inherits the root lock manager and rebuilds local workspace links through MCP', async (t) => {
  const r = root(),
    temp = root(process.env.SPECGATE_E2E_EXECUTION_TEMP || os.tmpdir());
  const base =
    process.env.SPECGATE_E2E_FORMATTER_TOOLS || path.resolve('.tmp/workflow-repair-tools');
  const env = {
    ...process.env,
    PATH: [path.join(base, 'yarn-1.22.22'), process.env.PATH || process.env.Path].join(
      path.delimiter,
    ),
    YARN_CACHE_FOLDER: path.join(temp, 'cache'),
    YARN_GLOBAL_FOLDER: path.join(temp, 'global'),
    YARN_DISABLE_SELF_UPDATE_CHECK: '1',
    COREPACK_ENABLE_NETWORK: '0',
    COREPACK_ENABLE_AUTO_PIN: '0',
    npm_config_offline: 'true',
  };
  write(r, '.gitignore', 'node_modules/\n.specgate/\n');
  write(
    r,
    'package.json',
    JSON.stringify({
      name: 'yarn-workspace-root',
      version: '1.0.0',
      private: true,
      workspaces: { packages: ['packages/*'] },
    }),
  );
  write(
    r,
    'packages/lib/package.json',
    JSON.stringify({ name: 'yarn-workspace-proof-lib', version: '1.0.0', main: 'index.cjs' }),
  );
  write(r, 'packages/lib/index.cjs', "module.exports='yarn-workspace-real-ok';\n");
  write(
    r,
    'packages/web/package.json',
    JSON.stringify({
      name: 'yarn-workspace-proof-web',
      version: '1.0.0',
      dependencies: { 'yarn-workspace-proof-lib': '1.0.0' },
      scripts: { test: 'node proof.cjs' },
    }),
  );
  write(
    r,
    'packages/web/proof.cjs',
    "require('node:assert/strict').equal(require('yarn-workspace-proof-lib'),'yarn-workspace-real-ok');console.log('yarn-workspace-real-ok');\n",
  );
  run(r, 'yarn', ['install', '--offline', '--ignore-scripts', '--non-interactive'], env);
  commit(r);
  const found = detectStack({ root: r });
  assert.equal(found.scan.complete, true, JSON.stringify(found));
  assert.equal(found.modules.find((m) => m.root === 'packages/web').packageManager, 'yarn');
  const preview = previewAdoption({ projectRoot: r });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.profile.commands.install.length, 1);
  assert.equal(preview.profile.commands.install[0].argv[0], 'yarn');
  const client = await mcpClient(t, r, { env });
  const p = (await client.call('sg_adopt_preview')).structuredContent;
  const start = (await client.call('sg_adopt_apply', { previewHash: p.previewHash }))
    .structuredContent;
  assert.equal(start.ok, true, JSON.stringify(start));
  let status;
  for (let i = 0; i < 500; i++) {
    status = (await client.call('sg_project_status')).structuredContent;
    if (status.projectReady || status.baselineRun?.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(status.projectReady, true, JSON.stringify(status));
  assert.equal(status.baseline.status, 'green');
});

test('colliding Node module path slugs produce distinct bounded command identities in real adoption', async (t) => {
  const r = root();
  write(r, '.gitignore', 'node_modules/\n.specgate/\n');
  for (const [directory, marker] of [
    ['apps/web', 'nested-command-ok'],
    ['apps-web', 'flat-command-ok'],
  ])
    write(
      r,
      directory + '/package.json',
      JSON.stringify({
        name: marker,
        version: '1.0.0',
        scripts: { test: `node -e "console.log('${marker}')"` },
      }),
    );
  commit(r);
  const preview = previewAdoption({ projectRoot: r });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const all = Object.values(preview.profile.commands).flat();
  assert.equal(new Set(all.map((c) => c.id)).size, all.length, JSON.stringify(all));
  assert.ok(all.every((c) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(c.id)));
  const { validateProjectProfile } = await import('../src/codex/project-model.js');
  const duplicate = structuredClone(preview.profile);
  duplicate.commands.test[1].id = duplicate.commands.test[0].id;
  assert.equal(validateProjectProfile(duplicate).code, 'PROJECT_COMMANDS_INVALID');
  const longRoot = root();
  write(
    longRoot,
    'long-' + 'x'.repeat(112) + '/package.json',
    JSON.stringify({
      name: 'long-command-id',
      version: '1.0.0',
      scripts: { test: 'node -e "process.exit(0)"' },
    }),
  );
  commit(longRoot);
  const longPreview = previewAdoption({ projectRoot: longRoot });
  assert.equal(longPreview.ok, true, JSON.stringify(longPreview));
  assert.ok(
    Object.values(longPreview.profile.commands)
      .flat()
      .every((c) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(c.id)),
  );
  const client = await mcpClient(t, r);
  const p = (await client.call('sg_adopt_preview')).structuredContent;
  const start = (await client.call('sg_adopt_apply', { previewHash: p.previewHash }))
    .structuredContent;
  assert.equal(start.ok, true, JSON.stringify(start));
  let status;
  for (let i = 0; i < 500; i++) {
    status = (await client.call('sg_project_status')).structuredContent;
    if (status.projectReady || status.baselineRun?.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(status.projectReady, true, JSON.stringify(status));
  const summary = JSON.parse(
    fs.readFileSync(path.join(r, '.specgate/codex/baseline-runs', start.runId, 'summary.json')),
  );
  const tests = summary.commands.filter((c) => c.kind === 'test');
  assert.equal(tests.length, 2);
  assert.ok(tests.some((c) => /nested-command-ok/.test(c.stdout)));
  assert.ok(tests.some((c) => /flat-command-ok/.test(c.stdout)));
});
