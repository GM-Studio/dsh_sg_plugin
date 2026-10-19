import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planToolchain, ensureToolchain } from '../../src/v3/toolchain.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-toolchain-'));
}

test('planToolchain 对 Java 项目跳过 npm/pip 计划', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>', 'utf8');
  const plan = planToolchain(root, root, 'java');
  assert.equal(plan.ok, true);
  assert.equal(plan.java, true);
  assert.deepEqual(plan.packages, []);
  assert.deepEqual(plan.configs, []);
});

test('ensureToolchain 对 Java 项目不执行 npm install', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>', 'utf8');
  const result = ensureToolchain({
    root,
    worktree: root,
    change: 'c',
    task: { id: 'T-001' },
    stack: 'java',
    install: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.installed, false);
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
});
