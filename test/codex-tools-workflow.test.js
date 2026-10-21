import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStateStore } from '../src/codex/state-machine.js';
import { createToolRegistry } from '../src/codex/workflow-tools.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-tools-'));
const data = (result) => result.structuredContent;

test('state inspection is read-only and mutation schemas require a current version', async () => {
  const projectRoot = temp();
  const registry = createToolRegistry({ projectRoot });
  const initial = await registry.call('sg_state', {});
  assert.equal(initial.isError, false);
  assert.equal(data(initial).state.version, 0);
  assert.deepEqual(fs.readdirSync(projectRoot), []);
  const rejected = await registry.call('sg_cancel', { approved: true });
  assert.equal(rejected.isError, true);
  assert.equal(data(rejected).code, 'INVALID_ARGUMENT');
  assert.deepEqual(fs.readdirSync(projectRoot), []);
});

test('MCP lifecycle controls preserve worktrees and evidence and enforce CAS', async () => {
  const projectRoot = temp();
  const store = createStateStore({ projectRoot });
  const created = await store.create({ expectedVersion: 0, changeId: 'example' });
  assert.equal(created.ok, true);
  const retained = path.join(projectRoot, 'worktree-evidence.txt');
  fs.writeFileSync(retained, 'preserve');
  const registry = createToolRegistry({ projectRoot });
  const paused = data(await registry.call('sg_pause', { expectedVersion: created.state.version }));
  assert.equal(paused.state.phase, 'PAUSED');
  const conflict = data(
    await registry.call('sg_resume', { expectedVersion: created.state.version }),
  );
  assert.equal(conflict.code, 'VERSION_CONFLICT');
  const resumed = data(await registry.call('sg_resume', { expectedVersion: paused.state.version }));
  assert.equal(resumed.state.phase, 'REQ_INTAKE');
  const cancelled = data(
    await registry.call('sg_cancel', {
      expectedVersion: resumed.state.version,
      reason: 'user cancelled',
    }),
  );
  assert.equal(cancelled.state.phase, 'CANCELLED');
  assert.equal(fs.readFileSync(retained, 'utf8'), 'preserve');
  assert.equal(data(await registry.call('status', {})).workflow.state.phase, 'CANCELLED');
});

test('init preview is read-only; nonempty initialization cannot manufacture approval', async () => {
  const projectRoot = temp();
  fs.writeFileSync(path.join(projectRoot, 'README.md'), 'user content');
  const registry = createToolRegistry({ projectRoot });
  const preview = data(await registry.call('sg_init_preview', {}));
  assert.equal(preview.ok, true);
  assert.equal(preview.nonEmpty, true);
  const denied = data(await registry.call('sg_init', { previewHash: preview.previewHash }));
  assert.equal(denied.ok, false);
  assert.match(denied.code, /APPROVAL/);
  const forged = data(
    await registry.call('sg_init', { previewHash: preview.previewHash, approved: true }),
  );
  assert.equal(forged.code, 'INVALID_ARGUMENT');
  assert.deepEqual(fs.readdirSync(projectRoot), ['README.md']);
  assert.equal(fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8'), 'user content');
});

test('the public tool set cannot import approvals or arbitrarily change phases', async () => {
  const registry = createToolRegistry({ projectRoot: temp() });
  const names = registry.definitions.map((tool) => tool.name);
  for (const name of ['sg_approve', 'sg_transition', 'sg_issue_approval', 'sg_write_state']) {
    assert.equal(names.includes(name), false);
    assert.equal(data(await registry.call(name, { approved: true })).code, 'UNKNOWN_TOOL');
  }
  const status = data(await registry.call('status', {}));
  assert.equal(status.trustedApproval.status, 'unavailable');
  assert.equal(status.verification.status, 'not-run');
  assert.equal(status.planning.testRole, 'unavailable');
  assert.equal(status.development.status, 'unavailable');
  assert.equal(status.quality.status, 'unavailable');
  assert.equal(status.review.status, 'unavailable');
  assert.equal(status.release.status, 'available');
  for (const name of [
    'sg_plan_inspect',
    'sg_plan_generate',
    'sg_plan_freeze_contracts',
    'sg_plan_freeze_tests',
    'sg_development_inspect',
    'sg_development_prepare',
    'sg_development_run',
    'sg_quality_inspect',
    'sg_quality_run',
    'sg_review_inspect',
    'sg_review_run',
    'sg_review_request_h3',
    'sg_release_preview',
    'sg_release_archive',
  ])
    assert.equal(names.includes(name), true);
});

test('plan and development tools expose only versions and frozen content, never roles or commands', async () => {
  const projectRoot = temp();
  const registry = createToolRegistry({
    projectRoot,
    planRoleProvider: async () => ({}),
    developmentRoleProvider: async () => ({ ok: true }),
    redRunner: async () => null,
    qualityTestRunner: async () => ({ ok: true }),
    qualityVerifier: async () => ({ ok: true }),
    reviewRoleProvider: async () => ({ ok: true }),
  });
  assert.equal(
    registry.validate('sg_development_run', {
      expectedVersion: 0,
      role: 'frontend',
    }),
    false,
  );
  assert.equal(
    registry.validate('sg_development_prepare', {
      expectedVersion: 0,
      command: process.execPath,
    }),
    false,
  );
  assert.equal(
    registry.validate('sg_plan_freeze_contracts', {
      expectedVersion: 0,
      contract: { version: 1, content: { endpoints: [] } },
      model: { version: 1, content: { entities: [] } },
      provider: 'model',
    }),
    false,
  );
  assert.equal(registry.validate('sg_development_run', { expectedVersion: 0 }), true);
  assert.equal(
    registry.validate('sg_quality_run', {
      expectedVersion: 0,
      command: process.execPath,
    }),
    false,
  );
  assert.equal(registry.validate('sg_quality_run', { expectedVersion: 0 }), true);
  assert.equal(registry.validate('sg_review_run', { expectedVersion: 0, mode: 'strict' }), true);
  assert.equal(
    registry.validate('sg_review_run', {
      expectedVersion: 0,
      findings: [{ severity: 'P0' }],
    }),
    false,
  );
  assert.equal(registry.validate('sg_release_archive', { expectedVersion: 0, force: true }), false);
  assert.deepEqual(fs.readdirSync(projectRoot), []);
  const status = data(await registry.call('status', {}));
  assert.equal(status.planning.testRole, 'available');
  assert.equal(status.development.status, 'available');
  assert.deepEqual(status.development.fixedWorktrees, [
    'frontend',
    'backend',
    'integration',
    'test',
    'review',
  ]);
  assert.equal(status.quality.status, 'available');
  assert.equal(status.quality.verifier, 'custom');
  assert.equal(status.review.status, 'available');
  assert.equal(status.release.forcePush, 'forbidden');
});

test('nested change schemas reject forged answers and credentials before touching storage', async () => {
  const projectRoot = temp();
  const registry = createToolRegistry({ projectRoot });
  const draft = {
    expectedVersion: 0,
    requirements: [
      {
        id: 'REQ-1',
        category: 'functional',
        text: 'Query tasks.',
        acceptanceCriteria: [{ id: 'AC-1', text: 'GET returns JSON.' }],
      },
    ],
    assumptions: [],
    openIssues: [],
  };
  assert.equal(registry.validate('sg_change_propose', draft), true);
  assert.equal(
    registry.validate('sg_change_propose', {
      ...draft,
      requirements: [{ ...draft.requirements[0], approved: true }],
    }),
    false,
  );
  const questions = {
    expectedVersion: 0,
    questions: [{ id: 'Q-1', category: 'functional', text: 'Which task fields?' }],
  };
  assert.equal(registry.validate('sg_change_questions', questions), true);
  assert.equal(registry.validate('sg_change_questions', { expectedVersion: 0, round: 1 }), true);
  assert.equal(registry.validate('sg_change_questions', { ...questions, round: 1 }), false);
  assert.equal(registry.validate('sg_change_questions', { expectedVersion: 0 }), false);
  const denied = data(
    await registry.call('sg_change_questions', { ...questions, answers: [{ answer: 'yes' }] }),
  );
  assert.equal(denied.code, 'INVALID_ARGUMENT');
  assert.deepEqual(fs.readdirSync(projectRoot), []);
});
