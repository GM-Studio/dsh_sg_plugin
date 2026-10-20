import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startJavaInit } from '../src/v4/java-init.js';
import { JAVA_PRESETS, templateHash } from '../src/v4/java-versions.js';
import { javaFullstackFiles } from '../src/v4/java-fullstack-template.js';

const cwd = process.cwd();
const base = process.env.SG_VERIFY_ROOT || path.join(cwd, '.specgate', 'verify');
const toolchains = path.join(cwd, '.specgate', 'toolchains');
const only = process.argv[2] || null;
const presets = only ? JAVA_PRESETS.filter((item) => item.id === only) : JAVA_PRESETS;

function findFile(root, name, depth = 6) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const found = findFile(full, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function javaHome(preset) {
  const root = path.join(toolchains, 'jdk-' + preset.jdk);
  const java = findFile(root, 'java.exe');
  if (!java) throw new Error('No JDK ' + preset.jdk + ' under ' + root);
  return path.dirname(path.dirname(java));
}

function maven() {
  const found = findFile(toolchains, 'mvn.cmd');
  if (!found) throw new Error('No Maven under ' + toolchains);
  return found;
}

function run(name, command, args, cwd, env) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
    env,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
  });
  return {
    name,
    status: result.status === null ? 1 : result.status,
    durationMs: Date.now() - started,
    stdout: String(result.stdout || '').slice(-4000),
    stderr: String(result.stderr || result.error?.message || '').slice(-4000),
  };
}

const summary = [];
for (const preset of presets) {
  const root = path.join(base, preset.id);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const init = await startJavaInit({
    root,
    version: preset.id,
    userQuestions: { ask: async () => ({ answers: [{ selected: ['确认'] }] }) },
  });
  if (!init.ok) {
    summary.push({
      preset: preset.id,
      ok: false,
      stage: 'init',
      code: init.code,
      message: init.message,
    });
    continue;
  }
  const home = javaHome(preset);
  const env = {
    ...process.env,
    JAVA_HOME: home,
    PATH: path.join(home, 'bin') + path.delimiter + (process.env.PATH || process.env.Path || ''),
  };
  env.Path = env.PATH;
  const mvn = maven();
  const stages = [];
  stages.push(
    run('backend-verify', mvn, ['-B', '-ntp', 'verify'], path.join(root, 'backend'), env),
  );
  stages.push(
    run(
      'frontend-install',
      'npm.cmd',
      ['install', '--no-audit', '--no-fund'],
      path.join(root, 'frontend'),
      env,
    ),
  );
  stages.push(run('frontend-build', 'npm.cmd', ['run', 'build'], path.join(root, 'frontend'), env));
  stages.push(run('frontend-test', 'npm.cmd', ['run', 'test'], path.join(root, 'frontend'), env));
  stages.push(run('frontend-lint', 'npm.cmd', ['run', 'lint'], path.join(root, 'frontend'), env));
  stages.push(
    run('frontend-format', 'npm.cmd', ['run', 'format:check'], path.join(root, 'frontend'), env),
  );
  const ok = stages.every((stage) => stage.status === 0);
  const files = javaFullstackFiles({ preset });
  summary.push({
    preset: preset.id,
    ok,
    hash: templateHash(files),
    root,
    stages: stages.map((stage) => ({
      name: stage.name,
      status: stage.status,
      durationMs: stage.durationMs,
      tail: (stage.stderr || stage.stdout).split(/\r?\n/).filter(Boolean).slice(-3),
    })),
  });
}
console.log(JSON.stringify(summary, null, 2));
