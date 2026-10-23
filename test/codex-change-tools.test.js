import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHANGE_TOOLS, CHANGE_METHODS, callChangeTool } from '../src/codex/change-tools.js';
import { createChangeAddService } from '../src/codex/change-add.js';
import { createStateStore } from '../src/codex/state-machine.js';
import { createApprovalAuthority } from '../src/codex/approvals.js';

function walk(schema, visit) {
  visit(schema);
  for (const child of Object.values(schema.properties ?? {})) walk(child, visit);
  if (schema.items) walk(schema.items, visit);
  for (const child of schema.oneOf ?? []) walk(child, visit);
}

function fixture() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-change-tool-fixture-'));
  fs.mkdirSync(path.join(projectRoot, '.specgate'));
  fs.writeFileSync(
    path.join(projectRoot, '.specgate/init-report.json'),
    JSON.stringify({ fixture: true, initializationComplete: true }),
  );
  fs.writeFileSync(path.join(projectRoot, '.specgate/config.yaml'), 'fixture: true');
  fs.writeFileSync(path.join(projectRoot, '.specgate/monorepo.json'), '{}');
  fs.writeFileSync(path.join(projectRoot, '.gitignore'), '.specgate/codex/\n');
  const environment = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
    ),
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['commit', '-q', '-m', 'synthetic fixture baseline'],
  ]) {
    const result = spawnSync(
      'git',
      [
        '-c',
        'core.hooksPath=' + path.join(projectRoot, 'disabled-hooks'),
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@local',
        ...args,
      ],
      { cwd: projectRoot, env: environment, encoding: 'utf8', timeout: 10000, windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  const store = createStateStore({ projectRoot });
  const service = createChangeAddService({
    projectRoot,
    store,
    approvalAuthority: createApprovalAuthority(),
    // Synthetic, server-owned prerequisites and input source for API examples.
    // This fixture does not claim Java/Vue runtime verification or native approval.
    verifyPrerequisites: async () => ({ ok: true, sourceHash: 'synthetic-fixture' }),
    userInputProvider: {
      trustedUserIdentity: { id: 'fixture-user', kind: 'user', source: 'fixture-native-channel' },
      request: async ({ questions }) => ({
        answers: questions.map((question) => ({
          questionId: question.id,
          answer: 'Search the task title.',
        })),
      }),
    },
  });
  return { service, store };
}

const requirement = {
  id: 'REQ-1',
  category: 'functional',
  text: 'Search tasks by title.',
  acceptanceCriteria: [{ id: 'AC-1', text: 'GET queries return matching tasks.' }],
};
const report = {
  restatement: [{ requirementId: 'REQ-1', text: 'Search existing task titles.' }],
  ambiguities: [],
  contradictions: [],
  infeasibleItems: [],
  nonFunctionalRisks: [],
  securityPerformanceConcurrencyRisks: [],
  testBlindSpots: [],
  suggestedQuestions: [],
};

test('tool schemas declare strict nested structures and guarded versioned mutations', () => {
  assert.deepEqual(
    CHANGE_TOOLS.map((tool) => tool.name).sort(),
    Object.keys(CHANGE_METHODS).sort(),
  );
  assert.equal(new Set(CHANGE_TOOLS.map((tool) => tool.name)).size, 7);
  for (const tool of CHANGE_TOOLS) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 20);
    if (tool.name === 'sg_change_preflight') {
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.deepEqual(tool.inputSchema.properties, {});
    } else {
      assert.equal(tool.annotations.readOnlyHint, false);
      assert.ok(tool.inputSchema.required.includes('expectedVersion'));
      assert.equal(tool.inputSchema.properties.expectedVersion.type, 'integer');
      assert.equal(tool.inputSchema.properties.expectedVersion.minimum, 0);
    }
    walk(tool.inputSchema, (schema) => {
      if (schema.type === 'object') assert.equal(schema.additionalProperties, false);
      for (const field of [
        'approved',
        'approval',
        'receipt',
        'actor',
        'answers',
        'trustedUserIdentity',
      ])
        assert.equal(Object.hasOwn(schema.properties ?? {}, field), false);
    });
  }
  const questions = CHANGE_TOOLS.find((tool) => tool.name === 'sg_change_questions').inputSchema;
  assert.deepEqual(questions.oneOf, [{ required: ['questions'] }, { required: ['round'] }]);
  assert.equal(questions.properties.questions.maxItems, 5);
  assert.equal(questions.properties.round.maximum, 3);
  const proposal = CHANGE_TOOLS.find((tool) => tool.name === 'sg_change_propose').inputSchema;
  assert.equal(proposal.properties.requirements.maxItems, 200);
  assert.equal(proposal.properties.requirements.items.properties.acceptanceCriteria.maxItems, 100);
});

test('declared examples dispatch through the actual controlled service and fail closed at default H1', async () => {
  const { service, store } = fixture();
  assert.equal((await callChangeTool(service, 'sg_change_preflight', {})).ok, true);
  let result = await callChangeTool(service, 'sg_change_add', {
    expectedVersion: 0,
    name: 'tool-example',
    request: 'Add task title search.',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.context.changeAdd.rounds.length, 1);
  assert.equal(result.state.context.changeAdd.rounds[0].source, 'server-intake');
  assert.equal(result.state.context.changeAdd.rounds[0].status, 'answered');
  assert.equal(result.state.context.changeAdd.rounds[0].questions.length, 5);
  assert.equal(result.state.context.changeAdd.rounds[0].answers[0].source, 'native-user-provider');
  result = await callChangeTool(service, 'sg_change_propose', {
    expectedVersion: result.state.version,
    requirements: [requirement],
    assumptions: [],
    openIssues: [],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  result = await callChangeTool(service, 'sg_change_questions', {
    expectedVersion: result.state.version,
    questions: [{ id: 'Q-1', category: 'functional', text: 'Which task field is searchable?' }],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.context.changeAdd.rounds.length, 2);
  assert.equal(result.state.context.changeAdd.rounds[1].source, 'model-proposal');
  assert.equal(result.state.context.changeAdd.rounds[1].status, 'answered');
  result = await callChangeTool(service, 'sg_change_critique', {
    expectedVersion: result.state.version,
    report,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.phase, 'H1_PENDING');
  result = await callChangeTool(service, 'sg_request_h1', {
    expectedVersion: result.state.version,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'APPROVAL_CHANNEL_UNAVAILABLE');
  assert.equal((await store.load()).state.phase, 'H1_PENDING');
});

test('tool wrappers refuse unknown fields and never accept approval or user provenance', async () => {
  const { service, store } = fixture();
  for (const tool of CHANGE_TOOLS) {
    const args = tool.name === 'sg_change_preflight' ? {} : { expectedVersion: 0 };
    for (const forged of [
      { approved: true },
      { receipt: { source: 'model' } },
      { actor: 'user' },
      { answers: ['yes'] },
    ]) {
      const result = await callChangeTool(service, tool.name, { ...args, ...forged });
      assert.equal(result.code, 'INVALID_ARGUMENT');
    }
  }
  const started = await callChangeTool(service, 'sg_change_add', {
    expectedVersion: 0,
    request: 'Add task search.',
  });
  const refused = await callChangeTool(service, 'sg_change_propose', {
    expectedVersion: started.state.version,
    requirements: [{ ...requirement, actor: 'user' }],
    assumptions: [],
    openIssues: [],
  });
  assert.equal(refused.code, 'REQUIREMENTS_INVALID');
  assert.equal((await store.load()).state.version, started.state.version);
});

test('dispatch neither constructs a service nor invokes inherited or unavailable methods', async () => {
  assert.equal(
    (await callChangeTool({}, 'sg_change_add', { expectedVersion: 0, request: 'x' })).code,
    'CHANGE_SERVICE_UNAVAILABLE',
  );
  assert.equal((await callChangeTool({}, '__proto__', {})).code, 'UNKNOWN_TOOL');
  assert.equal((await callChangeTool({}, 'sg_approve', {})).code, 'UNKNOWN_TOOL');
  const failed = await callChangeTool(
    {
      start: async () => {
        throw new Error('do-not-leak-client-secret');
      },
    },
    'sg_change_add',
    { expectedVersion: 0, request: 'x' },
  );
  assert.equal(failed.code, 'CHANGE_TOOL_FAILED');
  assert.doesNotMatch(JSON.stringify(failed), /do-not-leak/);
});

test('server cancellation context is forwarded separately and cannot be submitted as a tool argument', async () => {
  const controller = new AbortController();
  const context = { signal: controller.signal };
  const args = { expectedVersion: 0 };
  const result = await callChangeTool(
    {
      requestH1: async (input, serverContext) => {
        assert.equal(input, args);
        assert.equal(serverContext, context);
        return { ok: true };
      },
    },
    'sg_request_h1',
    args,
    context,
  );
  assert.equal(result.ok, true);
  assert.equal(
    (await callChangeTool({}, 'sg_request_h1', { ...args, signal: controller.signal })).code,
    'INVALID_ARGUMENT',
  );
});

test('unified sg_change accepts feature, modify and fix while rejecting invalid details', async () => {
  const { service } = fixture();
  const invalid = await callChangeTool(service, 'sg_change', {
    expectedVersion: 0,
    name: 'invalid-fix',
    type: 'fix',
    request: 'Fix the filter.',
    details: { actualBehavior: 'Open tasks are returned.' },
  });
  assert.equal(invalid.code, 'CHANGE_DETAILS_INVALID');
  const started = await callChangeTool(service, 'sg_change', {
    expectedVersion: 0,
    name: 'fix-filter',
    type: 'fix',
    request: 'Fix the completed filter.',
    details: {
      expectedBehavior: 'Only completed tasks are returned.',
      actualBehavior: 'Open tasks are returned.',
      reproduction: 'Select completed in the filter.',
    },
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(started.state.context.changeAdd.change.type, 'fix');
  assert.equal(started.state.context.changeAdd.rounds.length, 1);
  assert.equal(started.state.context.changeAdd.rounds[0].source, 'server-intake');
  assert.equal(started.state.context.changeAdd.rounds[0].status, 'answered');
  assert.equal(started.state.context.changeAdd.rounds[0].questions.length, 5);
  const proposed = await callChangeTool(service, 'sg_change_propose', {
    expectedVersion: started.state.version,
    requirements: [requirement],
    assumptions: [],
    openIssues: [],
  });
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  const critiqued = await callChangeTool(service, 'sg_change_critique', {
    expectedVersion: proposed.state.version,
    report,
  });
  assert.equal(critiqued.ok, true, JSON.stringify(critiqued));
  const snapshot = critiqued.state.context.changeAdd.candidate.snapshot;
  assert.equal(snapshot.changeContract.type, 'fix');
  assert.deepEqual(snapshot.changeContract.acceptance, ['AC-1']);
});
