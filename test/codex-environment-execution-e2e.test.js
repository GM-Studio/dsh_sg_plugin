import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEnvironmentService } from '../src/codex/core/environment.js';
import { runBaselineCommand } from '../src/codex/baseline.js';
import { spawnSync } from 'node:child_process';
import { mcpClient } from './environment-mcp-client.mjs';
import { createNativeFormatter } from '../src/codex/format.js';
import { gitExecutable } from '../src/codex/core/git-runtime.js';

const roots = [];
test.after(() => {
  for (const root of roots)
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-env-execution-'));
  roots.push(root);
  return root;
}

test('the real checked Node/npm paths are consumed by baseline commands without changing process environment', async (t) => {
  const root = temporary(t);
  const service = createEnvironmentService({ root });
  assert.equal(
    typeof service.executionContext,
    'function',
    'a checked environment needs a server-owned execution context',
  );
  const before = { path: process.env.PATH, javaHome: process.env.JAVA_HOME };
  const context = await service.executionContext({ stack: 'node' });
  assert.equal(context.ok, true, JSON.stringify(context.report));
  for (const argv of [
    ['node', '-p', 'process.execPath'],
    ['npm', '--version'],
  ]) {
    const result = await runBaselineCommand({
      command: { id: 'real-' + argv[0], argv },
      cwd: root,
      executionContext: context,
    });
    assert.equal(result.status, 'passed', JSON.stringify(result));
    assert.ok(path.isAbsolute(result.argv[0]));
  }
  assert.deepEqual({ path: process.env.PATH, javaHome: process.env.JAVA_HOME }, before);
});

test('real MCP adoption carries checked tools into the detached worktree worker and records executed paths', async (t) => {
  const root = temporary(t);
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'context-proof',
      version: '1.0.0',
      scripts: { test: 'node -e "console.log(\'real-worker:\'+process.execPath)"' },
    }),
  );
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Environment Fixture']);
  git(['config', 'user.email', 'fixture@localhost']);
  git(['add', '.']);
  git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  const client = await mcpClient(t, root);
  const preview = (await client.call('sg_adopt_preview')).structuredContent;
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const started = (await client.call('sg_adopt_apply', { previewHash: preview.previewHash }))
    .structuredContent;
  assert.equal(started.ok, true, JSON.stringify(started));
  let status;
  for (let i = 0; i < 300; i++) {
    status = (await client.call('sg_project_status')).structuredContent;
    if (status.projectReady || status.baselineRun?.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(status.projectReady, true, JSON.stringify(status));
  assert.equal(status.baseline.status, 'green');
  const summary = JSON.parse(
    fs.readFileSync(
      path.join(root, '.specgate/codex/baseline-runs', started.runId, 'summary.json'),
      'utf8',
    ),
  );
  assert.ok(summary.commands.every((entry) => path.isAbsolute(entry.executedArgv[0])));
  assert.match(summary.commands.find((entry) => entry.kind === 'test').stdout, /real-worker:/);
});

test('checked JDK/Maven compile and execute Java with a corrected child JAVA_HOME', async (t) => {
  const root = temporary(t);
  const service = createEnvironmentService({
    root,
    env: { ...process.env, JAVA_HOME: path.join(root, 'stale-java-home') },
  });
  assert.equal(typeof service.executionContext, 'function');
  const context = await service.executionContext({ stack: 'java', javaVersion: '17' });
  assert.equal(context.ok, true, JSON.stringify(context.report));
  fs.writeFileSync(
    path.join(root, 'EnvironmentProof.java'),
    'public class EnvironmentProof { public static void main(String[] args) { System.out.print("real-java-ok"); } }\n',
  );
  for (const argv of [
    ['mvn', '-v'],
    ['javac', 'EnvironmentProof.java'],
    ['java', 'EnvironmentProof'],
  ]) {
    const result = await runBaselineCommand({
      command: { id: 'real-' + argv[0], argv },
      cwd: root,
      executionContext: context,
    });
    assert.equal(result.status, 'passed', JSON.stringify(result));
    assert.ok(path.isAbsolute(result.argv[0]));
    if (argv[0] === 'java') assert.equal(result.stdout, 'real-java-ok');
  }
});

test('native formatter and Git control operations reuse actual executables without global PATH edits', async (t) => {
  const root = temporary(t),
    frontend = path.join(root, 'frontend');
  fs.mkdirSync(path.join(frontend, 'node_modules'), { recursive: true });
  fs.writeFileSync(
    path.join(frontend, 'package.json'),
    JSON.stringify({
      scripts: { format: 'node -e "console.log(\'formatter-runtime:\'+process.execPath)"' },
    }),
  );
  const service = createEnvironmentService({ root });
  const result = await createNativeFormatter({
    environmentContext: () => service.executionContext(),
  })({ worktree: root });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.commands.at(-1).stdout, /formatter-runtime:/);
  assert.ok(path.isAbsolute(result.commands.at(-1).executedArgv[0]));
  const git = gitExecutable({ ...process.env, PATH: '' });
  assert.ok(path.isAbsolute(git));
  const probe = spawnSync(git, ['--version'], { encoding: 'utf8', windowsHide: true });
  assert.equal(probe.status, 0, probe.stderr);
});
