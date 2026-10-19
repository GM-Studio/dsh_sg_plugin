import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planToolchain, ensureToolchain } from '../../src/v3/toolchain.js';

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v35-toolchain-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'demo', devDependencies: { prettier: '^3.0.0' } }, null, 2),
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}', 'utf8');
  return root;
}

test('planToolchain 找出缺失包与配置', () => {
  const root = tempRoot();
  const plan = planToolchain(root, root, 'vue');
  assert.ok(plan.packages.includes('eslint'));
  assert.ok(plan.packages.includes('vue-tsc'));
  assert.ok(!plan.packages.includes('prettier'));
  assert.ok(plan.configs.includes('prettier.config.mjs'));
});

test('Python 项目生成 ruff/mypy 配置', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v35-py-'));
  fs.writeFileSync(path.join(root, 'requirements.txt'), 'pytest\n', 'utf8');
  const result = ensureToolchain({
    root,
    worktree: root,
    change: 'c',
    task: { id: 'T-001' },
    stack: 'python',
    install: false,
  });
  assert.equal(result.ok, true, result.message);
  assert.ok(fs.existsSync(path.join(root, 'ruff.toml')));
  assert.ok(fs.existsSync(path.join(root, 'mypy.ini')));
});

test('ensureToolchain(install=false) 只生成配置，不安装', () => {
  const root = tempRoot();
  const result = ensureToolchain({
    root,
    worktree: root,
    change: 'c',
    task: { id: 'T-001' },
    stack: 'node',
    install: false,
  });
  assert.equal(result.ok, true, result.message);
  assert.ok(fs.existsSync(path.join(root, 'prettier.config.mjs')));
  assert.ok(fs.existsSync(path.join(root, 'eslint.config.js')));
  assert.ok(Array.isArray(result.generated));
});
