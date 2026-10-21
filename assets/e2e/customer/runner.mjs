import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function argsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined)
      throw new Error('Expected --name value arguments');
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}

function command(commandPath, args, cwd, environment = process.env) {
  const quote = (value) => '"' + String(value).replaceAll('"', '""') + '"';
  const windowsCommand = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(commandPath);
  const executable = windowsCommand ? process.env.ComSpec || 'cmd.exe' : commandPath;
  const executableArgs = windowsCommand
    ? ['/d', '/s', '/c', '"' + [commandPath, ...args].map(quote).join(' ') + '"']
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd,
    encoding: 'utf8',
    env: environment,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    windowsVerbatimArguments: windowsCommand,
    windowsHide: true,
  });
  return {
    command: commandPath,
    args,
    cwd,
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  };
}

function git(root, args) {
  return command('git', args, root);
}

const args = argsOf(process.argv.slice(2));
const mode = args.mode;
const mainRoot = path.resolve(args.root);
const testsDirectory = path.resolve(args.tests);
const reportPath = path.resolve(args.report);
if (!['red', 'green'].includes(mode)) throw new Error('--mode must be red or green');

const files = [
  'backend/src/test/java/com/example/tasks/CustomerApiTest.java',
  'frontend/test/customer-panel.test.ts',
];

let target = mainRoot;
let cleanup = null;
if (mode === 'red') {
  const redWorktree = path.join(
    mainRoot,
    '.specgate',
    'runs',
    'customer-e2e',
    `red-${process.pid}-${Date.now()}`,
  );
  fs.mkdirSync(path.dirname(redWorktree), { recursive: true });
  const added = git(mainRoot, ['worktree', 'add', '--detach', redWorktree, 'HEAD']);
  if (added.status !== 0) throw new Error(added.stderr || added.stdout);
  target = redWorktree;
  cleanup = () => git(mainRoot, ['worktree', 'remove', '--force', redWorktree]);
}

try {
  for (const relative of files) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(testsDirectory, relative), destination);
  }
  const backend = command(
    path.join(target, 'backend', process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw'),
    ['-B', '-ntp', '-Dtest=CustomerApiTest', 'test'],
    path.join(target, 'backend'),
    {
      ...process.env,
      JAVA_HOME: 'D:\\Program Files\\Java\\Jdk8',
      PATH: ['D:\\Program Files\\Java\\Jdk8\\bin', process.env.PATH || ''].join(path.delimiter),
      Path: ['D:\\Program Files\\Java\\Jdk8\\bin', process.env.Path || ''].join(path.delimiter),
    },
  );
  const frontendRoot = path.join(target, 'frontend');
  const npm = path.join(path.dirname(process.execPath), 'npm.cmd');
  const install = command(npm, ['ci', '--no-audit', '--no-fund'], frontendRoot);
  const frontend = command(
    process.execPath,
    [
      path.join(frontendRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      'test/customer-panel.test.ts',
    ],
    frontendRoot,
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(`${reportPath}.backend.log`, backend.stdout + backend.stderr);
  fs.writeFileSync(
    `${reportPath}.frontend.log`,
    install.stdout + install.stderr + frontend.stdout + frontend.stderr,
  );
  const backendOk = backend.status === 0;
  const frontendOk = install.status === 0 && frontend.status === 0;
  const report = {
    schemaVersion: 1,
    mode,
    cases: [
      { id: 'CASE-AC-1', status: backendOk ? 'pass' : 'fail' },
      { id: 'CASE-AC-2', status: backendOk ? 'pass' : 'fail' },
      { id: 'CASE-AC-3', status: backendOk ? 'pass' : 'fail' },
      { id: 'CASE-AC-4', status: frontendOk ? 'pass' : 'fail' },
    ],
    commands: { backend, install, frontend },
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.exitCode =
    mode === 'red' ? 1 : report.cases.every((entry) => entry.status === 'pass') ? 0 : 1;
} finally {
  cleanup?.();
}
