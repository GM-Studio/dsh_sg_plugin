import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hashValue } from '../src/codex/events.js';
import {
  createToolRegistry,
  nativeTestRunnerSpec,
  NATIVE_RED_REPORT_PATH,
  NATIVE_GREEN_REPORT_PATH,
} from '../src/codex/workflow-tools.js';

const digest = (value) => 'sha256:' + hashValue(value);

function fixture() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-frozen-'));
  const testsDirectory = path.join(
    projectRoot,
    '.specgate',
    'changes',
    'long-change-'.repeat(8),
    'tests',
    'v1-' + 'a'.repeat(64),
  );
  const contents = {
    'specgate-tests/runner.mjs': [
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "import { fileURLToPath } from 'node:url';",
      'const options = Object.fromEntries(process.argv.slice(2).reduce((entries, arg, index, args) => index % 2 ? entries : [...entries, [arg.slice(2), args[index + 1]]], []));',
      "const value = fs.readFileSync(path.join(options.tests, 'fixture.txt'), 'utf8');",
      'fs.mkdirSync(path.dirname(options.report), { recursive: true });',
      'fs.writeFileSync(options.report, JSON.stringify({ root: options.root, tests: options.tests, runner: fileURLToPath(import.meta.url), value }));',
      '',
    ].join('\n'),
    'specgate-tests/fixture.txt': '冻结输入\r\nbyte-identical\n',
    'cases.json': '[]\n',
  };
  for (const [relative, contentsValue] of Object.entries(contents)) {
    fs.mkdirSync(path.dirname(path.join(testsDirectory, relative)), { recursive: true });
    fs.writeFileSync(path.join(testsDirectory, relative), contentsValue);
  }
  const manifest = {
    schemaVersion: 1,
    kind: 'tests',
    files: Object.fromEntries(
      Object.entries(contents).map(([file, value]) => [file, digest(value)]),
    ),
    source: {
      kind: 'native-codex-subagent',
      commit: '1'.repeat(40),
      manifestHash: digest('source manifest'),
    },
  };
  const manifestPath = path.join(testsDirectory, 'manifest-' + hashValue(manifest) + '.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return {
    projectRoot,
    testsDirectory,
    manifestPath,
    testsHash: digest(manifest),
    manifest,
    contents,
  };
}

function specification(context, options = {}) {
  return nativeTestRunnerSpec({
    ...context,
    mode: 'red',
    worktree: context.projectRoot,
    reportPath: NATIVE_RED_REPORT_PATH,
    platform: 'win32',
    ...options,
  });
}

test('Windows long frozen snapshots execute byte-identical short copies and red/green reuse one cache', () => {
  const context = fixture();
  const red = specification(context);
  assert.notEqual(red.testRoot, path.join(context.testsDirectory, 'specgate-tests'));
  assert.ok(red.testRoot.length + 110 < 260);
  assert.equal(red.cwd, context.projectRoot);
  assert.equal(red.args[red.args.indexOf('--root') + 1], context.projectRoot);
  assert.equal(
    red.args[red.args.indexOf('--report') + 1],
    path.join(context.projectRoot, NATIVE_RED_REPORT_PATH),
  );
  const copy = path.dirname(red.testRoot);
  for (const relative of Object.keys(context.contents)) {
    assert.deepEqual(
      fs.readFileSync(path.join(copy, relative)),
      fs.readFileSync(path.join(context.testsDirectory, relative)),
    );
  }
  const marker = JSON.parse(fs.readFileSync(red.frozenExecution.markerPath, 'utf8'));
  assert.equal(marker.testsHash, context.testsHash);
  assert.equal(marker.projectRoot, fs.realpathSync(context.projectRoot));
  assert.equal(marker.canonicalDirectory, context.testsDirectory);
  assert.deepEqual(marker.source, context.manifest.source);
  execFileSync(red.command, red.args, { cwd: red.cwd, stdio: 'pipe' });
  const report = JSON.parse(
    fs.readFileSync(path.join(context.projectRoot, NATIVE_RED_REPORT_PATH), 'utf8'),
  );
  assert.equal(report.value, context.contents['specgate-tests/fixture.txt']);
  assert.equal(report.root, context.projectRoot);
  assert.equal(report.runner, red.runner);
  const greenRoot = path.join(context.projectRoot, 'quality-worktree');
  fs.mkdirSync(greenRoot);
  const runtimeCache = path.join(red.testRoot, '.cache', 'm2', 'retained.jar');
  fs.mkdirSync(path.dirname(runtimeCache), { recursive: true });
  fs.writeFileSync(runtimeCache, 'retain bounded dependency cache');
  const green = specification(context, {
    mode: 'green',
    worktree: greenRoot,
    reportPath: NATIVE_GREEN_REPORT_PATH,
  });
  assert.equal(green.testRoot, red.testRoot);
  assert.equal(green.frozenExecution.reused, true);
  assert.equal(fs.readFileSync(runtimeCache, 'utf8'), 'retain bounded dependency cache');
  assert.equal(green.args[green.args.indexOf('--root') + 1], greenRoot);
  assert.equal(
    green.args[green.args.indexOf('--report') + 1],
    path.join(greenRoot, NATIVE_GREEN_REPORT_PATH),
  );
});

test('short synthetic snapshots and non-Windows paths keep the existing direct runner contract', () => {
  const short = path.join(os.tmpdir(), 'short-fixture');
  const spec = specification({ projectRoot: os.tmpdir(), testsDirectory: short });
  assert.equal(spec.testRoot, path.join(short, 'specgate-tests'));
  const context = fixture();
  assert.equal(
    specification(context, { platform: 'linux' }).testRoot,
    path.join(context.testsDirectory, 'specgate-tests'),
  );
});

test('execution copies reject canonical or cached tampering, foreign markers, escapes and links', async (t) => {
  for (const scenario of [
    'canonical',
    'cached',
    'marker',
    'escape',
    'canonical-link',
    'cached-link',
    'runtime-link',
    'unmarked',
    'source-race',
  ]) {
    await t.test(scenario, (subtest) => {
      const context = fixture();
      let red;
      if (!['canonical', 'escape', 'canonical-link', 'source-race'].includes(scenario))
        red = specification(context);
      const canonical = path.join(context.testsDirectory, 'specgate-tests/fixture.txt');
      if (scenario === 'canonical') fs.writeFileSync(canonical, 'modified frozen input');
      if (scenario === 'cached')
        fs.writeFileSync(path.join(red.testRoot, 'fixture.txt'), 'modified copy');
      if (scenario === 'marker') {
        const marker = JSON.parse(fs.readFileSync(red.frozenExecution.markerPath, 'utf8'));
        marker.projectRoot = path.join(context.projectRoot, 'foreign');
        fs.writeFileSync(red.frozenExecution.markerPath, JSON.stringify(marker));
      }
      if (scenario === 'unmarked') fs.unlinkSync(red.frozenExecution.markerPath);
      if (scenario === 'source-race') {
        const read = fs.readFileSync.bind(fs);
        let canonicalReads = 0;
        subtest.mock.method(fs, 'readFileSync', (file, ...args) =>
          file === canonical && ++canonicalReads > 1
            ? Buffer.from('source changed after validation')
            : read(file, ...args),
        );
      }
      if (scenario === 'escape') {
        context.manifest.files['../escape.mjs'] = digest('escape');
        fs.writeFileSync(context.manifestPath, JSON.stringify(context.manifest));
        context.testsHash = digest(context.manifest);
      }
      if (scenario.endsWith('-link')) {
        const target =
          scenario === 'canonical-link'
            ? canonical
            : scenario === 'cached-link'
              ? path.join(red.testRoot, 'fixture.txt')
              : path.join(red.testRoot, '.cache');
        if (scenario === 'runtime-link')
          fs.symlinkSync(
            context.projectRoot,
            target,
            process.platform === 'win32' ? 'junction' : 'dir',
          );
        else {
          const original = path.join(context.projectRoot, 'linked-fixture.txt');
          fs.writeFileSync(original, context.contents['specgate-tests/fixture.txt']);
          fs.unlinkSync(target);
          fs.linkSync(original, target);
        }
      }
      assert.throws(() => specification(context), { code: 'FROZEN_EXECUTION_INVALID' });
    });
  }
});

test('identical tests from different projects never share an execution cache', () => {
  const first = fixture();
  const second = fixture();
  assert.equal(first.testsHash, second.testsHash);
  const firstSpec = specification(first);
  const secondSpec = specification(second);
  assert.notEqual(firstSpec.testRoot, secondSpec.testRoot);
  assert.throws(() => specification({ ...first, projectRoot: second.projectRoot }), {
    code: 'FROZEN_EXECUTION_INVALID',
  });
});

test('public Core tools cannot select execution caches, arbitrary commands or quality reports', async () => {
  const registry = createToolRegistry({ projectRoot: fixture().projectRoot, nativeAgents: true });
  for (const [name, injected] of [
    ['sg_development_prepare', { command: process.execPath }],
    ['sg_quality_run', { reportPath: 'external-report.json' }],
    ['sg_quality_run', { temporaryRoot: os.tmpdir() }],
  ]) {
    const result = (await registry.call(name, { expectedVersion: 0, ...injected }))
      .structuredContent;
    assert.equal(result.code, 'INVALID_ARGUMENT');
  }
});
