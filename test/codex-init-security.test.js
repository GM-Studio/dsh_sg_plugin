import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { previewInit, executeInit } from '../src/codex/init.js';
import { createStateStore } from '../src/codex/state-machine.js';

const moduleUrl = pathToFileURL(path.resolve('src/codex/init.js')).href;
const cleanEnv = () => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
  ),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
  GIT_OPTIONAL_LOCKS: '0',
});
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-init-security-'));

function repository(root) {
  fs.mkdirSync(root, { recursive: true });
  const hooks = path.join(root, '.empty-hooks');
  fs.mkdirSync(hooks);
  const git = (args) => {
    const result = spawnSync(
      'git',
      [
        '-c',
        'user.name=Security fixture',
        '-c',
        'user.email=fixture@local',
        '-c',
        'core.hooksPath=' + hooks,
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: root, encoding: 'utf8', env: cleanEnv() },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-q']);
  fs.writeFileSync(path.join(root, 'business.txt'), 'committed business');
  git(['add', '--', 'business.txt']);
  git(['commit', '-q', '-m', 'fixture baseline']);
  fs.writeFileSync(path.join(root, 'business.txt'), 'preserve unstaged business');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'preserve untracked business');
  return {
    git,
    snapshot: () => ({
      head: git(['rev-parse', 'HEAD']),
      refs: git(['show-ref']),
      status: git(['status', '--porcelain=v1', '--untracked-files=all']),
      index: createHash('sha256')
        .update(fs.readFileSync(path.join(root, '.git/index')))
        .digest('hex'),
      business: fs.readFileSync(path.join(root, 'business.txt'), 'utf8'),
      untracked: fs.readFileSync(path.join(root, 'untracked.txt'), 'utf8'),
    }),
  };
}

test('isolated generation ignores inherited Git locations, config injection, global templates and hooks', () => {
  const base = temporary();
  const external = path.join(base, 'external-repository');
  const fixture = repository(external);
  const before = fixture.snapshot();
  const marker = path.join(base, 'hook-executed.txt');
  const template = path.join(base, 'hostile-template');
  fs.mkdirSync(path.join(template, 'hooks'), { recursive: true });
  const hook =
    '#!/bin/sh\nprintf executed > ' +
    "'" +
    marker.replaceAll('\\', '/').replaceAll("'", "'\\''") +
    "'\nexit 93\n";
  fs.writeFileSync(path.join(template, 'hooks', 'pre-commit'), hook, { mode: 0o755 });
  const config = path.join(base, 'hostile-global.gitconfig');
  fs.writeFileSync(
    config,
    '[init]\n\ttemplateDir = ' + JSON.stringify(template.replaceAll('\\', '/')) + '\n',
  );
  const root = path.join(base, 'generated-app');
  const script = `import {previewInit,executeInit} from ${JSON.stringify(moduleUrl)};
    const root=process.argv[1];const input={root,gitName:'Security fixture',gitEmail:'fixture@example.test'};const preview=previewInit(input);
    process.stdout.write(JSON.stringify(await executeInit({...input,previewHash:preview.previewHash})));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_DIR: path.join(external, '.git'),
      GIT_WORK_TREE: external,
      GIT_INDEX_FILE: path.join(external, '.git', 'index'),
      GIT_CONFIG_GLOBAL: config,
      GIT_TEMPLATE_DIR: template,
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: path.join(template, 'hooks'),
      GIT_CONFIG_KEY_1: 'init.templateDir',
      GIT_CONFIG_VALUE_1: template,
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const generated = JSON.parse(result.stdout);
  assert.equal(generated.ok, true, JSON.stringify(generated));
  assert.equal(generated.code, 'GENERATED_ONLY');
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(fixture.snapshot(), before);
  assert.equal(fs.existsSync(path.join(root, '.git/hooks/pre-commit')), false);
});

test('targets inside an enclosing repository are previewed accurately and never create nested baselines', async () => {
  const base = temporary();
  const external = path.join(base, 'external-repository');
  const fixture = repository(external);
  const existing = path.join(external, 'empty-app');
  fs.mkdirSync(existing);
  for (const root of [existing, path.join(external, 'missing', 'app')]) {
    const before = fixture.snapshot();
    const preview = previewInit({ root });
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal(preview.git.repository, true);
    assert.equal(preview.git.enclosing, true);
    assert.equal(path.resolve(preview.git.root), path.resolve(external));
    const generated = await executeInit({ root, previewHash: preview.previewHash });
    assert.equal(generated.code, 'INIT_EXISTING_GIT_UNSUPPORTED');
    assert.deepEqual(fixture.snapshot(), before);
    assert.equal(fs.existsSync(path.join(root, '.git')), false);
    assert.equal(fs.existsSync(path.join(root, '.specgate')), false);
    if (root !== existing) assert.equal(fs.existsSync(root), false);
  }
});

test('an already cancelled initialization creates no target, lock or staging directory', async () => {
  const base = temporary();
  const root = path.join(base, 'missing-app');
  const preview = previewInit({ root });
  const controller = new AbortController();
  controller.abort();
  const result = await executeInit(
    { root, previewHash: preview.previewHash },
    { signal: controller.signal },
  );
  assert.equal(result.code, 'INIT_CANCELLED');
  assert.deepEqual(fs.readdirSync(base), []);
});

test('generated baseline tracks stable configuration while runtime state stays ignored and business changes stay visible', async () => {
  const root = path.join(temporary(), 'app');
  const preview = previewInit({ root });
  assert.equal(preview.files.new.includes('.specgate/.gitignore'), true);
  const generated = await executeInit({ root, previewHash: preview.previewHash });
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: cleanEnv() });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '');
  assert.equal(
    git(['ls-files', '.specgate/state.json', '.specgate/init-report.json', '.specgate/codex']),
    '',
  );
  for (const relative of [
    '.specgate/.gitignore',
    '.specgate/config.yaml',
    '.specgate/monorepo.json',
    '.specgate/golden.json',
    '.specgate/template-style.json',
    'backend/pom.xml',
    'openspec/REQ.md',
  ])
    assert.equal(git(['ls-files', '--', relative]), relative);
  assert.equal(git(['rev-parse', 'init-baseline']), generated.report.gitBaseline.commit);
  const stateFile = path.join(root, '.specgate/state.json');
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ ...JSON.parse(fs.readFileSync(stateFile)), changed: true }),
  );
  const reportFile = path.join(root, '.specgate/init-report.json');
  fs.writeFileSync(
    reportFile,
    JSON.stringify({ ...JSON.parse(fs.readFileSync(reportFile)), initializationComplete: false }),
  );
  fs.mkdirSync(path.join(root, '.specgate/codex-verify-runs/example'), { recursive: true });
  fs.writeFileSync(path.join(root, '.specgate/codex-verify-report.json'), '{"ok":false}');
  fs.writeFileSync(
    path.join(root, '.specgate/codex-verify-runs/example/report.json'),
    '{"ok":false}',
  );
  const store = createStateStore({ projectRoot: root });
  assert.equal((await store.create({ expectedVersion: 0, changeId: 'runtime-example' })).ok, true);
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '');
  fs.writeFileSync(path.join(root, 'business-untracked.txt'), 'this must remain visible');
  assert.match(
    git(['status', '--porcelain=v1', '--untracked-files=all']),
    /\?\? business-untracked\.txt/,
  );
});

test('delivery configuration and accepted records stay visible while runtime evidence remains ignored', async () => {
  const root = path.join(temporary(), 'app');
  const preview = previewInit({ root });
  const generated = await executeInit({ root, previewHash: preview.previewHash });
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const files = {
    '.specgate/codex/project.json': '{"projectId":"project-1"}\n',
    '.specgate/codex/baselines/baseline-1.json': '{"baselineId":"baseline-1"}\n',
    '.specgate/codex/changes/change-1/contract/contract.json': '{"changeId":"change-1"}\n',
    '.specgate/codex/deliveries/delivery-1/record.json': '{"deliveryId":"delivery-1"}\n',
    '.specgate/codex/evidence/test.log': 'raw runtime evidence\n',
    '.specgate/codex/worktrees/change-1/frontend/README.md': 'worktree\n',
  };
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: cleanEnv() });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  assert.match(status, /\?\? \.specgate\/codex\/project\.json/);
  assert.match(status, /\?\? \.specgate\/codex\/baselines\/baseline-1\.json/);
  assert.match(status, /\?\? \.specgate\/codex\/changes\/change-1\/contract\/contract\.json/);
  assert.match(status, /\?\? \.specgate\/codex\/deliveries\/delivery-1\/record\.json/);
  assert.doesNotMatch(status, /evidence\/test\.log/);
  assert.doesNotMatch(status, /worktrees\/change-1/);
});
