import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'frontend'));
  for (const name of ['run', 'configure'])
    fs.copyFileSync(
      new URL(`../assets/java-vue/template/scripts/${name}.mjs.tpl`, import.meta.url),
      path.join(root, `scripts/${name}.mjs`),
    );
  return root;
}

test('root dev launches only the frontend with an invalid JAVA_HOME and no account configuration', (t) => {
  const root = fixture(t),
    npmCli = path.join(root, 'npm-cli.js');
  fs.writeFileSync(
    npmCli,
    'console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}))',
  );
  const response = spawnSync(process.execPath, ['scripts/run.mjs', 'dev'], {
    cwd: root,
    env: {
      ...process.env,
      JAVA_HOME: 'invalid-jdk',
      npm_execpath: npmCli,
      APP_ADMIN_PASSWORD: '',
      APP_VIEWER_PASSWORD: '',
    },
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  assert.equal(response.status, 0, response.stderr);
  const output = JSON.parse(response.stdout);
  assert.equal(output.cwd, path.join(root, 'frontend'));
  assert.deepEqual(output.args, ['run', 'dev']);
  assert.equal(fs.existsSync(path.join(root, '.env')), false);
});

test('local configuration creates known demo accounts once and preserves existing user settings', async (t) => {
  const root = fixture(t);
  const { configure } = await import(pathToFileURL(path.join(root, 'scripts/configure.mjs')).href);
  assert.equal(configure(root).created, true);
  const first = fs.readFileSync(path.join(root, '.env'), 'utf8');
  const passwords = [...first.matchAll(/^APP_\w+_PASSWORD=(.+)$/gm)].map((entry) => entry[1]);
  assert.equal(passwords.length, 2);
  assert.deepEqual(passwords, ['admin', 'viewer']);
  assert.match(first, /^APP_LOCAL_DEMO=true$/m);
  assert.equal(configure(root).created, false);
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), first);
});
