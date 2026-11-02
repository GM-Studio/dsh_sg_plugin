import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mcpClient } from './environment-mcp-client.mjs';
import { createStateStore } from '../src/codex/state-machine.js';
import { resolveProfile, resolveScenario } from '../src/codex/core/validation-profile.js';

test('native MCP adopts a real Node project and freezes an explicit refactor policy through H1', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-validation-policy-'));
  fs.writeFileSync(path.join(root, '.gitignore'), '.specgate/\nnode_modules/\n');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'validation-policy-fixture',
      private: true,
      scripts: { test: 'node --test business.test.cjs' },
    }),
  );
  fs.writeFileSync(path.join(root, 'business.cjs'), 'module.exports = 42;\n');
  fs.writeFileSync(
    path.join(root, 'business.test.cjs'),
    "require('node:test')('business answer',()=>require('node:assert/strict').equal(require('./business.cjs'),42));\n",
  );
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  for (const args of [
    ['init', '-q'],
    ['config', 'user.name', 'Policy Fixture'],
    ['config', 'user.email', 'fixture@local'],
    ['add', '.'],
    ['commit', '-qm', 'real runnable Node fixture'],
  ])
    git(args);
  const client = await mcpClient(t, root, { env: { SPECGATE_NATIVE_AGENTS: '0' } });
  let forms = 0;
  client.form((params) => {
    forms++;
    const properties = params.requestedSchema.properties;
    return {
      action: 'accept',
      content: Object.fromEntries(
        Object.entries(properties).map(([id, schema]) => [
          id,
          schema.enum?.[0] ?? 'Preserve the existing answer 42; change only internal structure.',
        ]),
      ),
    };
  });
  const call = async (name, args = {}) => (await client.call(name, args)).structuredContent;
  const preview = await call('sg_adopt_preview');
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const adopted = await call('sg_adopt_apply', { previewHash: preview.previewHash });
  assert.equal(adopted.ok, true, JSON.stringify(adopted));
  let status;
  const deadline = Date.now() + 30000;
  do {
    status = await call('sg_project_status');
    if (status.projectReady || status.baselineRun?.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.equal(status.projectReady, true, JSON.stringify(status));
  const started = await call('sg_change', {
    expectedVersion: 0,
    name: 'refactor-answer',
    type: 'refactor',
    validationProfile: 'scenario-v1',
    request: 'Refactor the implementation while preserving the answer.',
    details: {
      internalStructure: 'Extract answer calculation.',
      preservedBehavior: 'The answer remains 42.',
      constraints: 'No dependency or public API change.',
    },
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  const store = createStateStore({ projectRoot: root });
  let current = (await store.inspect()).state;
  assert.equal(resolveProfile(current).profile.profileId, 'scenario-v1');
  assert.equal(resolveScenario(current).scenario, 'refactor');
  const proposed = await call('sg_change_propose', {
    expectedVersion: current.version,
    requirements: [
      {
        id: 'REQ-1',
        category: 'functional',
        text: 'Preserve the answer during internal refactoring.',
        acceptanceCriteria: [{ id: 'AC-1', text: 'The answer is 42.' }],
      },
    ],
    assumptions: [],
    openIssues: [],
  });
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  const critiqued = await call('sg_change_critique', {
    expectedVersion: proposed.state.version,
    report: {
      restatement: [
        { requirementId: 'REQ-1', text: 'Internal refactoring preserves observable behavior.' },
      ],
      ambiguities: [],
      contradictions: [],
      infeasibleItems: [],
      nonFunctionalRisks: [],
      securityPerformanceConcurrencyRisks: [],
      testBlindSpots: [],
      suggestedQuestions: [],
    },
  });
  assert.equal(critiqued.ok, true, JSON.stringify(critiqued));
  current = (await store.inspect()).state;
  assert.equal(
    current.context.changeAdd.candidate.snapshot.validationProfile.profileId,
    'scenario-v1',
  );
  assert.match(
    fs.readFileSync(path.join(root, current.context.changeAdd.document.path), 'utf8'),
    /scenario-v1/,
  );
  const h1 = await call('sg_change', { action: 'request_h1', expectedVersion: current.version });
  assert.equal(h1.ok, true, JSON.stringify(h1));
  current = (await store.inspect()).state;
  for (const patch of [
    { validationProfile: 'legacy' },
    {
      changeAdd: {
        ...current.context.changeAdd,
        change: { ...current.context.changeAdd.change, type: 'fix' },
      },
    },
  ])
    assert.equal(
      (await store.update({ expectedVersion: current.version, patch: { context: patch } })).code,
      'VALIDATION_POLICY_FROZEN',
    );
  assert.equal((await store.inspect()).state.version, current.version);
  const reopened = createStateStore({ projectRoot: root });
  assert.equal(resolveProfile((await reopened.inspect()).state).profile.profileId, 'scenario-v1');
  assert.equal(forms, 2, 'real clarification and H1 requests, fixture responses only');
  const fresh = await mcpClient(t, root, { env: { SPECGATE_NATIVE_AGENTS: '0' } });
  const restored = (await fresh.call('sg_state')).structuredContent;
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(restored.state.context.validationProfile.profileId, 'scenario-v1');
  assert.equal(restored.state.context.changeAdd.change.type, 'refactor');
  const invoke = async (name, args) => (await fresh.call(name, args)).structuredContent;
  const planned = await invoke('sg_plan_generate', { expectedVersion: restored.state.version });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  const contracts = await invoke('sg_plan_freeze_contracts', {
    expectedVersion: planned.state.version,
    contract: {
      version: 1,
      content: { endpoints: [{ method: 'GET', path: '/answer', operation: 'query' }] },
    },
    model: { version: 1, content: { entities: [{ name: 'Answer', fields: { value: 'number' } }] } },
  });
  assert.equal(contracts.ok, true, JSON.stringify(contracts));
  const prepared = await invoke('sg_test_design_prepare', {
    expectedVersion: contracts.state.version,
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal(prepared.nextAction, 'ASSIGN_SPECGATE_TEST_DESIGNER_THEN_FREEZE');
  assert.equal(prepared.challenge.validationProfile.profileId, 'scenario-v1');
  assert.equal(prepared.challenge.scenario, 'refactor');
  assert.equal(prepared.challenge.policy.redBaseline, 'none');
  assert.match(prepared.challenge.baselineRequirements, /every frozen case successfully/);
});
