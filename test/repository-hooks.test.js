import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  exportSnapshot,
  changedFiles,
  classifyFile,
  checksFor,
} from '../scripts/quality-snapshot.mjs';
import { runChecks } from '../scripts/quality-checks.mjs';
import { installHooks } from '../scripts/install-hooks.mjs';
import { inspectSnapshot } from '../scripts/quality-gate.mjs';
import { fileURLToPath } from 'node:url';
import { materializeReference } from '../scripts/quality-reference.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-hook-'));
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.name', 'Hook test']);
  git(['config', 'user.email', 'hook@local']);
  git(['config', 'core.hooksPath', path.join(root, 'disabled-hooks')]);
  fs.writeFileSync(path.join(root, '中文 space.js'), 'export const value = 1;\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'baseline']);
  return { root, git };
}

test('commit snapshot checks staged bytes and never stages unstaged edits', () => {
  const { root, git } = fixture();
  const name = '中文 space.js';
  fs.writeFileSync(path.join(root, name), 'export const value = 2;\n');
  git(['add', '--', name]);
  fs.writeFileSync(path.join(root, name), 'export const value = 3;\n');
  const before = git(['diff', '--cached']);
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-snapshot-'));
  exportSnapshot(root, 'index', destination);
  assert.equal(fs.readFileSync(path.join(destination, name), 'utf8'), 'export const value = 2;\n');
  assert.equal(git(['diff', '--cached']), before);
  assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), 'export const value = 3;\n');
  assert.deepEqual(changedFiles(root, 'index'), [name]);
});

test('push snapshot reads selected ref, not current checkout; deletions remain test triggers', () => {
  const { root, git } = fixture();
  const baseline = git(['rev-parse', 'HEAD']);
  git(['rm', '--', '中文 space.js']);
  assert.deepEqual(changedFiles(root, 'index'), ['中文 space.js']);
  assert.equal(checksFor(['中文 space.js'], 'commit').tests, true);
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-snapshot-'));
  exportSnapshot(root, baseline, destination);
  assert.equal(
    fs.readFileSync(path.join(destination, '中文 space.js'), 'utf8'),
    'export const value = 1;\n',
  );
});

test('coverage routes templates and assets, rejects unsupported code and selects acceptance strength', () => {
  assert.equal(
    classifyFile('assets/java-vue/template/backend/src/main/java/Foo.java.tpl'),
    'java-template',
  );
  assert.equal(classifyFile('assets/scaffold/node/items.js'), 'javascript');
  assert.equal(classifyFile('assets/example.ts'), 'typescript');
  assert.equal(classifyFile('test/fixtures/a.py'), 'python');
  assert.equal(classifyFile('new.cpp'), 'unsupported');
  assert.equal(classifyFile('assets/new.js.template'), 'unsupported');
  assert.equal(classifyFile('assets/java-vue/template/frontend/hidden.rb.tpl'), 'unsupported');
  assert.equal(classifyFile('assets/java-vue/template/backend/src/ignored.ts.tpl'), 'unsupported');
  assert.equal(classifyFile('assets/java-vue/template/frontend/ignored.java.tpl'), 'unsupported');
  assert.equal(classifyFile('test/fixtures/reference-note/ignored.ts.tpl'), 'unsupported');
  assert.equal(classifyFile('assets/scaffold/java/nested/ItemController.java'), 'unsupported');
  assert.deepEqual(
    checksFor(['assets/java-vue/template/frontend/src/App.vue.tpl'], 'commit').presets,
    ['jdk8-boot2.7'],
  );
  assert.equal(checksFor(['src/v4/java-verify.js'], 'push').presets.length, 4);
  assert.equal(checksFor(['src/v4/reviewer.js'], 'push').presets.length, 4);
  assert.equal(checksFor(['scripts/git-hooks/pre-push'], 'push').presets.length, 4);
  assert.equal(checksFor(['assets/java-vue/template/deleted.java.tpl'], 'commit').tests, true);
});

test('format failure and test failure both reject, with zero source writes', async () => {
  const { root } = fixture();
  const commands = [];
  const execute = (label) => {
    commands.push(label);
    if (label.includes('format')) throw new Error('format failure');
  };
  await assert.rejects(
    runChecks({ root, files: ['中文 space.js'], stage: 'commit', execute }),
    /format failure/,
  );
  assert.ok(commands.some((item) => item.includes('format')));
  const executeTest = (label) => {
    if (label === 'plugin-tests') throw new Error('test failure');
  };
  await assert.rejects(
    runChecks({ root, files: ['deleted.js'], stage: 'commit', execute: executeTest }),
    /test failure/,
  );
});

test('installer preserves custom hooks and diagnoses stale managed hooks atomically', () => {
  const { root } = fixture();
  const hooks = path.join(root, 'disabled-hooks');
  fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho custom\n');
  assert.throws(() => installHooks({ root }), /custom|自定义/i);
  assert.equal(fs.readFileSync(path.join(hooks, 'pre-commit'), 'utf8'), '#!/bin/sh\necho custom\n');
  assert.equal(fs.existsSync(path.join(hooks, 'pre-push')), false);
});

test('installer upgrades only exact old managed hooks and preserves user additions', () => {
  const { root } = fixture();
  const hooks = path.join(root, 'disabled-hooks');
  const source = fileURLToPath(new URL('../scripts/git-hooks/', import.meta.url));
  fs.mkdirSync(hooks);
  const content = fs.readFileSync(path.join(source, 'pre-commit'), 'utf8').replaceAll('\r\n', '\n');
  fs.writeFileSync(path.join(hooks, 'pre-commit'), content.replace('--check', '--fix'));
  assert.throws(() => installHooks({ root, check: true }), /hooks:install/);
  installHooks({ root });
  assert.equal(fs.readFileSync(path.join(hooks, 'pre-commit'), 'utf8'), content);
  fs.appendFileSync(path.join(hooks, 'pre-commit'), 'echo custom\n');
  assert.throws(() => installHooks({ root }), /custom/i);
  assert.ok(fs.readFileSync(path.join(hooks, 'pre-commit'), 'utf8').endsWith('echo custom\n'));
});

test('reference acceptance materializes exact candidate fixture bytes without formatting', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-note-'));
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const targets = materializeReference(root, repo);
  for (const [name, target] of Object.entries(targets))
    assert.deepEqual(
      fs.readFileSync(path.join(root, target)),
      fs.readFileSync(path.join(repo, 'test/fixtures/reference-note', name + '.tpl')),
    );
  assert.match(
    fs.readFileSync(
      path.join(root, 'backend/src/main/java/com/example/tasks/controller/NoteController.java'),
      'utf8',
    ),
    /NoteService/,
  );
});

test('deleted reference source still invokes materialization acceptance and propagates failure', async () => {
  if (process.platform !== 'win32') return;
  const { root } = fixture();
  await assert.rejects(
    runChecks({
      root,
      files: ['test/fixtures/reference-note/notes.ts.tpl'],
      stage: 'commit',
      execute: (label) => {
        if (label === 'code-assets') throw new Error('deleted reference failed');
      },
    }),
    /deleted reference failed/,
  );
});

test('modified vendor wrapper blocks and filenames cannot inject checker options', async () => {
  const { root } = fixture();
  const name = 'assets/java-vue/template/backend/mvnw.cmd.tpl';
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), 'echo changed');
  await assert.rejects(
    runChecks({ root, files: [name], stage: 'commit', execute: () => {} }),
    /Vendor wrapper changed/,
  );
  fs.writeFileSync(path.join(root, '--fix.js'), 'export const x = 1;\n');
  const commands = [];
  await runChecks({
    root,
    files: ['--fix.js'],
    stage: 'commit',
    execute: (label, command, args) => commands.push({ label, args }),
  });
  for (const { args } of commands.filter(({ label }) => label !== 'plugin-tests'))
    assert.ok(args.indexOf('--') < args.indexOf('--fix.js'));
});

test('real format failure blocks the snapshot and preserves source, index and shared dependencies', async () => {
  const { root, git } = fixture();
  const source = fileURLToPath(new URL('../', import.meta.url));
  for (const name of ['package-lock.json', 'eslint.config.js', '.prettierrc.json'])
    fs.copyFileSync(path.join(source, name), path.join(root, name));
  fs.symlinkSync(
    path.join(source, 'node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  fs.writeFileSync(path.join(root, '中文 space.js'), 'export const value=2\n');
  git(['add', '--', '中文 space.js', 'package-lock.json', 'eslint.config.js', '.prettierrc.json']);
  const initialIndex = git(['diff', '--cached']);
  await assert.rejects(
    inspectSnapshot({ root, ref: 'index', stage: 'commit' }),
    /format-check failed/,
  );
  assert.equal(git(['diff', '--cached']), initialIndex);
  assert.equal(fs.readFileSync(path.join(root, '中文 space.js'), 'utf8'), 'export const value=2\n');
  assert.ok(fs.existsSync(path.join(source, 'node_modules/eslint/bin/eslint.js')));
  const runs = fs.readdirSync(path.join(root, '.specgate/hooks-runs'));
  assert.ok(fs.existsSync(path.join(root, '.specgate/hooks-runs', runs[0], 'quality-failure.txt')));
});

test('snapshot success checks staged code, ignores unstaged edits and leaves index untouched', async () => {
  const { root, git } = fixture();
  const source = fileURLToPath(new URL('../', import.meta.url));
  fs.copyFileSync(path.join(source, 'package-lock.json'), path.join(root, 'package-lock.json'));
  fs.symlinkSync(
    path.join(source, 'node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  git(['add', 'package-lock.json']);
  git(['commit', '-qm', 'fixture dependency baseline']);
  fs.writeFileSync(path.join(root, '中文 space.js'), 'export const value = 2;\n');
  git(['add', '--', '中文 space.js']);
  fs.writeFileSync(path.join(root, '中文 space.js'), 'this is not valid javascript');
  const before = git(['diff', '--cached']);
  const commands = [];
  await inspectSnapshot({
    root,
    ref: 'index',
    stage: 'commit',
    execute: (label, _command, _args, { cwd }) => {
      commands.push(label);
      assert.equal(
        fs.readFileSync(path.join(cwd, '中文 space.js'), 'utf8'),
        'export const value = 2;\n',
      );
    },
  });
  assert.ok(commands.includes('plugin-tests'));
  assert.ok(!commands.some((label) => label.startsWith('template-')));
  assert.equal(git(['diff', '--cached']), before);
  const runs = fs.readdirSync(path.join(root, '.specgate/hooks-runs'));
  assert.equal(runs.length, 2);
  assert.ok(runs.some((name) => name.endsWith('-summary.json')));
  assert.ok(runs.some((name) => name.endsWith('-evidence')));
});
