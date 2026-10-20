import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  fixedScaffoldFiles,
  fixedSelection,
  fixedVersions,
} from '../../src/v4/minimal-scaffold.js';
import {
  verifyFixedScaffold,
  verificationPlan,
  verificationTimeouts,
  detectExistingBrowser,
} from '../../src/v4/minimal-verification.js';
test('pure fresh fixed map and Java8 file-database contract', () => {
  const files = fixedScaffoldFiles();
  assert.equal(fixedSelection().backend, 'java');
  assert.equal(fixedVersions.springBoot, '2.7.18');
  assert.ok(
    Object.keys(files).every(
      (key) =>
        !key.includes('..') &&
        !path.isAbsolute(key) &&
        !key.startsWith('.specgate/') &&
        !key.startsWith('openspec/'),
    ),
  );
  files['api/pom.xml'] = 'changed';
  assert.match(fixedScaffoldFiles()['api/pom.xml'], /2\.7\.18/);
  assert.match(files['api/src/main/resources/application.properties'], /jdbc:h2:file:/);
  assert.doesNotMatch(files['api/src/main/resources/application.properties'], /jdbc:h2:mem/);
  assert.match(
    files['api/src/test/java/com/example/items/ItemDatabaseTest.java'],
    /source.getConnection/,
  );
  assert.match(files['api/src/test/java/com/example/items/ItemDatabaseTest.java'], /jdbc:h2:file:/);
  assert.match(
    files['api/src/main/java/com/example/items/VerificationShutdown.java'],
    /@Value\("\$\{verification.shutdown-token\}"\)/,
  );
  assert.match(files['web/src/App.vue'], /role="alert"/);
  assert.match(files['web/src/App.vue'], /role="status"/);
  assert.match(files['web/verify-browser.mjs'], /chromium.launch/);
  assert.doesNotMatch(files['web/verify-browser.mjs'], /page.route/);
});
test('generated browser script parses and real frontend validation tests pass', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-fixed-test-'));
  try {
    for (const [name, content] of Object.entries(fixedScaffoldFiles())) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, { flag: 'wx' });
    }
    for (const args of [
      ['--check', path.join(root, 'web/verify-browser.mjs')],
      ['--test', path.join(root, 'web/tests/validation.test.mjs')],
    ])
      assert.equal(
        spawnSync(process.execPath, args, {
          stdio: 'inherit',
          env: Object.fromEntries(
            Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'),
          ),
        }).status,
        0,
      );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('precise fixed commands use mvn alias and npm-cli via node; no downloads', () => {
  const plan = verificationPlan({
    mvn: { path: '/tools/mvn' },
    node: { path: '/tools/node' },
    npm: { path: '/tools/npm-cli.js' },
  });
  assert.equal(plan.commands[0].command, '/tools/mvn');
  assert.deepEqual(plan.commands[1].args, [
    '/tools/npm-cli.js',
    'install',
    '--no-audit',
    '--no-fund',
    '--cache',
    './.npm-cache',
  ]);
  assert.equal(plan.ports.api, 8080);
  assert.equal(plan.ports.web, 5173);
  assert.equal(verificationTimeouts.install, 600000);
  assert.equal(verificationTimeouts.build, 300000);
  assert.equal(verificationTimeouts.startup, 90000);
  assert.equal(plan.environment.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, '1');
  assert.ok(
    plan.commands.every((c) => !c.args.includes('-g') && !c.args.includes('install-browser')),
  );
});
test('existing Windows browser discovery handles normal mixed-case environment keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-browser-discovery-'));
  try {
    const browser = path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    fs.mkdirSync(path.dirname(browser), { recursive: true });
    fs.writeFileSync(browser, 'test');
    assert.equal(detectExistingBrowser({ ProgramFiles: root }), browser);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('invalid root and cancelled verification never pass', async () => {
  let result = await verifyFixedScaffold({ root: 'relative' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.cleanup, 'passed');
  const controller = new AbortController();
  controller.abort(new Error('test cancellation'));
  result = await verifyFixedScaffold({ root: path.resolve('.'), signal: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.browserCrud, 'not-run');
  assert.equal(result.restartPersistence, 'not-run');
});
