import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { suggestSuites } from '../../src/v3/suites.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-suggest-'));
}

test('suggestSuites 识别单包 test:json', () => {
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { 'test:json': 'node sg-test.mjs' } }),
    'utf8',
  );
  const suggestions = suggestSuites(root);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].id, 'default');
  assert.equal(suggestions[0].kind, 'node-test');
});

test('suggestSuites 识别 workspaces', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'web', 'package.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(root, 'apps', 'api', 'package.json'), '{}', 'utf8');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ workspaces: ['apps/*'] }),
    'utf8',
  );
  const suggestions = suggestSuites(root);
  const ids = suggestions.map((item) => item.id).sort();
  assert.deepEqual(ids, ['api', 'web']);
  assert.ok(suggestions.every((item) => item.cwd.startsWith('apps/')));
});

test('suggestSuites 识别 pytest 与 E2E 配置', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\n', 'utf8');
  fs.writeFileSync(path.join(root, 'playwright.config.ts'), 'export default {};\n', 'utf8');
  const suggestions = suggestSuites(root);
  const kinds = suggestions.map((item) => `${item.id}:${item.kind}`).sort();
  assert.deepEqual(kinds, ['api:pytest', 'e2e:command']);
});
