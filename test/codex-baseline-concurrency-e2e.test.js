import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mcpClient } from './environment-mcp-client.mjs';
import { inspectBaselineLease } from '../src/codex/core/baseline-lease.js';
import { isProcessAlive } from '../src/codex/core/lock.js';

const roots = [];
test.after(() => {
  for (const root of roots)
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
});
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-baseline-concurrent-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n.specgate/\n');
  fs.writeFileSync(path.join(root, 'active-sentinel.txt'), 'preserve-live-worktree\n');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'concurrent-baseline-proof',
      version: '1.0.0',
      scripts: { test: 'node proof.cjs' },
    }),
  );
  fs.writeFileSync(
    path.join(root, 'proof.cjs'),
    'const fs=require("node:fs");fs.writeFileSync(process.env.SG_TEST_STARTED,JSON.stringify({pid:process.pid,cwd:process.cwd()}));const timer=setInterval(()=>{if(fs.existsSync(process.env.SG_TEST_GATE)){clearInterval(timer);console.log("real-concurrent-baseline-ok")}},25);\n',
  );
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['config', 'user.name', 'Concurrency Fixture'],
    ['config', 'user.email', 'fixture@localhost'],
    ['add', '.'],
    ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'],
  ]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  }
  return root;
}
async function until(read, accepted, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accepted(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail('Timed out waiting for real baseline: ' + JSON.stringify(value));
}

test('two real MCP servers reuse one active baseline and never remove its live worktree', async (t) => {
  const root = project(),
    gate = path.join(root, '.specgate', 'test-gate'),
    started = path.join(root, '.specgate', 'test-started.json');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  let first;
  t.after(async () => {
    fs.writeFileSync(gate, 'continue');
    if (first)
      await until(
        async () => (await first.call('sg_project_status')).structuredContent,
        (status) => status.projectReady || status.baselineRun?.status === 'failed',
      );
  });
  first = await mcpClient(t, root, { env: { SG_TEST_GATE: gate, SG_TEST_STARTED: started } });
  const second = await mcpClient(t, root, {
    env: { SG_TEST_GATE: gate, SG_TEST_STARTED: started },
  });
  const preview = (await first.call('sg_adopt_preview')).structuredContent;
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const initial = (await first.call('sg_adopt_apply', { previewHash: preview.previewHash }))
    .structuredContent;
  assert.equal(initial.ok, true, JSON.stringify(initial));
  const executing = await until(
    () => (fs.existsSync(started) ? JSON.parse(fs.readFileSync(started, 'utf8')) : null),
    Boolean,
  );
  assert.equal(
    fs.readFileSync(path.join(executing.cwd, 'active-sentinel.txt'), 'utf8').trim(),
    'preserve-live-worktree',
  );
  const repeated = (await second.call('sg_adopt_apply', { previewHash: preview.previewHash }))
    .structuredContent;
  assert.equal(repeated.ok, true, JSON.stringify(repeated));
  assert.equal(repeated.runId, initial.runId, 'a repeated request must reuse the running task');
  assert.equal(
    fs.readFileSync(path.join(executing.cwd, 'active-sentinel.txt'), 'utf8').trim(),
    'preserve-live-worktree',
  );
  fs.writeFileSync(gate, 'continue');
  const finished = await until(
    async () => (await first.call('sg_project_status')).structuredContent,
    (status) => status.projectReady || status.baselineRun?.status === 'failed',
  );
  assert.equal(finished.projectReady, true, JSON.stringify(finished));
  assert.equal(finished.baseline.status, 'green');
  const summary = JSON.parse(
    fs.readFileSync(
      path.join(root, '.specgate/codex/baseline-runs', initial.runId, 'summary.json'),
      'utf8',
    ),
  );
  assert.match(
    summary.commands.find((entry) => entry.kind === 'test').stdout,
    /real-concurrent-baseline-ok/,
  );
});

test('a crashed owner cannot reclaim a live child; after exit a fresh run recovers only its own worktree', async (t) => {
  const root = project(),
    gate = path.join(root, '.specgate', 'test-gate'),
    started = path.join(root, '.specgate', 'test-started.json');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  t.after(() => fs.writeFileSync(gate, 'continue'));
  const env = { SG_TEST_GATE: gate, SG_TEST_STARTED: started };
  const first = await mcpClient(t, root, { env });
  const second = await mcpClient(t, root, { env });
  const preview = (await first.call('sg_adopt_preview')).structuredContent;
  const initial = (await first.call('sg_adopt_apply', { previewHash: preview.previewHash }))
    .structuredContent;
  assert.equal(initial.ok, true, JSON.stringify(initial));
  const executing = await until(
    () => (fs.existsSync(started) ? JSON.parse(fs.readFileSync(started, 'utf8')) : null),
    Boolean,
  );
  const leaseRoot = path.join(root, '.git/specgate/baseline-lease');
  const owner = inspectBaselineLease(leaseRoot);
  assert.ok(owner.workerPid && owner.workerPid !== process.pid);
  process.kill(owner.workerPid, 'SIGKILL');
  await until(
    () => isProcessAlive(owner.workerPid),
    (alive) => !alive,
  );
  const orphan = inspectBaselineLease(leaseRoot);
  assert.equal(orphan.ownerAlive, false);
  assert.equal(orphan.childAlive, true);
  const blocked = (await second.call('sg_adopt_apply', { previewHash: preview.previewHash }))
    .structuredContent;
  assert.equal(blocked.ok, false, JSON.stringify(blocked));
  assert.equal(blocked.code, 'BASELINE_ALREADY_RUNNING', JSON.stringify(blocked));
  assert.equal(
    fs.readFileSync(path.join(executing.cwd, 'active-sentinel.txt'), 'utf8').trim(),
    'preserve-live-worktree',
  );
  fs.writeFileSync(gate, 'continue');
  await until(
    () => inspectBaselineLease(leaseRoot).alive,
    (alive) => !alive,
  );
  // Observing a dead lease and issuing a new MCP request are not atomic.
  // Discovery may observe a live/uncertain PID again; require eventual fresh ownership,
  // while allowing the public busy/reuse response to preserve the old worktree.
  const restarted = await until(
    async () => {
      const result = (await second.call('sg_adopt_apply', { previewHash: preview.previewHash }))
        .structuredContent;
      assert.ok(result.ok || result.code === 'BASELINE_ALREADY_RUNNING', JSON.stringify(result));
      if (result.runId === initial.runId)
        console.log(
          'baseline restart awaiting fresh ownership',
          JSON.stringify({ result, lease: inspectBaselineLease(leaseRoot) }),
        );
      return result;
    },
    (result) => result.ok && result.runId !== initial.runId,
  );
  assert.equal(restarted.ok, true, JSON.stringify(restarted));
  assert.notEqual(restarted.runId, initial.runId);
  const finished = await until(
    async () => (await second.call('sg_project_status')).structuredContent,
    (status) => status.projectReady || status.baselineRun?.status === 'failed',
  );
  assert.equal(finished.projectReady, true, JSON.stringify(finished));
  assert.equal(finished.baseline.status, 'green');
  assert.equal(fs.existsSync(executing.cwd), false);
  const retained = JSON.parse(
    fs.readFileSync(
      path.join(root, '.git/specgate/baseline-jobs', initial.runId, 'status.json'),
      'utf8',
    ),
  );
  assert.equal(retained.code, 'BASELINE_WORKER_EXITED');
  assert.equal(
    fs.existsSync(
      path.join(root, '.specgate/codex/baseline-runs', restarted.runId, 'summary.json'),
    ),
    true,
  );
});

test('a different real Git preview is rejected while the original worktree is running', async (t) => {
  const root = project(),
    gate = path.join(root, '.specgate/test-gate'),
    started = path.join(root, '.specgate/test-started.json');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  t.after(() => fs.writeFileSync(gate, 'continue'));
  const env = { SG_TEST_GATE: gate, SG_TEST_STARTED: started };
  const client = await mcpClient(t, root, { env });
  const preview = (await client.call('sg_adopt_preview')).structuredContent;
  const initial = (await client.call('sg_adopt_apply', { previewHash: preview.previewHash }))
    .structuredContent;
  assert.equal(initial.ok, true, JSON.stringify(initial));
  const executing = await until(
    () => (fs.existsSync(started) ? JSON.parse(fs.readFileSync(started, 'utf8')) : null),
    Boolean,
  );
  fs.writeFileSync(path.join(root, 'new-source.txt'), 'a separately committed source revision\n');
  for (const args of [
    ['add', 'new-source.txt'],
    ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'new source'],
  ]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  }
  const changed = (await client.call('sg_adopt_preview')).structuredContent;
  assert.notEqual(changed.previewHash, preview.previewHash);
  const rejected = (await client.call('sg_adopt_apply', { previewHash: changed.previewHash }))
    .structuredContent;
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'BASELINE_ALREADY_RUNNING');
  assert.equal(
    fs.readFileSync(path.join(executing.cwd, 'active-sentinel.txt'), 'utf8').trim(),
    'preserve-live-worktree',
  );
  fs.writeFileSync(gate, 'continue');
  const finished = await until(
    async () => (await client.call('sg_project_status')).structuredContent,
    (status) => status.baselineRun?.status === 'failed',
  );
  assert.equal(finished.projectReady, false);
  assert.equal(finished.baselineRun.code, 'ADOPTION_PREVIEW_STALE');
});

test('simultaneous requests in separate MCP processes create exactly one baseline', async (t) => {
  const root = project(),
    gate = path.join(root, '.specgate/test-gate'),
    started = path.join(root, '.specgate/test-started.json');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  let client;
  t.after(async () => {
    fs.writeFileSync(gate, 'continue');
    if (client)
      await until(
        async () => (await client.call('sg_project_status')).structuredContent,
        (status) => status.projectReady || status.baselineRun?.status === 'failed',
      );
  });
  const env = { SG_TEST_GATE: gate, SG_TEST_STARTED: started };
  client = await mcpClient(t, root, { env });
  const peer = await mcpClient(t, root, { env });
  const preview = (await client.call('sg_adopt_preview')).structuredContent;
  const attempts = await Promise.all(
    [client, peer].map(
      async (entry) =>
        (await entry.call('sg_adopt_apply', { previewHash: preview.previewHash }))
          .structuredContent,
    ),
  );
  assert.ok(
    attempts.every((entry) => entry.ok),
    JSON.stringify(attempts),
  );
  assert.equal(attempts[0].runId, attempts[1].runId);
  assert.equal(
    fs
      .readdirSync(path.join(root, '.git/specgate/baseline-jobs'))
      .filter((entry) => entry.startsWith('baseline-run-')).length,
    1,
  );
  fs.writeFileSync(gate, 'continue');
  const finished = await until(
    async () => (await client.call('sg_project_status')).structuredContent,
    (status) => status.projectReady || status.baselineRun?.status === 'failed',
  );
  assert.equal(finished.projectReady, true, JSON.stringify(finished));
});

test('unreadable ownership fails closed without changing or deleting its files', async (t) => {
  const root = project(),
    lease = path.join(root, '.git/specgate/baseline-lease');
  fs.mkdirSync(lease, { recursive: true });
  fs.writeFileSync(path.join(lease, 'owner.json'), '{unreadable');
  const client = await mcpClient(t, root);
  const preview = (await client.call('sg_adopt_preview')).structuredContent;
  const blocked = (await client.call('sg_adopt_apply', { previewHash: preview.previewHash }))
    .structuredContent;
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'BASELINE_LEASE_INVALID', JSON.stringify(blocked));
  assert.equal(fs.readFileSync(path.join(lease, 'owner.json'), 'utf8'), '{unreadable');
  assert.equal(fs.existsSync(path.join(root, '.git/specgate/baseline-jobs')), false);
});

test('separate repositories sharing a configured worktree parent never reclaim each other', async (t) => {
  const firstRoot = project(),
    secondRoot = project();
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-baseline-shared-'));
  roots.push(shared);
  const sessions = [];
  t.after(async () => {
    for (const entry of sessions) fs.writeFileSync(entry.gate, 'continue');
    for (const entry of sessions)
      await until(
        async () => (await entry.client.call('sg_project_status')).structuredContent,
        (status) => status.projectReady || status.baselineRun?.status === 'failed',
      );
  });
  for (const root of [firstRoot, secondRoot]) {
    const gate = path.join(root, '.specgate/test-gate'),
      started = path.join(root, '.specgate/test-started.json');
    fs.mkdirSync(path.dirname(gate), { recursive: true });
    const client = await mcpClient(t, root, {
      env: {
        SG_TEST_GATE: gate,
        SG_TEST_STARTED: started,
        SPECGATE_BASELINE_WORKTREE_ROOT: shared,
      },
    });
    sessions.push({ client, gate });
    const preview = (await client.call('sg_adopt_preview')).structuredContent;
    const result = (await client.call('sg_adopt_apply', { previewHash: preview.previewHash }))
      .structuredContent;
    assert.equal(result.ok, true, JSON.stringify(result));
    const executing = await until(
      () => (fs.existsSync(started) ? JSON.parse(fs.readFileSync(started, 'utf8')) : null),
      Boolean,
    );
    sessions.at(-1).cwd = executing.cwd;
  }
  for (const entry of sessions)
    assert.equal(
      fs.readFileSync(path.join(entry.cwd, 'active-sentinel.txt'), 'utf8').trim(),
      'preserve-live-worktree',
    );
  for (const entry of sessions) fs.writeFileSync(entry.gate, 'continue');
  for (const entry of sessions) {
    const finished = await until(
      async () => (await entry.client.call('sg_project_status')).structuredContent,
      (status) => status.projectReady || status.baselineRun?.status === 'failed',
    );
    assert.equal(finished.projectReady, true, JSON.stringify(finished));
  }
});
