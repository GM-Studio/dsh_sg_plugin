import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createToolRegistry } from '../src/codex/workflow-tools.js';
import { createStateStore } from '../src/codex/state-machine.js';

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-session-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('an unbound environment check accepts an explicit business path and binds subsequent tools', async (t) => {
  const root = temporary(t);
  const selections = [];
  const registry = createToolRegistry({
    projectRoot: process.cwd(),
    projectBound: false,
    environmentService: {
      check: async (selection) => {
        selections.push(selection);
        return { ok: true, environmentReady: true };
      },
    },
  });
  assert.equal((await registry.call('sg_env_check')).structuredContent.code, 'PROJECT_NOT_BOUND');
  assert.equal(
    (await registry.call('sg_env_check', { path: root, preset: 'jdk17-boot3.5' })).structuredContent
      .environmentReady,
    true,
  );
  assert.deepEqual(selections, [{ preset: 'jdk17-boot3.5' }]);
  assert.equal(
    (await registry.call('sg_project_status')).structuredContent.projectRoot,
    fs.realpathSync(root),
  );
  assert.deepEqual(fs.readdirSync(root), []);
  assert.equal(
    (await registry.call('sg_env_check', { path: path.join(root, 'missing') })).structuredContent
      .code,
    'PROJECT_ROOT_MISSING',
  );
  assert.equal(
    (await registry.call('sg_env_check', { path: process.cwd() })).structuredContent.code,
    'PROJECT_SOURCE_FORBIDDEN',
  );
  assert.equal(selections.length, 1);
  assert.equal(
    (await registry.call('sg_project_status')).structuredContent.projectRoot,
    fs.realpathSync(root),
  );
});

test('project status exposes the pending change version and H1 fallback without changing state', async (t) => {
  const root = temporary(t);
  const store = createStateStore({ projectRoot: root });
  let saved = await store.create({ expectedVersion: 0, changeId: 'existing-demand' });
  for (const to of ['REQ_CLARIFYING', 'REQ_CRITIQUE', 'H1_PENDING']) {
    saved = await store.transition({ expectedVersion: saved.state.version, to });
    assert.equal(saved.ok, true);
  }
  const before = await store.inspect();
  const registry = createToolRegistry({ projectRoot: root });
  const status = (await registry.call('sg_project_status')).structuredContent;
  assert.equal(status.workflow.phase, 'H1_PENDING');
  assert.equal(status.workflow.version, before.state.version);
  assert.equal(status.workflow.changeId, 'existing-demand');
  assert.equal(status.nextAction, 'REVIEW_REQUIREMENTS_THEN_REQUEST_H1');
  assert.equal(status.nextTool, 'sg_change');
  assert.deepEqual(status.nextArguments, {
    action: 'request_h1',
    expectedVersion: before.state.version,
  });
  assert.deepEqual(await store.inspect(), before);
});
