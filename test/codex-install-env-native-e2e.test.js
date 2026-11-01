import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createEnvironmentService } from '../src/codex/core/environment.js';

const roots = [];
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-native-installer-'));
  roots.push(base);
  const root = path.join(base, 'project');
  fs.mkdirSync(root);
  const bin = path.join(base, 'bin');
  fs.mkdirSync(bin);
  const env = { ...process.env };
  const keys = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'PROGRAMFILES',
    'PROGRAMW6432',
    'SPECGATE_NODE',
    'SPECGATE_TOOLCHAINS',
    'NVM_SYMLINK',
    'NVM_HOME',
    'NVM_DIR',
    'VOLTA_HOME',
    'FNM_DIR',
  ];
  for (const key of Object.keys(env)) if (keys.includes(key.toUpperCase())) delete env[key];
  Object.assign(env, {
    PATH: bin,
    HOME: path.join(base, 'home'),
    USERPROFILE: path.join(base, 'home'),
    LOCALAPPDATA: path.join(base, 'appdata'),
    APPDATA: path.join(base, 'roaming'),
    ProgramFiles: path.join(base, 'programs'),
    ProgramW6432: path.join(base, 'program64'),
    SPECGATE_NODE: '',
    SPECGATE_TOOLCHAINS: path.join(root, 'cache'),
  });
  // The native Windows shell expects the user's standard profile directories to exist.
  if (process.platform === 'win32')
    for (const relative of ['home/AppData/Local', 'home/AppData/Roaming', 'appdata', 'roaming'])
      fs.mkdirSync(path.join(base, relative), { recursive: true });
  fs.mkdirSync(env.HOME, { recursive: true });
  fs.writeFileSync(path.join(env.HOME, '.profile'), 'preserve profile\n');
  fs.writeFileSync(path.join(env.HOME, '.bashrc'), 'preserve bashrc\n');
  if (process.platform === 'linux')
    for (const name of ['sha256sum', 'realpath', 'timeout']) {
      const command = ['/usr/bin/', '/bin/']
        .map((prefix) => prefix + name)
        .find((file) => fs.existsSync(file));
      assert.ok(command, 'Native check needs existing ' + name);
      fs.symlinkSync(command, path.join(bin, name));
    }
  return { root, env };
}
function run(c, args) {
  const windows = process.platform === 'win32';
  assert.ok(
    windows || process.platform === 'linux',
    'This acceptance requires native Windows or Linux',
  );
  const executable = windows
    ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
    : '/bin/bash';
  const wrapper = fileURLToPath(
    new URL(windows ? '../scripts/install-env.ps1' : '../scripts/install-env.sh', import.meta.url),
  );
  const argv = windows
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper, ...args]
    : [wrapper, ...args];
  const result = spawnSync(executable, argv, {
    cwd: c.root,
    env: c.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(fs.readFileSync(path.join(c.env.HOME, '.profile'), 'utf8'), 'preserve profile\n');
  assert.equal(fs.readFileSync(path.join(c.env.HOME, '.bashrc'), 'utf8'), 'preserve bashrc\n');
  return result;
}
const snapshot = (root) =>
  fs
    .readdirSync(root, { recursive: true })
    .sort()
    .map((name) => {
      const file = path.join(root, name),
        stat = fs.lstatSync(file);
      return [
        name,
        stat.isSymbolicLink()
          ? fs.readlinkSync(file)
          : stat.isDirectory()
            ? 'directory'
            : createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      ];
    });
test.after(() => {
  for (const root of roots)
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});
for (const args of [['--check'], ['--check', '--bootstrap'], ['--plan'], ['--bootstrap']])
  test(`native ${process.platform} missing-Node launcher ${args.join(' ')} never downloads or writes before consent`, () => {
    const c = fixture(),
      before = snapshot(c.root);
    const result = run(c, args);
    assert.equal(
      result.status,
      args.includes('--check') ? 2 : args.includes('--plan') ? 0 : 3,
      result.stderr || result.stdout,
    );
    const index = result.stdout.indexOf('{'),
      end = result.stdout.indexOf('}', index);
    const plan = JSON.parse(result.stdout.slice(index, end + 1));
    // PowerShell emits a second structured consent-required result when noninteractive.
    if (!args.includes('--bootstrap') || args.includes('--check')) {
      assert.equal(plan.code, 'NODE_RUNTIME_REQUIRED');
      assert.equal(plan.environmentReady, false);
      assert.match(plan.checksum, /^[a-f0-9]{64}$/);
    }
    assert.deepEqual(
      snapshot(c.root),
      before,
      'Read-only or rejected preparation created files/directories',
    );
    assert.equal(fs.existsSync(path.join(c.root, 'cache')), false);
  });
test(`native ${process.platform} wrapper actually reuses an explicitly configured runtime and returns the real selected tool`, () => {
  const c = fixture();
  c.env.SPECGATE_NODE = process.execPath;
  fs.writeFileSync(
    path.join(c.root, 'package.json'),
    JSON.stringify({
      name: 'native-reuse',
      private: true,
      engines: { node: process.versions.node },
    }),
  );
  const before = snapshot(c.root),
    result = run(c, ['--check', '--only=node']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.environmentReady, true, JSON.stringify(report));
  assert.equal(report.tools.node.version, process.versions.node);
  assert.equal(report.workflowVerification, 'not-run');
  assert.deepEqual(snapshot(c.root), before);
});

test(`native ${process.platform} changed runtime hash and unsupported methods never start installation`, () => {
  const c = fixture(),
    before = snapshot(c.root),
    probe = run(c, ['--plan']);
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  const plan = JSON.parse(probe.stdout);
  const changed = run(c, ['--bootstrap', '--expected-plan-hash=' + '0'.repeat(64)]);
  assert.notEqual(changed.status, 0);
  assert.match(changed.stdout + changed.stderr, /ENV_INSTALL_PLAN_CHANGED/);
  const same = run(c, ['--bootstrap', '--expected-plan-hash=' + plan.planHash]);
  assert.equal(same.status, 3, same.stdout + same.stderr);
  const unsupported = run(c, ['--bootstrap', '--method=winget']);
  assert.notEqual(unsupported.status, 0);
  assert.deepEqual(snapshot(c.root), before);
  assert.equal(fs.existsSync(path.join(c.root, 'cache')), false);
});

test(`native ${process.platform} invocation preserves its calling shell PATH`, () => {
  const c = fixture();
  c.env.SPECGATE_NODE = process.execPath;
  fs.writeFileSync(
    path.join(c.root, 'package.json'),
    JSON.stringify({
      name: 'caller-proof',
      private: true,
      engines: { node: process.versions.node },
    }),
  );
  const windows = process.platform === 'win32';
  const wrapper = fileURLToPath(
    new URL(windows ? '../scripts/install-env.ps1' : '../scripts/install-env.sh', import.meta.url),
  );
  const driver = path.join(c.root, windows ? 'caller.ps1' : 'caller.sh');
  fs.writeFileSync(
    driver,
    windows
      ? "param([string]$Wrapper)\n$before=$env:PATH\n& $Wrapper --check --only=node > $null\n$status=$LASTEXITCODE\nif($env:PATH -cne $before){exit 79}\nWrite-Output 'CALLER_PATH_UNCHANGED'\nexit $status\n"
      : 'before=$PATH\n/bin/bash "$1" --check --only=node >/dev/null\nstatus=$?\n[ "$PATH" = "$before" ] || exit 79\nprintf "CALLER_PATH_UNCHANGED\\n"\nexit "$status"\n',
  );
  const executable = windows
    ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
    : '/bin/bash';
  const argv = windows
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', driver, '-Wrapper', wrapper]
    : [driver, wrapper];
  const result = spawnSync(executable, argv, {
    cwd: c.root,
    env: c.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /CALLER_PATH_UNCHANGED/);
});

test(`native ${process.platform} and shared discovery reuse a real Node SDK under a manager image directory`, async () => {
  const c = fixture();
  const manager = path.join(c.env.HOME, '.volta');
  const images = path.join(manager, 'tools/image/node');
  fs.mkdirSync(images, { recursive: true });
  const sdkRoot =
    process.platform === 'win32'
      ? path.dirname(process.execPath)
      : path.dirname(path.dirname(process.execPath));
  const image = path.join(images, process.versions.node);
  fs.symlinkSync(sdkRoot, image, process.platform === 'win32' ? 'junction' : 'dir');
  c.env.VOLTA_HOME = manager;
  fs.writeFileSync(
    path.join(c.root, 'package.json'),
    JSON.stringify({
      name: 'sdk-image-reuse',
      private: true,
      engines: { node: process.versions.node },
    }),
  );
  const checked = await createEnvironmentService({
    root: c.root,
    env: c.env,
    cacheRoot: c.env.SPECGATE_TOOLCHAINS,
  }).check({ stack: 'node' });
  assert.equal(checked.tools.node?.version, process.versions.node, JSON.stringify(checked));
  assert.ok(checked.tools.node.node.startsWith(image), JSON.stringify(checked.tools));
  const result = run(c, ['--check', '--only=node']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.environmentReady, true, JSON.stringify(report));
  assert.ok(report.tools.node.node.startsWith(image), JSON.stringify(report.tools));
  assert.equal(fs.existsSync(path.join(c.root, 'cache')), false);
});
