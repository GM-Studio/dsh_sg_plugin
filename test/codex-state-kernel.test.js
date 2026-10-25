import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createStateStore } from '../src/codex/state-machine.js';
import { verifyEventChain } from '../src/codex/events.js';
import * as kernel from '../src/codex/state-machine.js';
import * as legacy from '../src/codex/core/state.js';
import { patchState as patchFacts } from '../src/codex/core/project-facts.js';

test('project facts share the authoritative WAL and cannot mutate a legacy phase', async () => {
  const { projectRoot, store } = fixture();
  const saved = patchFacts(projectRoot, (draft) => {
    draft.runtime.suites.example = { status: 'not-run' };
  });
  assert.equal(saved.ok, true);
  assert.equal(fs.existsSync(path.join(projectRoot, '.specgate/state.json')), false);
  const state = (await store.inspect()).state;
  assert.equal(state.phase, null);
  assert.equal(state.context.projectFacts.runtime.suites.example.status, 'not-run');
  const refused = patchFacts(projectRoot, (draft) => {
    draft.phase = 'H1_PENDING';
  });
  assert.equal(refused.code, 'LEGACY_WORKFLOW_READ_ONLY');
  assert.equal((await store.inspect()).state.version, state.version);
});

test('public phases cover every internal value and legacy state has no writer exports', () => {
  assert.equal(typeof kernel.publicPhaseOf, 'function');
  assert.deepEqual(Object.keys(kernel.PUBLIC_PHASE_MAP).sort(), [...kernel.PHASES].sort());
  assert.equal(new Set(Object.values(kernel.PUBLIC_PHASE_MAP)).size, 13);
  assert.equal(kernel.publicPhaseOf('ARCHIVED_NOT_PUSHED'), 'DELIVERED');
  assert.equal(kernel.publicPhaseOf('PUSH_FAILED'), 'BLOCKED');
  assert.throws(() => kernel.publicPhaseOf('made-up'), /Unknown/);
  for (const name of ['save', 'init', 'patchState']) assert.equal(legacy[name], undefined);
});

test('legacy state edits after the first authoritative write fail closed', async () => {
  const { projectRoot, store } = fixture();
  await start(store);
  fs.writeFileSync(path.join(projectRoot, '.specgate/state.json'), '{"phase":"H1_PENDING"}');
  assert.equal((await store.inspect()).code, 'LEGACY_STATE_CHANGED');
});

function fixture(options = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-state-中文 space-'));
  return { projectRoot, store: createStateStore({ projectRoot, ...options }) };
}

async function start(store, changeId = 'change-one') {
  const result = await store.create({ changeId, expectedVersion: 0 });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.state;
}

function child(script, args = []) {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    processHandle.stdout.on('data', (data) => (stdout += data));
    processHandle.stderr.on('data', (data) => (stderr += data));
    processHandle.on('error', reject);
    processHandle.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const moduleUrl = pathToFileURL(path.resolve('src/codex/state-machine.js')).href;

test('fresh load is read-only, isolated from legacy state, and mutations require CAS', async () => {
  const { store, projectRoot } = fixture();
  fs.mkdirSync(path.join(projectRoot, '.specgate'));
  fs.writeFileSync(path.join(projectRoot, '.specgate/state.json'), 'legacy state');
  const initial = await store.load();
  assert.equal(initial.ok, true);
  assert.equal(initial.state.version, 0);
  assert.equal(fs.existsSync(path.join(projectRoot, '.specgate/codex')), false);
  assert.equal((await store.create({ changeId: 'one' })).code, 'INVALID_ARGUMENT');
  const state = await start(store);
  assert.equal(state.phase, 'REQ_INTAKE');
  assert.equal((await store.create({ changeId: 'two', expectedVersion: 1 })).code, 'ACTIVE_CHANGE');
  assert.equal(
    (await store.update({ expectedVersion: 0, patch: { context: {} } })).code,
    'VERSION_CONFLICT',
  );
  assert.equal(
    (await store.update({ expectedVersion: 1, patch: { phase: 'ARCHIVED' } })).code,
    'INVALID_ARGUMENT',
  );
  assert.equal(
    fs.readFileSync(path.join(projectRoot, '.specgate/state.json'), 'utf8'),
    'legacy state',
  );
});

test('inspect validates and rebuilds only in memory without creating locks or repairing files', async () => {
  const { store, projectRoot } = fixture();
  assert.equal((await store.inspect()).state.version, 0);
  assert.equal(fs.existsSync(path.join(projectRoot, '.specgate')), false);
  await start(store);
  const directory = path.join(projectRoot, '.specgate/codex');
  const snapshotPath = path.join(directory, 'state.json');
  const oldSnapshot = fs.readFileSync(snapshotPath, 'utf8');
  await store.update({ expectedVersion: 1, patch: { context: { durable: true } } });
  fs.writeFileSync(snapshotPath, oldSnapshot);
  const describe = () =>
    fs
      .readdirSync(directory)
      .sort()
      .map((name) => {
        const target = path.join(directory, name);
        return {
          name,
          mtime: fs.statSync(target).mtimeMs,
          content: fs.readFileSync(target, 'utf8'),
        };
      });
  const before = describe();
  const inspected = await store.inspect();
  assert.equal(inspected.ok, true);
  assert.equal(inspected.state.version, 2);
  assert.equal(inspected.snapshotBehind, true);
  assert.deepEqual(describe(), before);
  assert.equal((await store.load()).recovered, true);
});

test('legal migrations and opaque server gate hook protect H1 and H3', async () => {
  const { store } = fixture();
  await start(store);
  assert.equal(
    (await store.transition({ expectedVersion: 1, to: 'DEVELOPING' })).code,
    'INVALID_TRANSITION',
  );
  let version = 1;
  for (const to of ['REQ_CLARIFYING', 'REQ_CRITIQUE', 'H1_PENDING']) {
    assert.equal((await store.transition({ expectedVersion: version++, to })).ok, true);
  }
  for (const approval of [true, { approved: true }, { nonce: 'forged' }]) {
    assert.equal(
      (await store.transition({ expectedVersion: version, to: 'REQ_FROZEN', approval })).code,
      'APPROVAL_REQUIRED',
    );
  }
  const capability = Object.freeze({});
  const granted = fixture({
    authorizeGate: ({ gate, approval }) =>
      approval === capability
        ? { ok: true, record: { gate, result: 'approved' } }
        : { ok: false, code: 'APPROVAL_REQUIRED', message: 'Untrusted approval' },
  }).store;
  await start(granted);
  version = 1;
  for (const to of [
    'REQ_CLARIFYING',
    'REQ_CRITIQUE',
    'H1_PENDING',
    'REQ_FROZEN',
    'PLANNING',
    'TEST_DESIGN',
    'TEST_CASES_FROZEN',
    'DEVELOPING',
    'INTEGRATING',
    'TESTING',
    'FORMATTING',
    'REVIEWING',
    'H3_PENDING',
  ]) {
    assert.equal(
      (await granted.transition({ expectedVersion: version++, to, approval: capability })).ok,
      true,
    );
  }
  assert.equal(
    (await granted.transition({ expectedVersion: version, to: 'ARCHIVING', approval: true })).ok,
    false,
  );
  const archived = await granted.transition({
    expectedVersion: version,
    to: 'ARCHIVING',
    approval: capability,
  });
  assert.equal(archived.ok, true);
  assert.equal(archived.event.payload.approval.gate, 'H3');
});

test('concurrent clients and distinct processes cannot overwrite the same state version', async () => {
  const { store, projectRoot } = fixture();
  await start(store);
  const script = `import { createStateStore } from ${JSON.stringify(moduleUrl)};
    const store = createStateStore({projectRoot:process.argv[1]});
    process.stdout.write(JSON.stringify(await store.update({expectedVersion:1,patch:{context:{writer:process.pid}}})));`;
  const results = await Promise.all([child(script, [projectRoot]), child(script, [projectRoot])]);
  const writes = results.map((result) => {
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
  });
  assert.equal(writes.filter((result) => result.ok).length, 1);
  assert.equal(writes.find((result) => !result.ok).code, 'VERSION_CONFLICT');
  assert.equal((await store.load()).state.version, 2);
  const local = await Promise.all([
    store.update({ expectedVersion: 2, patch: { context: { a: 1 } } }),
    createStateStore({ projectRoot }).update({ expectedVersion: 2, patch: { context: { b: 2 } } }),
  ]);
  assert.equal(local.filter((result) => result.ok).length, 1);
});

test('every committed write is append-only and verifies as a hash chain', async () => {
  const { store, projectRoot } = fixture();
  await start(store);
  const eventsPath = path.join(projectRoot, '.specgate/codex/events.jsonl');
  const prefix = fs.readFileSync(eventsPath, 'utf8');
  await store.update({ expectedVersion: 1, patch: { context: { note: 'second' } } });
  const content = fs.readFileSync(eventsPath, 'utf8');
  assert.equal(content.startsWith(prefix), true);
  const verified = verifyEventChain(content);
  assert.equal(verified.ok, true);
  assert.equal(verified.events.length, 2);
  assert.equal(verified.events[1].previousHash, verified.events[0].hash);
  assert.equal(verified.events[1].state.version, 2);
  assert.equal(verified.events[1].type, 'state.updated');
  const recorded = await store.recordEvent({
    expectedVersion: 2,
    type: 'task.started',
    payload: { taskId: 'frontend' },
  });
  assert.equal(recorded.ok, true);
  assert.equal(recorded.state.version, 3);
  assert.equal(recorded.event.type, 'task.started');
  assert.equal(
    (
      await store.recordEvent({
        expectedVersion: 3,
        type: 'task.completed',
        payload: { taskId: 'frontend' },
      })
    ).state.version,
    4,
  );
});

test('audit tampering, incomplete writes and tail truncation fail closed without replacing evidence', async () => {
  for (const mode of ['modify', 'partial', 'truncate']) {
    const { store, projectRoot } = fixture();
    await start(store);
    await store.update({ expectedVersion: 1, patch: { context: { note: 'second' } } });
    const eventsPath = path.join(projectRoot, '.specgate/codex/events.jsonl');
    const original = fs.readFileSync(eventsPath, 'utf8');
    const damaged =
      mode === 'modify'
        ? original.replace('second', 'forged')
        : mode === 'partial'
          ? original + '{"partial":'
          : original.split('\n')[0] + '\n';
    fs.writeFileSync(eventsPath, damaged);
    const result = await store.load();
    assert.equal(result.ok, false, mode);
    assert.match(result.code, /AUDIT_CORRUPT|SNAPSHOT_AHEAD/);
    assert.equal(
      (await store.update({ expectedVersion: 2, patch: { context: { bypass: true } } })).ok,
      false,
    );
    assert.equal(fs.readFileSync(eventsPath, 'utf8'), damaged);
  }
});

test('crashed process after durable WAL commit is recovered and its stale lock is reclaimed', async () => {
  const { store, projectRoot } = fixture();
  await start(store);
  const script = `import fs from 'node:fs';
    import { createStateStore } from ${JSON.stringify(moduleUrl)};
    const originalRename=fs.renameSync;
    fs.renameSync=(from,to)=>{if(to.endsWith('state.json'))process.exit(79);return originalRename(from,to);};
    await createStateStore({projectRoot:process.argv[1]}).update({expectedVersion:1,patch:{context:{committed:true}}});`;
  const crashed = await child(script, [projectRoot]);
  assert.equal(crashed.code, 79, crashed.stderr);
  const loaded = await createStateStore({ projectRoot }).load();
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.equal(loaded.recovered, true);
  assert.equal(loaded.state.version, 2);
  assert.equal(loaded.state.context.committed, true);
  assert.equal(
    (await store.update({ expectedVersion: 1, patch: { context: {} } })).code,
    'VERSION_CONFLICT',
  );
  assert.equal(
    (await store.update({ expectedVersion: 2, patch: { context: { next: true } } })).ok,
    true,
  );
});

test('snapshot write failure returns the committed version and never repeats the WAL operation', async () => {
  const { store, projectRoot } = fixture();
  await start(store);
  const script = `import fs from 'node:fs';
    import { createStateStore } from ${JSON.stringify(moduleUrl)};
    fs.renameSync=()=>{throw new Error('simulated snapshot failure');};
    const store=createStateStore({projectRoot:process.argv[1]});
    const committed=await store.update({expectedVersion:1,patch:{context:{committed:true}}});
    const loaded=await store.load();
    process.stdout.write(JSON.stringify({committed,loaded}));`;
  const result = await child(script, [projectRoot]);
  assert.equal(result.code, 0, result.stderr);
  const { committed, loaded } = JSON.parse(result.stdout);
  assert.equal(committed.ok, true);
  assert.equal(committed.snapshotPending, true);
  assert.equal(committed.state.version, 2);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.snapshotPending, true);
  assert.equal(loaded.state.version, 2);
  assert.equal((await store.load()).state.context.committed, true);
  assert.equal(
    (await store.update({ expectedVersion: 1, patch: { context: {} } })).code,
    'VERSION_CONFLICT',
  );
  assert.equal(
    verifyEventChain(
      fs.readFileSync(path.join(projectRoot, '.specgate/codex/events.jsonl'), 'utf8'),
    ).events.length,
    2,
  );
});

test('snapshot ahead of audit and rewritten snapshot state are rejected', async () => {
  const { store, projectRoot } = fixture();
  await start(store);
  const snapshotPath = path.join(projectRoot, '.specgate/codex/state.json');
  const original = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  original.state.phase = 'ARCHIVED';
  fs.writeFileSync(snapshotPath, JSON.stringify(original));
  assert.equal((await store.load()).code, 'AUDIT_CORRUPT');
});

test('pause, stable checkpoint resume and cancellation preserve worktree and evidence references', async () => {
  const { store, projectRoot } = fixture();
  await start(store);
  const references = {
    worktree: 'worktrees/frontend',
    branch: 'change/frontend',
    evidence: ['proof.txt'],
  };
  await store.update({ expectedVersion: 1, patch: { context: references } });
  const checkpoint = await store.checkpoint({ expectedVersion: 2, label: 'intake saved' });
  assert.equal(checkpoint.ok, true);
  assert.equal((await store.pause({ expectedVersion: 3 })).state.phase, 'PAUSED');
  assert.equal(
    (await store.transition({ expectedVersion: 4, to: 'REQ_CLARIFYING' })).code,
    'INVALID_TRANSITION',
  );
  const resumed = await createStateStore({ projectRoot }).resume({ expectedVersion: 4 });
  assert.equal(resumed.state.phase, 'REQ_INTAKE');
  assert.deepEqual(resumed.state.context, references);
  const cancelled = await store.cancel({ expectedVersion: 5, reason: 'user stopped' });
  assert.equal(cancelled.state.phase, 'CANCELLED');
  assert.deepEqual(cancelled.state.context, references);
  assert.equal((await store.resume({ expectedVersion: 6 })).code, 'INVALID_TRANSITION');
  const next = await store.create({ expectedVersion: 6, changeId: 'change-two' });
  assert.equal(next.ok, true);
  assert.equal(next.state.version, 7);
  assert.equal(next.state.changeId, 'change-two');
});

test('development, test and review tasks share the two-retry ceiling and preserve failure evidence', async () => {
  for (const category of ['development', 'test', 'review']) {
    const { store } = fixture();
    await start(store);
    for (let expectedVersion = 1; expectedVersion <= 3; expectedVersion++) {
      const result = await store.retry({
        expectedVersion,
        taskId: 'task-one',
        category,
        error: 'command failed',
      });
      assert.equal(result.ok, true);
      assert.equal(result.retryAllowed, expectedVersion < 3);
      assert.equal(result.state.retries['task-one'].automaticRetries, Math.min(expectedVersion, 2));
      assert.equal(result.state.phase, expectedVersion < 3 ? 'REQ_INTAKE' : 'BLOCKED');
    }
    assert.equal(
      (await store.retry({ expectedVersion: 4, taskId: 'task-one', category, error: 'again' }))
        .code,
      'INVALID_TRANSITION',
    );
    assert.equal((await store.resume({ expectedVersion: 4 })).state.phase, 'REQ_INTAKE');
  }
});

test('a Change cannot multiply its automatic repair budget by changing task categories', async () => {
  const { store } = fixture();
  await start(store);
  for (const [index, category] of ['development', 'test', 'review'].entries()) {
    const result = await store.retry({
      expectedVersion: (await store.inspect()).state.version,
      taskId: `task-${category}`,
      category,
      error: 'failed',
    });
    assert.equal(result.retryAllowed, index < 2);
  }
  assert.equal((await store.inspect()).state.phase, 'BLOCKED');
});

test('live lock is bounded and symlink storage cannot write outside the bound project', async (t) => {
  const { store, projectRoot } = fixture({ lockTimeoutMs: 80 });
  await start(store);
  const lockPath = path.join(projectRoot, '.specgate/codex/write.lock');
  fs.mkdirSync(lockPath);
  fs.writeFileSync(
    path.join(lockPath, 'owner.json'),
    JSON.stringify({ pid: process.pid, token: 'held' }),
  );
  assert.equal(
    (await store.update({ expectedVersion: 1, patch: { context: {} } })).code,
    'STORE_BUSY',
  );
  fs.unlinkSync(path.join(lockPath, 'owner.json'));
  fs.rmdirSync(lockPath);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-external-'));
  const linked = fixture();
  fs.mkdirSync(path.join(linked.projectRoot, '.specgate'));
  try {
    fs.symlinkSync(external, path.join(linked.projectRoot, '.specgate/codex'), 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlinks unavailable');
    throw error;
  }
  assert.equal(
    (await linked.store.create({ expectedVersion: 0, changeId: 'escape' })).code,
    'UNSAFE_PATH',
  );
  assert.deepEqual(fs.readdirSync(external), []);
});
