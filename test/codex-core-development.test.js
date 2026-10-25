import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createDevelopmentService } from '../src/codex/development.js';
import { failureContext } from '../src/codex/core/failure-context.js';
import { fixture, roleProvider, commitAll } from './helpers/development-fixture.mjs';

const service = (context, provider) =>
  createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    redRunner: context.redRunner,
    roleProvider: provider,
  });
async function developed() {
  const context = await fixture();
  const development = service(context, roleProvider());
  assert.equal((await development.prepare({ expectedVersion: await context.version() })).ok, true);
  assert.equal((await development.run({ expectedVersion: await context.version() })).ok, true);
  return context;
}
function repairProvider(calls) {
  let count = 0;
  return async (role, challenge) => {
    calls.push({ role, challenge });
    const relative = role === 'backend' ? 'backend/src/TaskApi.java' : 'frontend/src/App.vue';
    fs.writeFileSync(
      path.join(challenge.worktree, relative),
      role === 'backend'
        ? `final class TaskApi { String title = "repair-${++count}"; }\n`
        : `<template><p>repair-${++count}</p></template>\n`,
    );
    commitAll(challenge.worktree, 'implement bounded repair');
    return { ok: true };
  };
}

test('a dirty main worktree blocks preparation before running the red command', async () => {
  const context = await fixture();
  fs.writeFileSync(path.join(context.root, 'unrelated.txt'), 'preserve user work');
  let called = false;
  const development = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    redRunner: () => {
      called = true;
      return context.redRunner();
    },
  });
  assert.equal(
    (await development.prepare({ expectedVersion: await context.version() })).code,
    'WORKTREE_DIRTY',
  );
  assert.equal(called, false);
  assert.equal(
    fs.readFileSync(path.join(context.root, 'unrelated.txt'), 'utf8'),
    'preserve user work',
  );
});

test('completion without a commit and dirty role worktrees never advance to quality', async () => {
  for (const dirty of [false, true]) {
    const context = await fixture();
    const development = service(context, async (_role, challenge) => {
      if (dirty)
        fs.writeFileSync(
          path.join(challenge.worktree, 'frontend/src/App.vue'),
          '<template>uncommitted</template>',
        );
      return { ok: true };
    });
    await development.prepare({ expectedVersion: await context.version() });
    const result = await development.run({ expectedVersion: await context.version() });
    assert.equal(result.ok, false);
    assert.notEqual((await context.store.inspect()).state.phase, 'TESTING');
    assert.equal(result.code, dirty ? 'WORKTREE_DIRTY' : 'WORKFLOW_BLOCKED');
    if (!dirty) assert.equal(result.errors.frontend.code, 'NO_COMMIT');
  }
});

test('a hardlink to content outside the assigned worktree is rejected even after commit', async () => {
  const context = await fixture();
  const outside = path.join(context.root, '.specgate/outside.txt');
  fs.writeFileSync(outside, 'outside fixture content');
  const development = service(
    context,
    roleProvider({
      frontend: async (challenge) => {
        fs.linkSync(outside, path.join(challenge.worktree, 'frontend/src/linked.txt'));
        commitAll(challenge.worktree, 'attempt hardlink escape');
        return { ok: true };
      },
    }),
  );
  await development.prepare({ expectedVersion: await context.version() });
  const result = await development.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.notEqual((await context.store.inspect()).state.phase, 'TESTING');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside fixture content');
});

test('two service instances cannot activate implementation writers concurrently', async () => {
  const context = await fixture();
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const ordinary = roleProvider();
  const provider = async (role, challenge) => {
    calls++;
    if (role === 'frontend') {
      entered();
      await wait;
    }
    return ordinary(role, challenge);
  };
  const first = service(context, provider);
  const second = service(context, provider);
  const prepared = await first.prepare({ expectedVersion: await context.version() });
  assert.equal(
    prepared.development.worktrees.frontend.path,
    prepared.development.worktrees.backend.path,
    'Sequential implementation roles share one physical worktree',
  );
  const pending = first.run({ expectedVersion: await context.version() });
  await started;
  const competing = second.run({ expectedVersion: await context.version() });
  let timer;
  const result = await Promise.race([
    competing,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ code: 'DID_NOT_REFUSE' }), 1000);
    }),
  ]);
  clearTimeout(timer);
  release();
  const completed = await pending;
  await competing;
  assert.equal(result.code, 'IMPLEMENTATION_BUSY');
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal(calls, 2);
});

test('a live separate process owns the writer lease and its proven-dead lease can be reclaimed', async (t) => {
  const context = await fixture();
  let calls = 0;
  const ordinary = roleProvider();
  const development = service(context, (role, challenge) => {
    calls++;
    return ordinary(role, challenge);
  });
  await development.prepare({ expectedVersion: await context.version() });
  const url = new URL('../src/codex/core/operation-lease.js', import.meta.url).href;
  const script = `import {withOperationLease} from ${JSON.stringify(url)}; await withOperationLease(process.argv[1],async()=>{console.log('LEASE_READY');await new Promise(resolve=>setInterval(resolve,60000));});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, context.root], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  let timer;
  await Promise.race([
    new Promise((resolve, reject) => {
      child.stdout.on('data', (data) => {
        if (String(data).includes('LEASE_READY')) resolve();
      });
      child.once('error', reject);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Lease process did not become ready')), 5000);
    }),
  ]);
  clearTimeout(timer);
  assert.equal(
    (await development.run({ expectedVersion: await context.version() })).code,
    'IMPLEMENTATION_BUSY',
  );
  assert.equal(calls, 0);
  child.kill('SIGKILL');
  await closed;
  assert.equal((await development.run({ expectedVersion: await context.version() })).ok, true);
  assert.equal(calls, 2);
  assert.equal(
    fs.existsSync(path.join(context.root, '.specgate/codex/implementation.lock')),
    false,
  );
});

test('oversized repair input is bounded, redacted and retains an evidence hash instead of silently expanding the prompt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-failure-context-'));
  const findings = Array.from({ length: 100 }, (_, index) => ({
    id: `FAIL-${index}`,
    file: 'backend/src/Task.java',
    line: 1,
    acIds: ['AC-1'],
    evidence: 'Bearer synthetic-sensitive-value ' + 'x'.repeat(8000),
    message: 'm'.repeat(8000),
    nested: { token: 'synthetic-sensitive-value' },
  }));
  const context = failureContext({
    root,
    source: 'quality',
    findings,
    quality: {
      command: {
        command: process.execPath,
        args: ['--token', 'synthetic-sensitive-value', ...Array(128).fill('x'.repeat(8192))],
        exitCode: 1,
      },
      cases: [
        {
          id: 'CASE-1',
          status: 'fail',
          expected: 'one',
          actual: { token: 'synthetic-sensitive-value' },
        },
      ],
    },
  });
  assert.ok(Buffer.byteLength(JSON.stringify(context)) <= 64 * 1024);
  assert.equal(context.truncated, true);
  assert.equal(context.findingCount, 100);
  assert.equal(context.findings[0].id, 'FAIL-0');
  assert.match(context.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(
    JSON.stringify(context).includes('synthetic-sensitive-value'),
    false,
    'Credential values must not enter a repair prompt',
  );
});

test('quality repair passes observed cases, command, exit, logs and file boundaries into the Implementer', async () => {
  const context = await developed();
  fs.writeFileSync(
    path.join(context.root, '.specgate/failure.log'),
    'expected=expected-title actual=wrong-title\nAuthorization: Bearer synthetic-credential-value\n',
  );
  await context.store.update({
    expectedVersion: await context.version(),
    patch: {
      context: {
        quality: {
          status: 'failed',
          command: { command: process.execPath, args: ['runner.mjs'], exitCode: 1 },
          stdoutLog: '.specgate/failure.log',
          cases: [
            { id: 'CASE-AC-1', status: 'fail', expected: 'expected-title', actual: 'wrong-title' },
          ],
          defects: [
            {
              id: 'QUALITY-1',
              message: 'Persisted title differs.',
              caseIds: ['CASE-AC-1'],
              acIds: ['AC-1'],
              owners: ['backend'],
              expected: 'expected-title',
              actual: 'wrong-title',
            },
          ],
        },
      },
    },
  });
  const calls = [];
  const development = service(context, repairProvider(calls));
  const prepared = await development.prepareRepair({ expectedVersion: await context.version() });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal((await development.run({ expectedVersion: await context.version() })).ok, true);
  assert.equal(calls.length, 1);
  const input = calls[0].challenge.repairContext;
  assert.ok(input);
  assert.equal(input.source, 'quality');
  assert.equal(input.command.exitCode, 1);
  assert.equal(input.findings[0].id, 'QUALITY-1');
  assert.equal(input.cases[0].id, 'CASE-AC-1');
  assert.equal(input.cases[0].expected, 'expected-title');
  assert.equal(input.cases[0].actual, 'wrong-title');
  assert.match(input.logSummary, /expected-title/);
  assert.doesNotMatch(JSON.stringify(input), /synthetic-credential-value/);
  assert.ok(calls[0].challenge.allowedFiles.includes('backend/**'));
});

test('Review findings reach rework and a third repair round blocks before creating more worktrees', async () => {
  const context = await developed();
  const calls = [];
  const development = service(context, repairProvider(calls));
  const finding = {
    id: 'REVIEW-1',
    severity: 'P1',
    file: 'backend/src/TaskApi.java',
    line: 1,
    acIds: ['AC-1'],
    evidence: 'Title differs on the changed line.',
    suggestion: 'Return the approved title.',
  };
  for (let round = 1; round <= 3; round++) {
    for (const to of ['FORMATTING', 'REVIEWING'])
      assert.equal(
        (await context.store.transition({ expectedVersion: await context.version(), to })).ok,
        true,
      );
    await context.store.update({
      expectedVersion: await context.version(),
      patch: { context: { review: { status: 'failed', blocking: [finding] } } },
    });
    const prepared = await development.prepareRework({ expectedVersion: await context.version() });
    if (round === 3) {
      assert.equal(prepared.code, 'WORKFLOW_BLOCKED');
      assert.equal((await context.store.inspect()).state.phase, 'BLOCKED');
      assert.equal(
        fs.existsSync(path.join(context.root, '.specgate/codex/worktrees/example/round-3')),
        false,
      );
    } else {
      assert.equal(prepared.ok, true, JSON.stringify(prepared));
      assert.equal((await development.run({ expectedVersion: await context.version() })).ok, true);
    }
  }
  assert.equal(calls.at(-1).challenge.repairContext.findings[0].id, finding.id);
  assert.equal(calls.at(-1).challenge.repairContext.findings[0].line, 1);
  assert.equal(calls.at(-1).challenge.repairContext.findings[0].evidence, finding.evidence);
});
