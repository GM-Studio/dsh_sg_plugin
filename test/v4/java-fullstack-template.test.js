import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { javaFullstackFiles } from '../../src/v4/java-fullstack-template.js';

function materialize(files) {
  const root = mkdtempSync(join(tmpdir(), 'sg-java-template-'));
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

test('unconditional complete monorepo, pure deterministic fresh map', () => {
  const first = javaFullstackFiles();
  assert.deepEqual(first, javaFullstackFiles({ execute: false, minimal: true }));
  for (const [path, text] of Object.entries(first)) {
    assert.equal(typeof text, 'string');
    assert.ok(text.endsWith('\n'));
    assert.ok(!path.startsWith('/') && !path.includes('..') && !path.includes('\\'));
  }
  for (const path of [
    'backend/pom.xml',
    'frontend/src/App.vue',
    'frontend/test/App.test.ts',
    'scripts/run.mjs',
    'scripts/frontend-test.mjs',
    'docs/api.md',
    'docs/security.md',
    'docs/operations.md',
  ])
    assert.ok(first[path], path);
  first['frontend/src/App.vue'] = 'mutated';
  assert.notEqual(javaFullstackFiles()['frontend/src/App.vue'], 'mutated');
});

test('Java8 Boot CRUD validation health and actual file restart test', () => {
  const files = javaFullstackFiles();
  const base = 'backend/src/main/java/com/example/tasks/';
  assert.ok(files['backend/pom.xml'].includes('<version>2.7.18</version>'));
  assert.ok(files['backend/pom.xml'].includes('<java.version>1.8</java.version>'));
  assert.match(files['backend/pom.xml'], /spotless-maven-plugin/);
  assert.match(files['backend/pom.xml'], /maven-checkstyle-plugin/);
  assert.match(files['backend/src/main/resources/application.properties'], /jdbc:h2:file:/);
  assert.doesNotMatch(files['backend/src/main/resources/application.properties'], /jdbc:h2:mem:/);
  assert.match(files[base + 'TaskController.java'], /ResponseEntity.created/);
  assert.match(files[base + 'TaskController.java'], /ResponseEntity.noContent/);
  assert.match(files[base + 'TaskRequest.java'], /@NotBlank/);
  assert.ok(files[base + 'TaskRequest.java'].includes('@Size(max = 200)'));
  assert.match(
    files[base + 'ApiErrorHandler.java'],
    /INTERNAL_SERVER_ERROR, "Internal server error"/,
  );
  const persistence = files['backend/src/test/java/com/example/tasks/TaskPersistenceTest.java'];
  assert.match(persistence, /AC002_/);
  assert.ok(persistence.includes('try (ConfigurableApplicationContext first'));
  assert.ok(persistence.includes('try (ConfigurableApplicationContext second'));
  assert.match(persistence, /tasks.mv.db/);
  assert.match(files['backend/src/test/java/com/example/tasks/TaskApiTest.java'], /MockMvc/);
});

test('compatible exact frontend pins and safe functional CRUD scripts', () => {
  const files = javaFullstackFiles();
  const pkg = JSON.parse(files['frontend/package.json']);
  assert.equal(pkg.dependencies.vue, '3.5.30');
  assert.equal(pkg.devDependencies.vite, '7.3.1');
  for (const version of Object.values({ ...pkg.dependencies, ...pkg.devDependencies }))
    assert.match(version, /^[0-9]+[.][0-9]+[.][0-9]+$/);
  for (const script of ['build', 'test', 'lint', 'format', 'format:check'])
    assert.ok(pkg.scripts[script]);
  assert.match(pkg.engines.node, /22.12/);
  assert.match(pkg.engines.node, /24/);
  const app = files['frontend/src/App.vue'];
  for (const method of ['list', 'create', 'update', 'remove'])
    assert.match(app, new RegExp('taskApi[.]' + method));
  assert.doesNotMatch(app, /v-html|innerHTML/);
  assert.match(app, /role="alert"/);
  assert.match(files['frontend/vite.config.ts'], /strictPort: true/);
  assert.match(files['docs/security.md'], /out of ordinary open-source support/);
});

test('generated Node launchers parse and unknown actions fail honestly', () => {
  const files = javaFullstackFiles();
  const root = materialize(files);
  try {
    for (const name of ['scripts/run.mjs', 'scripts/frontend-test.mjs']) {
      const result = spawnSync(process.execPath, ['--check', join(root, name)], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
    }
    const result = spawnSync(process.execPath, [join(root, 'scripts/run.mjs'), 'invalid'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown action/);
    assert.match(files['scripts/run.mjs'], /windowsVerbatimArguments/);
    assert.match(files['scripts/run.mjs'], /npm-cli.js/);
    assert.match(files['scripts/run.mjs'], /taskkill/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('report adapter preserves real cases, dynamic AC005 markers, paths and failure exit', () => {
  const files = javaFullstackFiles();
  const root = materialize(files);
  try {
    const fixture = {
      testResults: [
        {
          name: join(root, 'frontend/test/change.test.ts'),
          assertionResults: [
            { fullName: '[AC-005] [AC-001] passes', status: 'passed' },
            { fullName: '[AC-005] fails', status: 'failed' },
            { fullName: 'unmapped pending', status: 'pending' },
          ],
        },
      ],
    };
    const vitest = join(root, 'frontend/node_modules/vitest/vitest.mjs');
    mkdirSync(dirname(vitest), { recursive: true });
    writeFileSync(
      vitest,
      "import fs from 'node:fs'; const output=process.argv.find(a=>a.startsWith('--outputFile=')).slice('--outputFile='.length); fs.writeFileSync(output, JSON.stringify(" +
        JSON.stringify(fixture) +
        ')); process.exit(1);',
    );
    const reportPath = join(root, 'report.json');
    const result = spawnSync(process.execPath, [join(root, 'scripts/frontend-test.mjs')], {
      env: { ...process.env, SG_REPORT: reportPath },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(
      report.cases.map((item) => item.status),
      ['pass', 'fail', 'skip'],
    );
    assert.deepEqual(report.cases[0].ac, ['AC-005', 'AC-001']);
    assert.deepEqual(report.cases[2].ac, []);
    assert.ok(report.cases.every((item) => item.file === 'frontend/test/change.test.ts'));
    assert.doesNotMatch(result.stdout, /"schemaVersion"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
