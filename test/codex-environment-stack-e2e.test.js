import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEnvironmentService } from '../src/codex/core/environment.js';
import { createToolRegistry } from '../src/codex/workflow-tools.js';
import { matchesVersion } from '../src/codex/core/env/version-range.js';
import { detectStack } from '../src/codex/core/discovery/stack.js';

test('existing Node, React, Vue, Python, Go and plain Java derive only their actual tool requirements', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-stack-env-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const cases = [
    ['node', 'package.json', '{"engines":{"node":">=22"}}', ['git', 'node']],
    ['react', 'package.json', '{"dependencies":{"react":"18"}}', ['git', 'node']],
    ['vue', 'package.json', '{"dependencies":{"vue":"3"}}', ['git', 'node']],
    ['python', 'pyproject.toml', '[project]\nrequires-python=">=3.11"\n', ['git', 'python']],
    ['go', 'go.mod', 'module example.com/test\n\ngo 1.23\n', ['git', 'go']],
    [
      'java',
      'pom.xml',
      '<project><properties><java.version>17</java.version></properties></project>',
      ['git', 'jdk17', 'maven'],
    ],
  ];
  for (const [name, file, contents, expected] of cases) {
    const root = path.join(parent, name);
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, file), contents);
    const registry = createToolRegistry({ projectRoot: root });
    const result = (await registry.call('sg_env_check')).structuredContent;
    assert.equal(result.ok, true, name + ': ' + JSON.stringify(result));
    assert.deepEqual(result.required, expected, name);
    assert.equal(result.workflowVerification, 'not-run');
    assert.deepEqual(fs.readdirSync(root), [file]);
    if (name === 'node') assert.equal(result.environmentReady, true, JSON.stringify(result));
  }
});

test('version constraints reject lower patch versions and discover nested workspace modules', async (t) => {
  assert.equal(matchesVersion('22.22.0', '>=22.24.0'), false);
  assert.equal(matchesVersion('3.14.4', '==3.12.16'), false);
  assert.equal(matchesVersion('22.22.0', '^22.12.0 || ^24.0.0'), true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-env-modules-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, data] of [
    ['apps/web/package.json', '{"dependencies":{"react":"18"}}'],
    ['services/api/go.mod', 'module example.com/api\ngo 1.23\n'],
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), data);
  }
  const stack = detectStack({ root });
  assert.ok(stack.modules.some((entry) => entry.root === 'apps/web'));
  assert.ok(stack.modules.some((entry) => entry.root === 'services/api'));
  const env = await createEnvironmentService({ root }).check();
  assert.deepEqual(env.required, ['git', 'node', 'go']);
});

test('new-project stack selection can prepare a pure backend and incompatible runtime remains missing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-stack-select-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createEnvironmentService({ root });
  const python = await service.check({ stack: 'python', pythonVersion: '>=3.11' });
  assert.deepEqual(python.required, ['git', 'python']);
  const incompatible = await service.check({ stack: 'node', nodeVersion: '>=999' });
  assert.equal(incompatible.environmentReady, false);
  assert.ok(incompatible.missing.includes('node'));
  assert.equal(
    incompatible.required.some((id) => id.startsWith('jdk')),
    false,
  );
  assert.deepEqual(fs.readdirSync(root), []);
});
