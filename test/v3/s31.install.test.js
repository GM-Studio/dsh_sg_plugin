import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectNodeManager,
  detectPythonInstaller,
  nodeInstallCommand,
  pythonInstallCommand,
  installForSuite,
} from '../../src/v3/env/install.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-install-'));
}

test('detectNodeManager 按 lockfile 判定包管理器', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'x', 'utf8');
  assert.equal(detectNodeManager(root).manager, 'pnpm');
  fs.unlinkSync(path.join(root, 'pnpm-lock.yaml'));
  fs.writeFileSync(path.join(root, 'yarn.lock'), 'x', 'utf8');
  assert.equal(detectNodeManager(root).manager, 'yarn');
  fs.unlinkSync(path.join(root, 'yarn.lock'));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}', 'utf8');
  assert.equal(detectNodeManager(root).manager, 'npm');
});

test('nodeInstallCommand：npm 用系统 npm，pnpm 在 Windows 用 shell', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}', 'utf8');
  const npm = nodeInstallCommand('npm', root);
  assert.deepEqual(npm.args, ['ci']);
  assert.equal(npm.shell, process.platform === 'win32');

  const pnpm = nodeInstallCommand('pnpm', root);
  assert.deepEqual(pnpm.args, ['install', '--frozen-lockfile']);
  assert.equal(pnpm.shell, process.platform === 'win32');
});

test('installForSuite 对无 lockfile 的项目自动跳过', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'package.json'), '{}', 'utf8');
  const result = installForSuite({ root, suite: { id: 'web', kind: 'node-test', install: null } });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no-lockfile');
});

test('installForSuite install:false 跳过，dryRun 返回命令', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}', 'utf8');
  const disabled = installForSuite({
    root,
    suite: { id: 'web', kind: 'node-test', install: false },
  });
  assert.equal(disabled.skipped, true);

  const dry = installForSuite({
    root,
    suite: { id: 'web', kind: 'node-test', install: null },
    dryRun: true,
  });
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.match(dry.command.args.join(' '), /\bci\b/);
});

test('python 安装命令按 requirements/pyproject 判定', () => {
  const root = tempRoot();
  assert.equal(detectPythonInstaller(root).tool, null);
  fs.writeFileSync(path.join(root, 'requirements.txt'), 'pytest\n', 'utf8');
  const pip = pythonInstallCommand(root, 'python');
  assert.deepEqual(pip.args.slice(0, 4), ['-m', 'pip', 'install', '-r']);
  assert.equal(detectPythonInstaller(root).tool, 'pip');
});
