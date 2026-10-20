import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyJavaProject } from '../../src/v4/java-verify.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-verify-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('verify rejects a non-Java workspace without writing', (t) => {
  const root = temp(t);
  const result = verifyJavaProject({ root, env: { PATH: '' } });
  assert.equal(result.code, 'E_NOT_JAVA_PROJECT');
  assert.equal(fs.existsSync(path.join(root, '.specgate', 'verify-report.json')), false);
});

test('verify blocks honestly when the local toolchain is missing', (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'monorepo.json'),
    JSON.stringify({
      version: 1,
      topology: 'monorepo',
      stack: 'java-vue',
      preset: 'jdk17-boot3.5',
    }),
  );
  const result = verifyJavaProject({ root, env: { PATH: '' } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VERIFY_BLOCKED');
  assert.match(result.message, /JDK 17/);
  const report = JSON.parse(
    fs.readFileSync(path.join(root, '.specgate', 'verify-report.json'), 'utf8'),
  );
  assert.equal(report.status, 'blocked');
  assert.equal(report.preset, 'jdk17-boot3.5');
  assert.deepEqual(report.stages, []);
});
