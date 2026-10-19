import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  readPythonRequirement,
  satisfiesPython,
  ensureVenv,
  venvPythonPath,
} from '../../src/v3/env/python.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-py-'));
}

function hasPy312() {
  if (process.platform !== 'win32') return false;
  const result = spawnSync('py', ['-3.12', '-V'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0;
}

test('satisfiesPython 处理精确、范围与下界', () => {
  assert.equal(satisfiesPython('3.12.10', '3.12'), true);
  assert.equal(satisfiesPython('3.13.5', '3.12'), false);
  assert.equal(satisfiesPython('3.11.9', '>=3.10,<3.13'), true);
  assert.equal(satisfiesPython('3.13.1', '>=3.10,<3.13'), false);
  assert.equal(satisfiesPython('3.12.0', '>=3.10'), true);
});

test('readPythonRequirement 优先 suite，再 .python-version', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, '.python-version'), '3.12.10\n', 'utf8');
  assert.equal(readPythonRequirement(root, { suite: { python: '3.13' } }), '3.13');
  assert.equal(readPythonRequirement(root, {}), '3.12.10');
});

test('readPythonRequirement 读取 pyproject requires-python', () => {
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, 'pyproject.toml'),
    '[project]\nrequires-python = ">=3.10,<3.14"\n',
    'utf8',
  );
  assert.equal(readPythonRequirement(root, {}), '>=3.10,<3.14');
});

test('ensureVenv 创建 .venv 并复用，版本不符时不删除', (t) => {
  if (!hasPy312()) {
    t.skip('本机没有 py -3.12');
    return;
  }
  const root = tempRoot();
  const first = ensureVenv({ root, suite: { python: '3.12' } });
  assert.equal(first.ok, true, first.message);
  assert.equal(first.created, true);
  assert.ok(first.version.startsWith('3.12.'));
  assert.ok(fs.existsSync(venvPythonPath(root)));

  const second = ensureVenv({ root, suite: { python: '3.12' } });
  assert.equal(second.ok, true, second.message);
  assert.equal(second.reused, true);

  const mismatch = ensureVenv({ root, suite: { python: '3.13' } });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, 'PYTHON_VERSION_MISMATCH');
  assert.ok(fs.existsSync(venvPythonPath(root)), '.venv 不应被删除');
});
