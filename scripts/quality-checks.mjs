import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { classifyFile, checksFor } from './quality-snapshot.mjs';
import { commandSpec } from '../src/v4/verify-evidence.js';

export function executeCommand(
  label,
  command,
  args,
  { cwd, env = process.env, timeout = 15 * 60 * 1000 } = {},
) {
  console.log('[quality-gate] ' + label + ': ' + command + ' ' + args.join(' '));
  const spec = commandSpec(command, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  const logDirectory = path.join(env.SG_QUALITY_LOG_ROOT || cwd, '.specgate', 'quality-logs');
  fs.mkdirSync(logDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(logDirectory, label + '.log'),
    (result.stdout || '') + (result.stderr || '') + (result.error?.stack || ''),
  );
  fs.appendFileSync(
    path.join(logDirectory, 'commands.jsonl'),
    JSON.stringify({
      label,
      command,
      args,
      cwd,
      exitCode: result.status,
      error: result.error?.message || null,
    }) + '\n',
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0)
    throw new Error(label + ' failed: ' + (result.error?.message || 'exit ' + result.status));
  return result;
}
export async function runChecks({
  root,
  files,
  stage,
  env = process.env,
  execute = executeCommand,
}) {
  const plan = checksFor(files, stage);
  const kinds = files.map((name) => [name, classifyFile(name)]);
  const unsupported = kinds.filter(([, kind]) => kind === 'unsupported');
  if (unsupported.length)
    throw new Error(
      'Unsupported code requires a checker: ' + unsupported.map(([name]) => name).join(', '),
    );
  const existing = kinds.filter(([name]) => fs.existsSync(path.join(root, name)));
  // Unmodified Apache wrapper is third-party bootstrap, not project business code.
  // Changing it requires an explicit checker/review, never silently passes Maven acceptance.
  const wrapperHashes = {
    'mvnw.tpl': 'cae96cef89ebea3531221f4ae17c23cf8edf67d00eae8306d4186ae1bbed4d02',
    'mvnw.cmd.tpl': '4a361e1374a3e5ad6d03e18e9adc0cf181ac5058ac6203b76f0ba3b456b56481',
  };
  for (const [name, kind] of kinds) {
    if (kind !== 'vendor-wrapper') continue;
    const file = path.join(root, name);
    if (
      !fs.existsSync(file) ||
      createHash('sha256')
        .update(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))
        .digest('hex') !== wrapperHashes[path.basename(name)]
    )
      throw new Error(
        'Vendor wrapper changed: ' + name + '. Add reviewed wrapper validation first.',
      );
  }
  const node = (label, args) => execute(label, process.execPath, args, { cwd: root, env });
  const lint = existing
    .filter(([, kind]) => ['javascript', 'typescript', 'vue'].includes(kind))
    .map(([name]) => name);
  const format = existing
    .filter(([, kind]) => ['javascript', 'typescript', 'vue', 'format'].includes(kind))
    .map(([name]) => name);
  if (lint.length)
    node('static-eslint', ['node_modules/eslint/bin/eslint.js', '--max-warnings=0', '--', ...lint]);
  if (format.length)
    node('format-check', ['node_modules/prettier/bin/prettier.cjs', '--check', '--', ...format]);
  const python = existing.filter(([, kind]) => kind === 'python').map(([name]) => name);
  if (python.length) {
    const ruff = env.SG_RUFF || 'ruff';
    execute('python-static', ruff, ['check', '--', ...python], { cwd: root, env });
    execute('python-format', ruff, ['format', '--check', '--', ...python], { cwd: root, env });
  }
  const shell = existing.filter(([, kind]) => kind === 'shell').map(([name]) => name);
  if (shell.length) {
    node('shell-format', [
      'node_modules/prettier/bin/prettier.cjs',
      '--plugin=prettier-plugin-sh',
      '--parser=sh',
      '--check',
      '--',
      ...shell,
    ]);
    const bash =
      env.SG_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
    for (const [index, file] of shell.entries())
      execute('shell-syntax-' + index, bash, ['-n', '--', file], { cwd: root, env });
  }
  if (plan.tests) node('plugin-tests', ['--import', './test/setup-temp.mjs', '--test']);
  const acceptanceEnv = {
    ...env,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: path.join(root, '.specgate/no-hooks'),
    GIT_CONFIG_KEY_1: 'core.longpaths',
    GIT_CONFIG_VALUE_1: 'true',
  };
  if (process.platform !== 'win32' && stage !== 'ci' && plan.template)
    throw new Error(
      'Windows template acceptance required; Linux template acceptance remains deferred.',
    );
  if (
    kinds.some(([, kind]) => ['reference-template', 'java-scaffold'].includes(kind)) &&
    (process.platform === 'win32' || stage !== 'ci')
  )
    execute(
      'code-assets',
      process.execPath,
      [
        'scripts/quality-assets.mjs',
        ...kinds
          .filter(([, kind]) => ['reference-template', 'java-scaffold'].includes(kind))
          .map(([name]) => name),
      ],
      { cwd: root, env: acceptanceEnv },
    );
  if (plan.template) {
    if (process.platform !== 'win32' && stage !== 'commit') {
      console.log(
        '[quality-gate] Linux Java template acceptance deferred; use Windows acceptance CI.',
      );
      if (stage !== 'ci')
        throw new Error(
          'Four-preset Windows acceptance required before push. Linux acceptance is deferred.',
        );
    } else {
      for (const preset of plan.presets)
        execute(
          'template-' + preset,
          process.execPath,
          ['scripts/verify-java-template.mjs', preset],
          { cwd: root, env: acceptanceEnv },
        );
    }
  }
  return plan;
}
