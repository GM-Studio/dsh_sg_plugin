import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mcpClient } from './environment-mcp-client.mjs';
import { previewAdoption } from '../src/codex/project-adopt.js';
import { runAdoptionBaseline } from '../src/codex/baseline.js';
import { projectCommandSpec } from '../src/codex/core/project-command.js';
import { createEnvironmentService } from '../src/codex/core/environment.js';
import { installForSuite } from '../src/codex/core/env/install.js';

const roots = [];
test.after(() => {
  for (const root of roots)
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});
function temporary(parent = os.tmpdir()) {
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'sg-env-dependencies-'));
  roots.push(root);
  return root;
}
function execute(root, executable, args) {
  const command = projectCommandSpec(executable, args);
  const result = spawnSync(command.command, command.args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: command.windowsVerbatimArguments,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result;
}
function commit(root) {
  execute(root, 'git', ['init', '-q', '-b', 'main']);
  execute(root, 'git', ['config', 'user.name', 'Dependency Fixture']);
  execute(root, 'git', ['config', 'user.email', 'fixture@localhost']);
  execute(root, 'git', ['add', '.']);
  execute(root, 'git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
}
async function adopt(t, root, env = {}) {
  const client = await mcpClient(t, root, { env });
  const preview = (await client.call('sg_adopt_preview')).structuredContent;
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const started = (await client.call('sg_adopt_apply', { previewHash: preview.previewHash }))
    .structuredContent;
  assert.equal(started.ok, true, JSON.stringify(started));
  let status;
  for (let i = 0; i < 500; i++) {
    status = (await client.call('sg_project_status')).structuredContent;
    if (status.projectReady || status.baselineRun?.status === 'failed') return { status, started };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail('detached baseline did not complete: ' + JSON.stringify(status));
}

test('a real locked local npm dependency is rebuilt in the detached worker despite source node_modules', async (t) => {
  const root = temporary();
  fs.mkdirSync(path.join(root, 'vendor', 'proof'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(
    path.join(root, 'vendor/proof/package.json'),
    JSON.stringify({ name: 'environment-proof-dependency', version: '1.0.0', main: 'index.js' }),
  );
  fs.writeFileSync(
    path.join(root, 'vendor/proof/index.js'),
    'module.exports = "installed-in-worktree";\n',
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'dependency-proof',
      version: '1.0.0',
      private: true,
      dependencies: { 'environment-proof-dependency': 'file:vendor/proof' },
      scripts: {
        test: "node -e \"require('node:assert/strict').equal(require('environment-proof-dependency'),'installed-in-worktree'); console.log('real-dependency-ok')\"",
      },
    }),
  );
  execute(root, 'npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
  execute(root, 'npm', ['test', '--offline']);
  assert.ok(fs.existsSync(path.join(root, 'node_modules/environment-proof-dependency')));
  commit(root);
  const preview = previewAdoption({ projectRoot: root });
  assert.deepEqual(preview.profile.commands.install.find((entry) => entry.cwd === '.')?.argv, [
    'npm',
    'ci',
  ]);
  const { status, started } = await adopt(t, root);
  assert.equal(status.projectReady, true, JSON.stringify(status));
  assert.equal(status.baseline.status, 'green');
  const summary = JSON.parse(
    fs.readFileSync(
      path.join(root, '.specgate/codex/baseline-runs', started.runId, 'summary.json'),
      'utf8',
    ),
  );
  assert.equal(summary.commands.find((entry) => entry.kind === 'install').status, 'passed');
  assert.match(
    summary.commands.find((entry) => entry.kind === 'test').stdout,
    /real-dependency-ok/,
  );
});

test('a real missing module blocks MCP adoption rather than becoming an accepted known failure', async (t) => {
  const root = temporary();
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'missing-proof',
      version: '1.0.0',
      scripts: { test: 'node -e "require(\'specgate-intentionally-absent-package\')"' },
    }),
  );
  commit(root);
  const { status, started } = await adopt(t, root);
  assert.equal(status.projectReady, false, JSON.stringify(status));
  assert.equal(status.baselineRun.status, 'failed');
  assert.equal(status.baselineRun.code, 'BASELINE_INFRASTRUCTURE_FAILED');
  assert.equal(fs.existsSync(path.join(root, '.specgate/codex/project.json')), false);
  const summary = JSON.parse(
    fs.readFileSync(
      path.join(root, '.specgate/codex/baseline-runs', started.runId, 'summary.json'),
      'utf8',
    ),
  );
  assert.equal(summary.baseline, null);
  assert.equal(summary.failure.code, 'BASELINE_INFRASTRUCTURE_FAILED');
  assert.match(summary.commands.at(-1).stderr, /Cannot find module/);
});

test('actual timeout, absent executable and failed installation cannot produce a usable baseline', async () => {
  const root = temporary();
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'failure-proof', scripts: { test: 'node --version' } }),
  );
  commit(root);
  for (const [kind, argv, timeoutMs] of [
    ['test', [process.execPath, '-e', 'setInterval(() => {}, 1000)'], 1000],
    ['test', ['specgate-intentionally-absent-executable'], 1000],
    [
      'test',
      [process.execPath, '-e', 'console.error("opaque process failure"); process.exit(2)'],
      1000,
    ],
    [
      'install',
      [process.execPath, '-e', 'console.error("installation rejected"); process.exit(2)'],
      1000,
    ],
  ]) {
    const preview = previewAdoption({ projectRoot: root });
    for (const key of Object.keys(preview.profile.commands)) preview.profile.commands[key] = [];
    preview.profile.commands[kind] = [{ id: 'failure-proof', cwd: '.', argv, timeoutMs }];
    const result = await runAdoptionBaseline({ preview });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.code, 'BASELINE_INFRASTRUCTURE_FAILED');
    assert.equal(result.results.length, 1, 'preserve actual failing command evidence');
  }
  const preview = previewAdoption({ projectRoot: root });
  for (const key of Object.keys(preview.profile.commands)) preview.profile.commands[key] = [];
  preview.profile.commands.test = [
    {
      id: 'business-assertion',
      cwd: '.',
      argv: [process.execPath, '-e', 'require("node:assert/strict").equal(1,2)'],
    },
  ];
  const business = await runAdoptionBaseline({ preview });
  assert.equal(business.ok, true, JSON.stringify(business));
  assert.equal(business.baseline.status, 'known-failures');
});

test('real evidence storage failure keeps an otherwise passing baseline unready', async (t) => {
  const root = temporary();
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n.specgate/\n');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'evidence-failure-proof',
      version: '1.0.0',
      scripts: { test: 'node --version' },
    }),
  );
  commit(root);
  fs.mkdirSync(path.join(root, '.specgate/codex'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate/codex/baseline-runs'),
    'A file cannot contain evidence directories.\n',
  );
  const { status } = await adopt(t, root);
  assert.equal(status.projectReady, false, JSON.stringify(status));
  assert.equal(status.baselineRun.status, 'failed');
  const diagnostic = JSON.parse(
    fs.readFileSync(
      path.join(root, '.git/specgate/baseline-jobs', status.baselineRun.runId, 'results.json'),
      'utf8',
    ),
  );
  assert.equal(
    status.baselineRun.code,
    'BASELINE_EVIDENCE_FAILED',
    JSON.stringify({ status, diagnostic }),
  );
});

test('Python installs a local wheel in a worktree venv, reuses it and completes native MCP adoption', async (t) => {
  const root = temporary();
  fs.writeFileSync(path.join(root, '.gitignore'), '.venv/\n__pycache__/\n');
  fs.writeFileSync(path.join(root, '.python-version'), '3.12.16\n');
  fs.writeFileSync(
    path.join(root, 'requirements.txt'),
    './environment_dependency-1.0.0-py3-none-any.whl\n',
  );
  fs.writeFileSync(
    path.join(root, 'test_environment.py'),
    'import unittest,sys,environment_dependency\nclass Proof(unittest.TestCase):\n def test_dependency(self):\n  self.assertEqual(environment_dependency.VALUE,"local-wheel-ok")\n  self.assertNotEqual(sys.prefix,sys.base_prefix)\n',
  );
  const service = createEnvironmentService({
    root,
    cacheRoot: process.env.SPECGATE_E2E_TOOLCHAIN_CACHE,
  });
  const context = await service.executionContext();
  assert.equal(context.ok, true, JSON.stringify(context.report));
  const wheel = [
    'import zipfile',
    'with zipfile.ZipFile("environment_dependency-1.0.0-py3-none-any.whl","w") as z:',
    ' z.writestr("environment_dependency.py",\'VALUE="local-wheel-ok"\\n\')',
    ' z.writestr("environment_dependency-1.0.0.dist-info/METADATA","Metadata-Version: 2.1\\nName: environment-dependency\\nVersion: 1.0.0\\n")',
    ' z.writestr("environment_dependency-1.0.0.dist-info/WHEEL","Wheel-Version: 1.0\\nGenerator: proof\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n")',
    ' z.writestr("environment_dependency-1.0.0.dist-info/RECORD","")',
  ].join('\n');
  const executionRoot = temporary(process.env.SPECGATE_E2E_EXECUTION_TEMP || os.tmpdir());
  execute(executionRoot, context.tools.python.path, ['-c', wheel]);
  fs.copyFileSync(
    path.join(executionRoot, 'environment_dependency-1.0.0-py3-none-any.whl'),
    path.join(root, 'environment_dependency-1.0.0-py3-none-any.whl'),
  );
  commit(root);
  const worktree = path.join(executionRoot, 'python-worktree');
  execute(root, 'git', ['worktree', 'add', '--detach', worktree, 'HEAD']);
  try {
    const executionContext = await createEnvironmentService({
      root: worktree,
      cacheRoot: process.env.SPECGATE_E2E_TOOLCHAIN_CACHE,
      env: { ...process.env, PIP_NO_INDEX: '1' },
    }).executionContext();
    const result = await runAdoptionBaseline({
      preview: { ...previewAdoption({ projectRoot: root }), root: worktree },
      executionContext,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.baseline.status, 'green', JSON.stringify(result));
    assert.ok(
      result.results
        .find((entry) => entry.command.kind === 'test')
        .result.argv[0].startsWith(path.join(worktree, '.venv')),
    );
    assert.equal(fs.existsSync(path.join(root, '.venv')), false);
    const repeatedContext = await createEnvironmentService({
      root: worktree,
      cacheRoot: process.env.SPECGATE_E2E_TOOLCHAIN_CACHE,
      env: { ...process.env, PIP_NO_INDEX: '1' },
    }).executionContext();
    const repeated = await runAdoptionBaseline({
      preview: { ...previewAdoption({ projectRoot: root }), root: worktree },
      executionContext: repeatedContext,
    });
    assert.equal(repeated.ok, true, JSON.stringify(repeated));
    assert.equal(repeated.baseline.status, 'green', JSON.stringify(repeated));
    assert.match(
      repeated.results.find((entry) => entry.command.id.endsWith('-python-venv')).result.stdout,
      /Reusing project virtual environment/,
    );
  } finally {
    execute(root, 'git', ['worktree', 'remove', '--force', worktree]);
  }
  const { status, started } = await adopt(t, root, {
    PATH: path.dirname(context.tools.python.path) + path.delimiter + process.env.PATH,
    PIP_NO_INDEX: '1',
    SPECGATE_BASELINE_WORKTREE_ROOT: path.join(executionRoot, 'native-worker'),
  });
  assert.equal(status.projectReady, true, JSON.stringify(status));
  assert.equal(status.baseline.status, 'green');
  const summary = JSON.parse(
    fs.readFileSync(
      path.join(root, '.specgate/codex/baseline-runs', started.runId, 'summary.json'),
      'utf8',
    ),
  );
  assert.ok(
    summary.commands
      .find((entry) => entry.kind === 'test')
      .executedArgv[0].startsWith(path.join(executionRoot, 'native-worker')),
  );
});

test('Go compiles a real project in its isolated worktree and completes native MCP adoption', async (t) => {
  const root = temporary();
  fs.writeFileSync(
    path.join(root, 'go.mod'),
    'module example.com/environment-proof\n\ngo 1.27.3\n',
  );
  fs.writeFileSync(
    path.join(root, 'proof.go'),
    'package proof\nfunc Value() string { return "real-go-ok" }\n',
  );
  fs.writeFileSync(
    path.join(root, 'proof_test.go'),
    'package proof\nimport "testing"\nfunc TestProof(t *testing.T) { if Value() != "real-go-ok" { t.Fatal("incorrect value") } }\n',
  );
  commit(root);
  const executionRoot = temporary(process.env.SPECGATE_E2E_EXECUTION_TEMP || os.tmpdir());
  const worktree = path.join(executionRoot, 'go-worktree');
  let tool;
  execute(root, 'git', ['worktree', 'add', '--detach', worktree, 'HEAD']);
  try {
    const temp = temporary(executionRoot);
    const executionContext = await createEnvironmentService({
      root: worktree,
      cacheRoot: process.env.SPECGATE_E2E_TOOLCHAIN_CACHE,
      env: {
        ...process.env,
        TEMP: temp,
        TMP: temp,
        TMPDIR: temp,
        GOTMPDIR: temp,
        GOCACHE: path.join(temp, 'go-cache'),
        GOPROXY: 'off',
        GOSUMDB: 'off',
        GOWORK: 'off',
      },
    }).executionContext();
    assert.equal(executionContext.ok, true, JSON.stringify(executionContext.report));
    tool = executionContext.tools.go;
    const result = await runAdoptionBaseline({
      preview: { ...previewAdoption({ projectRoot: root }), root: worktree },
      executionContext,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.baseline.status, 'green', JSON.stringify(result));
    assert.match(
      result.results.find((entry) => entry.command.kind === 'test').result.stdout,
      /ok\s+example.com\/environment-proof/,
    );
  } finally {
    execute(root, 'git', ['worktree', 'remove', '--force', worktree]);
  }
  const { status } = await adopt(t, root, {
    PATH: path.dirname(tool.path) + path.delimiter + process.env.PATH,
    GOROOT: path.dirname(path.dirname(tool.path)),
    GOCACHE: path.join(executionRoot, 'native-go-cache'),
    GOTOOLCHAIN: 'local',
    GOPROXY: 'off',
    GOSUMDB: 'off',
    GOWORK: 'off',
    SPECGATE_BASELINE_WORKTREE_ROOT: path.join(executionRoot, 'native-worker'),
  });
  assert.equal(status.projectReady, true, JSON.stringify(status));
  assert.equal(status.baseline.status, 'green');
});

test('a past suite install marker cannot hide deleted dependencies', () => {
  const root = temporary();
  fs.mkdirSync(path.join(root, 'vendor'));
  fs.writeFileSync(
    path.join(root, 'vendor/package.json'),
    JSON.stringify({ name: 'suite-proof', version: '1.0.0' }),
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'suite-installer-proof',
      version: '1.0.0',
      dependencies: { 'suite-proof': 'file:vendor' },
    }),
  );
  const suite = { id: 'dependency-proof', kind: 'node', install: true };
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = installForSuite({ root, suite });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(fs.existsSync(path.join(root, 'node_modules/suite-proof')));
    fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
  }
});
