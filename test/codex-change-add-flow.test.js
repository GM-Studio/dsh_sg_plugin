import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createChangeAddService, stableChangeName } from '../src/codex/change-add.js';
import { createStateStore } from '../src/codex/state-machine.js';
import { createApprovalAuthority } from '../src/codex/approvals.js';
import { persistProjectReadiness } from '../src/codex/project-state.js';
import { projectEnvironmentFingerprint } from '../src/codex/baseline.js';
import { createDeliveryRecord, persistDelivery } from '../src/codex/delivery.js';
import { hashValue } from '../src/codex/events.js';
import { fileURLToPath } from 'node:url';

const nativeUser = { id: 'fixture-user', kind: 'user', source: 'fixture-native-user-channel' };
const requirements = [
  {
    id: 'REQ-1',
    category: 'functional',
    text: 'Return a searchable task list.',
    acceptanceCriteria: [{ id: 'AC-1', text: 'GET task queries return JSON.' }],
  },
];
const critique = {
  restatement: [{ requirementId: 'REQ-1', text: 'Users can search existing tasks.' }],
  ambiguities: [],
  contradictions: [],
  infeasibleItems: [],
  nonFunctionalRisks: [],
  securityPerformanceConcurrencyRisks: [],
  testBlindSpots: [],
  suggestedQuestions: [],
};

function git(root, args) {
  const result = spawnSync(
    'git',
    [
      '-c',
      'core.hooksPath=' + path.join(root, 'disabled-hooks'),
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@local',
      ...args,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
        ),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
        GIT_TERMINAL_PROMPT: '0',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture({
  native = false,
  input = false,
  verifier = true,
  decision = 'approve',
  nativeRequest,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-change-fixture-'));
  fs.mkdirSync(path.join(root, '.specgate'));
  fs.writeFileSync(
    path.join(root, '.specgate/init-report.json'),
    JSON.stringify({ initializationComplete: true, phase: 'SMOKE_PASSED', fixture: true }),
  );
  fs.writeFileSync(path.join(root, '.specgate/config.yaml'), 'fixture: true\n');
  fs.writeFileSync(path.join(root, '.specgate/monorepo.json'), '{}\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.specgate/codex/\n');
  fs.writeFileSync(
    path.join(root, 'business.txt'),
    'synthetic fixture, not a verified Java/Vue project\n',
  );
  git(root, ['init', '-q']);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'fixture baseline']);
  let store;
  const authority = createApprovalAuthority({
    request: native
      ? (nativeRequest ??
        (async () => ({
          action: 'accept',
          content: { decision, comment: 'Synthetic fixture only.' },
        })))
      : undefined,
    trustedPeerIdentity: native ? nativeUser : undefined,
    audit: async (event) => {
      const loaded = await store.load();
      const saved = await store.recordEvent({
        expectedVersion: loaded.state.version,
        type: event.type,
        payload: event,
      });
      if (!saved.ok) throw new Error(saved.code);
    },
  });
  store = createStateStore({ projectRoot: root, authorizeGate: authority.authorizeGate });
  const options = {
    projectRoot: root,
    store,
    approvalAuthority: authority,
    // Deliberately synthetic constructor dependency. No runtime evidence is claimed.
    ...(verifier
      ? {
          verifyPrerequisites: async () => ({
            ok: true,
            sourceHash: 'synthetic-fixture-not-runtime-evidence',
          }),
        }
      : {}),
    ...(input
      ? {
          userInputProvider: {
            trustedUserIdentity: nativeUser,
            request: async ({ questions }) => ({
              answers: questions.map((question) => ({
                questionId: question.id,
                answer: 'User fixture answer.',
              })),
            }),
          },
        }
      : {}),
  };
  return { root, store, service: createChangeAddService(options), options };
}

// ProjectProfile-backed fixture with one accepted parent delivery, so the
// incremental intake path can resolve a real parent and persist a plan.
function incrementalFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-incremental-fixture-'));
  fs.mkdirSync(path.join(root, '.specgate'));
  fs.writeFileSync(
    path.join(root, '.specgate/init-report.json'),
    JSON.stringify({ initializationComplete: true, phase: 'SMOKE_PASSED', fixture: true }),
  );
  fs.writeFileSync(path.join(root, '.specgate/config.yaml'), 'fixture: true\n');
  fs.writeFileSync(path.join(root, '.specgate/monorepo.json'), '{}\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.specgate/codex/\n');
  fs.writeFileSync(path.join(root, 'business.txt'), 'synthetic fixture, not a verified project\n');
  git(root, ['init', '-q']);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'fixture baseline']);
  const now = '2026-01-01T00:00:00.000Z';
  const head = git(root, ['rev-parse', 'HEAD']);
  const profile = {
    schemaVersion: 2,
    projectId: 'project-incremental',
    mode: 'adopted',
    stack: 'java-vue',
    root,
    targetBranch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    remoteUrl: null,
    commands: { install: [], build: [], test: [], lint: [], format: [], runtime: [] },
    protectedPaths: [],
    createdAt: now,
    updatedAt: now,
  };
  const fingerprint = projectEnvironmentFingerprint(profile);
  const baseline = {
    schemaVersion: 2,
    baselineId: 'baseline-incremental',
    projectId: profile.projectId,
    commit: head,
    status: 'green',
    knownFailures: [],
    unverifiedAreas: [],
    commands: [],
    evidence: [],
    environmentFingerprint: fingerprint,
    createdAt: now,
  };
  const readiness = persistProjectReadiness({ root, profile, baseline });
  assert.equal(readiness.ok, true, JSON.stringify(readiness));
  const delivery = (deliveryId, projectId, changeId, acceptance) => {
    const created = createDeliveryRecord({
      deliveryId,
      projectId,
      changeId,
      parentDeliveryId: null,
      baselineCommit: head,
      deliveryCommit: head,
      environmentFingerprint: fingerprint,
      reviewMode: 'evidence',
      acceptedAt: now,
      acceptance,
      evidence: ['evidence-' + deliveryId],
      knownIssues: [],
      rollback: { code: 'git revert', data: deliveryId + ' data', forwardFix: 'apply fix' },
      push: { requested: false, remoteUrl: null, status: 'not-requested' },
      state: 'delivery-accepted',
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    const persisted = persistDelivery({
      projectRoot: root,
      delivery: created.delivery,
      createTag: false,
    });
    assert.equal(persisted.ok, true, JSON.stringify(persisted));
  };
  delivery('delivery-feedback-1', profile.projectId, 'change-accepted-1', ['AC-1', 'AC-2']);
  delivery('delivery-foreign-1', 'project-foreign', 'change-foreign-1', ['AC-1']);
  const store = createStateStore({ projectRoot: root });
  const service = createChangeAddService({
    projectRoot: root,
    store,
    verifyPrerequisites: async () => ({ ok: true, sourceHash: 'synthetic-fixture' }),
    userInputProvider: {
      trustedUserIdentity: nativeUser,
      request: async ({ questions }) => ({
        answers: questions.map((question) => ({
          questionId: question.id,
          answer: 'Synthetic incremental fixture answer.',
        })),
      }),
    },
  });
  return { root, store, service, deliveryId: 'delivery-feedback-1' };
}

async function start(f) {
  const result = await f.service.start({
    request: 'Add a searchable task list.',
    expectedVersion: 0,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.context.changeAdd.rounds[0].source, 'server-intake');
  assert.equal(result.state.context.changeAdd.rounds[0].status, 'answered');
  assert.equal(result.state.context.changeAdd.rounds[0].questions.length, 5);
  return result.state;
}

async function pendingIntake(f, code = 'USER_INPUT_UNAVAILABLE') {
  const result = await f.service.start({
    request: 'Add a searchable task list.',
    expectedVersion: 0,
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.code, code);
  assert.equal(result.status, 'WAITING_FOR_USER');
  assert.equal(result.nextAction, 'RESUME_CLARIFICATION');
  assert.equal(result.state.phase, 'REQ_CLARIFYING');
  assert.equal(result.state.context.changeAdd.rounds.length, 1);
  assert.equal(result.state.context.changeAdd.rounds[0].source, 'server-intake');
  assert.equal(result.state.context.changeAdd.rounds[0].questions.length, 5);
  assert.equal(result.state.context.changeAdd.rounds[0].status, 'pending');
  return result.state;
}

async function draft(f, extra = {}) {
  const state = (await f.store.load()).state;
  const result = await f.service.propose({
    expectedVersion: state.version,
    requirements,
    assumptions: [],
    openIssues: [],
    ...extra,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.state;
}

async function reviewed(f, report = critique) {
  await start(f);
  await draft(f);
  const state = (await f.store.load()).state;
  const result = await f.service.critique({ expectedVersion: state.version, report });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.state;
}

test('stable names support multilingual requests and explicit valid names', () => {
  assert.equal(stableChangeName('新增任务查询'), stableChangeName('新增任务查询'));
  assert.match(stableChangeName('新增任务查询'), /^change-[a-f0-9]{12}$/);
  assert.notEqual(stableChangeName('request one'), stableChangeName('request two'));
});

test('synthetic prerequisite fixture permits intake but real default verifier rejects it', async () => {
  const f = fixture();
  assert.equal((await f.service.inspectPrerequisites()).ok, true);
  const actual = fixture({ verifier: false });
  const refused = await actual.service.start({ request: 'A feature', expectedVersion: 0 });
  assert.equal(refused.ok, false);
  assert.equal(fs.existsSync(path.join(actual.root, '.specgate/codex')), false);
});

test('generated-only initialization, dirty tracked files, and untracked files refuse intake without state writes', async () => {
  for (const mode of ['generated-only', 'tracked', 'untracked']) {
    const f = fixture();
    if (mode === 'generated-only')
      fs.writeFileSync(
        path.join(f.root, '.specgate/init-report.json'),
        JSON.stringify({ phase: 'GENERATED_ONLY', initializationComplete: false }),
      );
    if (mode === 'tracked') fs.appendFileSync(path.join(f.root, 'business.txt'), 'dirty');
    if (mode === 'untracked') fs.writeFileSync(path.join(f.root, 'untracked.txt'), 'dirty');
    const result = await f.service.start({ request: 'A feature', expectedVersion: 0 });
    assert.equal(result.ok, false);
    assert.equal(
      result.code,
      mode === 'generated-only' ? 'INITIALIZATION_NOT_VERIFIED' : 'GIT_NOT_CLEAN',
    );
    assert.equal(fs.existsSync(path.join(f.root, '.specgate/codex')), false);
  }
});

test('only one active change can be created and model text cannot forge user provenance', async () => {
  const f = fixture({ input: true });
  const state = await start(f);
  assert.equal(state.context.changeAdd.request.source, 'command-input');
  assert.equal(
    (await f.service.start({ request: 'Another feature', expectedVersion: state.version })).code,
    'ACTIVE_CHANGE',
  );
  assert.equal(
    (
      await f.service.propose({
        expectedVersion: state.version,
        requirements,
        assumptions: [],
        openIssues: [],
        actor: nativeUser,
      })
    ).code,
    'INVALID_ARGUMENT',
  );
});

test('draft revisions preserve history and label inferred content as model proposals', async () => {
  const f = fixture({ input: true });
  await start(f);
  await draft(f);
  const state = await draft(f, {
    requirements: [{ ...requirements[0], text: 'Return a paginated searchable task list.' }],
  });
  assert.equal(state.context.changeAdd.revisions.length, 2);
  assert.equal(state.context.changeAdd.revisions[0].requirements[0].text, requirements[0].text);
  assert.equal(state.context.changeAdd.revisions[1].source, 'model-proposal');
});

test('clarification enforces three rounds and five questions and records only trusted-provider answers', async () => {
  const f = fixture({ input: true });
  await start(f);
  await draft(f);
  const questions = [
    { id: 'Q-1', category: 'functional', text: 'Which task fields are searchable?' },
  ];
  let state = (await f.store.load()).state;
  assert.equal(
    (
      await f.service.askQuestions({
        expectedVersion: state.version,
        questions: Array.from({ length: 6 }, (_, i) => ({ ...questions[0], id: `Q-${i}` })),
      })
    ).code,
    'QUESTION_LIMIT',
  );
  state = (await f.store.load()).state;
  assert.equal(state.context.changeAdd.rounds.length, 1);
  assert.equal(state.context.changeAdd.rounds[0].source, 'server-intake');
  assert.equal(state.context.changeAdd.rounds[0].status, 'answered');
  assert.equal(state.context.changeAdd.rounds[0].questions.length, 5);
  for (let round = 2; round <= 3; round++) {
    state = (await f.store.load()).state;
    const result = await f.service.askQuestions({ expectedVersion: state.version, questions });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.state.context.changeAdd.rounds.length, round);
    assert.equal(
      result.state.context.changeAdd.rounds[round - 1].answers[0].source,
      'native-user-provider',
    );
    assert.deepEqual(result.state.context.changeAdd.rounds[round - 1].answers[0].actor, nativeUser);
  }
  state = (await f.store.load()).state;
  assert.equal(
    (await f.service.askQuestions({ expectedVersion: state.version, questions })).code,
    'QUESTION_LIMIT',
  );
});

test('without a trusted input source, the pending intake is preserved and tool answers are refused', async () => {
  const f = fixture();
  const state = await pendingIntake(f);
  const questions = [{ id: 'Q-1', category: 'functional', text: 'Which task fields?' }];
  assert.equal(
    (await f.service.askQuestions({ expectedVersion: state.version, questions })).code,
    'CLARIFICATION_PENDING',
  );
  assert.equal(
    (await f.service.askQuestions({ expectedVersion: state.version, round: 1 })).code,
    'USER_INPUT_UNAVAILABLE',
  );
  assert.equal(
    (
      await f.service.askQuestions({
        expectedVersion: state.version,
        questions,
        answers: ['approved'],
      })
    ).code,
    'INVALID_ARGUMENT',
  );
  const after = (await f.store.load()).state;
  assert.equal(after.context.changeAdd.rounds.length, 1);
  assert.equal(after.context.changeAdd.rounds[0].status, 'pending');
});

test('choice answers preserve arrays and reject unavailable options before recording user input', async () => {
  const f = fixture({ input: true });
  await start(f);
  let state = await draft(f);
  let invalid = true;
  f.service = createChangeAddService({
    ...f.options,
    userInputProvider: {
      trustedUserIdentity: nativeUser,
      request: async () => ({
        answers: [
          { questionId: 'single', answer: invalid ? 'Unknown' : 'Vue' },
          { questionId: 'multiple', answer: ['查询', '导出'] },
        ],
      }),
    },
  });
  const questions = [
    {
      id: 'single',
      category: 'constraint',
      text: '框架',
      input: 'choice',
      options: ['Vue', 'React'],
    },
    {
      id: 'multiple',
      category: 'functional',
      text: '功能',
      input: 'multi-choice',
      options: ['查询', '导出'],
    },
  ];
  for (const malformed of [
    { ...questions[0], options: undefined },
    { ...questions[0], options: ['Vue', 'Vue'] },
    { ...questions[0], input: 'text' },
  ]) {
    assert.equal(
      (await f.service.askQuestions({ expectedVersion: state.version, questions: [malformed] }))
        .code,
      'INVALID_ARGUMENT',
    );
  }
  const refused = await f.service.askQuestions({ expectedVersion: state.version, questions });
  assert.equal(refused.code, 'USER_INPUT_INVALID');
  state = (await f.store.load()).state;
  assert.equal(state.context.changeAdd.rounds[1].status, 'pending');
  assert.deepEqual(state.context.changeAdd.rounds[1].answers, []);
  invalid = false;
  const accepted = await f.service.askQuestions({ expectedVersion: state.version, round: 2 });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.deepEqual(accepted.state.context.changeAdd.rounds[1].answers[1].answer, ['查询', '导出']);
});

test('critique requires structured categories and valid requirement references', async () => {
  const f = fixture({ input: true });
  await start(f);
  const state = await draft(f);
  assert.equal(
    (await f.service.critique({ expectedVersion: state.version, report: { restatement: [] } }))
      .code,
    'CRITIQUE_INVALID',
  );
  const report = {
    ...critique,
    ambiguities: [
      {
        id: 'F-1',
        requirementIds: ['REQ-missing'],
        text: 'Unknown reference',
        severity: 'blocking',
        suggestion: 'Clarify.',
      },
    ],
  };
  assert.equal(
    (await f.service.critique({ expectedVersion: state.version, report })).code,
    'CRITIQUE_INVALID',
  );
});

test('duplicate IDs, incomplete restatements and unmapped dependencies are rejected before H1', async () => {
  const f = fixture({ input: true });
  const state = await start(f);
  for (const proposed of [
    [requirements[0], requirements[0]],
    [requirements[0], { ...requirements[0], id: 'REQ-2' }],
  ]) {
    assert.equal(
      (
        await f.service.propose({
          expectedVersion: state.version,
          requirements: proposed,
          assumptions: [],
          openIssues: [],
        })
      ).code,
      'REQUIREMENTS_INVALID',
    );
  }
  const hash = 'sha256:' + 'a'.repeat(64);
  const dependency = { file: 'backend/pom.xml', hash, acIds: ['AC-missing'] };
  assert.equal(
    (
      await f.service.propose({
        expectedVersion: state.version,
        requirements: [{ ...requirements[0], dependencyChanges: [dependency] }],
        assumptions: [],
        openIssues: [],
      })
    ).code,
    'REQUIREMENTS_INVALID',
  );
  dependency.acIds = ['AC-1'];
  const proposed = await f.service.propose({
    expectedVersion: state.version,
    requirements: [{ ...requirements[0], dependencyChanges: [dependency] }],
    assumptions: [],
    openIssues: [],
  });
  assert.equal(proposed.ok, true);
  assert.equal(
    (
      await f.service.critique({
        expectedVersion: proposed.state.version,
        report: { ...critique, restatement: [] },
      })
    ).code,
    'CRITIQUE_INVALID',
  );
  const reviewed = await f.service.critique({
    expectedVersion: proposed.state.version,
    report: critique,
  });
  assert.equal(reviewed.ok, true);
  const document = reviewed.state.context.changeAdd.document;
  const markdown = fs.readFileSync(path.join(f.root, document.path), 'utf8');
  assert.ok(markdown.includes(hash));
  assert.ok(markdown.includes('backend/pom.xml'));
});

test('blocking issues or critique findings cannot freeze at H1', async () => {
  for (const mode of ['issue', 'critique']) {
    const f = fixture({ input: true, native: true });
    await start(f);
    await draft(
      f,
      mode === 'issue'
        ? {
            openIssues: [
              { id: 'ISSUE-1', text: 'Authentication policy unresolved.', blocking: true },
            ],
          }
        : {},
    );
    let state = (await f.store.load()).state;
    const report =
      mode === 'critique'
        ? {
            ...critique,
            testBlindSpots: [
              {
                id: 'F-1',
                requirementIds: ['REQ-1'],
                text: 'Missing failure acceptance.',
                severity: 'blocking',
                suggestion: 'Specify behavior.',
              },
            ],
          }
        : critique;
    state = (await f.service.critique({ expectedVersion: state.version, report })).state;
    const result = await f.service.requestH1({ expectedVersion: state.version });
    assert.equal(result.code, 'REQUIREMENTS_BLOCKED');
    assert.equal((await f.store.load()).state.phase, 'H1_PENDING');
  }
});

test('actual default approval remains unavailable and never freezes requirements', async () => {
  const f = fixture({ input: true });
  const state = await reviewed(f);
  const result = await f.service.requestH1({ expectedVersion: state.version });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'APPROVAL_CHANNEL_UNAVAILABLE');
  assert.equal((await f.store.load()).state.phase, 'H1_PENDING');
});

test('critique writes a reviewable requirements document before any approval and unified entry can request H1', async () => {
  let approvals = 0;
  const f = fixture({
    input: true,
    native: true,
    nativeRequest: async () => {
      approvals++;
      return { action: 'accept', content: { decision: 'approve', comment: '已查看需求文档' } };
    },
  });
  const state = await reviewed(f);
  assert.equal(state.phase, 'H1_PENDING');
  assert.equal(approvals, 0);
  const document = state.context.changeAdd.document;
  assert.ok(document?.path);
  const markdown = fs.readFileSync(path.join(f.root, document.path), 'utf8');
  assert.ok(markdown.includes(state.context.changeAdd.request.text));
  assert.doesNotMatch(markdown, /\[object Object\]/);
  assert.match(markdown, /REQ-1/);
  assert.match(markdown, /AC-1/);
  assert.match(markdown, /用户澄清记录/);
  assert.match(markdown, /反向复述与批判分析/);
  const approved = await f.service.startTyped({
    expectedVersion: state.version,
    action: 'request_h1',
  });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal(approved.state.phase, 'REQ_FROZEN');
  assert.equal(approvals, 1);
});

test('H1 opens immediately for an existing pending change without a review document', async () => {
  let approvals = 0;
  const f = fixture({
    input: true,
    native: true,
    nativeRequest: async () => {
      approvals++;
      return { action: 'accept', content: { decision: '批准' } };
    },
  });
  const state = await reviewed(f);
  const data = structuredClone(state.context.changeAdd);
  data.document = null;
  const saved = await f.store.update({
    expectedVersion: state.version,
    patch: { context: { changeAdd: data } },
  });
  assert.equal(saved.ok, true);
  const result = await f.service.requestH1({ expectedVersion: saved.state.version });
  assert.equal(result.state?.phase, 'REQ_FROZEN', JSON.stringify(result));
  assert.equal(result.code, 'H1_APPROVED');
  assert.match(result.message, /批准/);
  assert.equal(approvals, 1);
});

test('H1 form contains a bounded change summary rather than the full requirements document', async () => {
  let form;
  const f = fixture({
    input: true,
    native: true,
    nativeRequest: async (_method, params) => {
      form = params;
      return { action: 'accept', content: { decision: '批准' } };
    },
  });
  const state = await reviewed(f);
  const result = await f.service.requestH1({ expectedVersion: state.version });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(form.message, /变更目标/);
  assert.match(form.message, /涉及功能/);
  assert.match(form.message, /\[打开完整文档\]\(file:\/\/\//);
  assert.ok(form.message.includes(requirements[0].text));
  assert.ok(form.message.length < 1200);
  assert.ok(form.message.split('\n').length <= 12);
  assert.doesNotMatch(form.message, /用户澄清记录|反向复述与批判分析|请求编号|sha256:/);
  assert.deepEqual(form.requestedSchema, {
    type: 'object',
    properties: {},
    additionalProperties: false,
  });
});

test('closing H1 keeps the change pending and rejecting it returns to clarification', async () => {
  for (const [action, code, phase] of [
    ['cancel', 'APPROVAL_DISMISSED', 'H1_PENDING'],
    ['decline', 'APPROVAL_MODIFY_REQUESTED', 'REQ_CLARIFYING'],
  ]) {
    const f = fixture({
      input: true,
      native: true,
      nativeRequest: async () => ({ action, content: {} }),
    });
    const state = await reviewed(f);
    const result = await f.service.requestH1({ expectedVersion: state.version });
    assert.equal(result.code, code);
    assert.equal(result.state?.phase, phase);
    assert.equal(result.actualVersion, (await f.store.inspect()).state.version);
  }
});

test('H1 upgrades an untouched old renderer document and preserves edited legacy documents', async () => {
  for (const edited of [false, true]) {
    let approvals = 0;
    const f = fixture({
      input: true,
      native: true,
      nativeRequest: async () => {
        approvals++;
        return { action: 'accept', content: { decision: '批准' } };
      },
    });
    const state = await reviewed(f);
    const data = structuredClone(state.context.changeAdd);
    const document = data.document;
    const legacyPath = document.path.replace('-review-v2.md', '.md');
    const markdown = fs
      .readFileSync(path.join(f.root, document.path), 'utf8')
      .replace('## 用户原始需求\n' + data.request.text, '## 用户原始需求\n[object Object]');
    const legacyHash = 'sha256:' + createHash('sha256').update(markdown).digest('hex');
    fs.writeFileSync(path.join(f.root, legacyPath), markdown + (edited ? '\n用户修改' : ''));
    data.document = { ...document, path: legacyPath, hash: legacyHash };
    delete data.document.rendererVersion;
    const saved = await f.store.update({
      expectedVersion: state.version,
      patch: {
        context: {
          changeAdd: data,
          artifacts: {
            requirements: {
              ...state.context.artifacts.requirements,
              documentPath: legacyPath,
              documentHash: legacyHash,
            },
          },
        },
      },
    });
    assert.equal(saved.ok, true);
    const result = await f.service.requestH1({ expectedVersion: saved.state.version });
    assert.equal(approvals, edited ? 0 : 1);
    if (edited) assert.equal(result.code, 'REQUIREMENTS_CHANGED');
    else {
      assert.equal(result.state.phase, 'REQ_FROZEN', JSON.stringify(result));
      assert.doesNotMatch(
        fs.readFileSync(path.join(f.root, result.state.context.changeAdd.document.path), 'utf8'),
        /\[object Object\]/,
      );
    }
    assert.equal(
      fs.readFileSync(path.join(f.root, legacyPath), 'utf8'),
      markdown + (edited ? '\n用户修改' : ''),
    );
  }
});

test('editing a review document prevents approval until a new proposal and critique are written', async () => {
  let approvals = 0;
  const f = fixture({
    input: true,
    native: true,
    nativeRequest: async () => {
      approvals++;
      return { action: 'accept', content: { decision: 'approve', comment: '' } };
    },
  });
  let state = await reviewed(f);
  const oldDocument = state.context.changeAdd.document;
  assert.ok(oldDocument?.path);
  fs.appendFileSync(path.join(f.root, oldDocument.path), '\n用户修改：增加分页。\n');
  assert.equal(
    (await f.service.requestH1({ expectedVersion: state.version })).code,
    'REQUIREMENTS_CHANGED',
  );
  assert.equal(approvals, 0);
  state = await draft(f, {
    requirements: [{ ...requirements[0], text: 'Return searchable tasks with pagination.' }],
  });
  assert.equal(state.context.changeAdd.document, null);
  const reviewedAgain = await f.service.critique({
    expectedVersion: state.version,
    report: critique,
  });
  assert.equal(reviewedAgain.code, 'H1_DOCUMENT_READY');
  assert.notEqual(reviewedAgain.document.path, oldDocument.path);
  assert.match(
    fs.readFileSync(path.join(f.root, reviewedAgain.document.path), 'utf8'),
    /pagination/,
  );
  const approved = await f.service.requestH1({ expectedVersion: reviewedAgain.state.version });
  assert.equal(approved.state.phase, 'REQ_FROZEN');
  assert.equal(approvals, 1);
});

test('simulated native H1 approval creates a versioned immutable snapshot bound to the approval hash', async () => {
  const f = fixture({ input: true, native: true });
  const state = await reviewed(f);
  const result = await f.service.requestH1({ expectedVersion: state.version });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.phase, 'REQ_FROZEN');
  assert.equal(
    result.event.payload.approval.artifactHash,
    result.state.context.artifacts.requirements.hash,
  );
  const frozen = result.state.context.changeAdd.frozen;
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.root, frozen.path), 'utf8')).requirements[0].id,
    'REQ-1',
  );
  assert.equal(
    (
      await f.service.propose({
        expectedVersion: result.state.version,
        requirements,
        assumptions: [],
        openIssues: [],
      })
    ).code,
    'INVALID_TRANSITION',
  );
});

test('revised requirements invalidate the old candidate and require a fresh critique', async () => {
  const f = fixture({ input: true, native: true });
  const reviewedState = await reviewed(f);
  const oldHash = reviewedState.context.artifacts.requirements.hash;
  const revised = await draft(f, {
    requirements: [{ ...requirements[0], text: 'Return searchable tasks with pagination.' }],
  });
  assert.equal(revised.phase, 'REQ_CLARIFYING');
  assert.equal(revised.context.artifacts.requirements, null);
  assert.equal(
    (await f.service.requestH1({ expectedVersion: revised.version })).code,
    'INVALID_TRANSITION',
  );
  const rechecked = await f.service.critique({
    expectedVersion: revised.version,
    report: critique,
  });
  assert.notEqual(rechecked.state.context.artifacts.requirements.hash, oldHash);
});

test('CAS conflicts, invalid schema and apparent secrets refuse modification', async () => {
  const f = fixture({ input: true });
  const state = await start(f);
  assert.equal(
    (await f.service.propose({ expectedVersion: 0, requirements, assumptions: [], openIssues: [] }))
      .code,
    'VERSION_CONFLICT',
  );
  assert.equal(
    (
      await f.service.propose({
        expectedVersion: state.version,
        requirements: [],
        assumptions: [],
        openIssues: [],
      })
    ).code,
    'REQUIREMENTS_INVALID',
  );
  const secret = await f.service.propose({
    expectedVersion: state.version,
    requirements: [{ ...requirements[0], text: 'password=super-secret-value' }],
    assumptions: [],
    openIssues: [],
  });
  assert.equal(secret.code, 'SENSITIVE_INPUT');
  assert.doesNotMatch(JSON.stringify(await f.store.load()), /super-secret-value/);
});

test('native modify and cancel decisions control H1 without freezing a snapshot', async () => {
  for (const decision of ['modify', 'cancel']) {
    const f = fixture({ input: true, native: true, decision });
    const state = await reviewed(f);
    const result = await f.service.requestH1({ expectedVersion: state.version });
    assert.equal(result.ok, false);
    assert.equal(result.state.phase, decision === 'modify' ? 'REQ_CLARIFYING' : 'CANCELLED');
    assert.equal(result.state.context.changeAdd.frozen, null);
  }
});

test('a failed automatic clarification resumes the same round without accepting tool answers', async () => {
  const f = fixture();
  let calls = 0;
  f.service = createChangeAddService({
    ...f.options,
    userInputProvider: {
      trustedUserIdentity: nativeUser,
      request: async ({ questions }) => {
        if (calls++ === 0) throw new Error('Synthetic disconnect');
        return {
          answers: questions.map((q) => ({ questionId: q.id, answer: 'Resumed native answer.' })),
        };
      },
    },
  });
  const pending = await pendingIntake(f, 'USER_INPUT_FAILED');
  const before = (await f.store.load()).state;
  const refused = await f.service.propose({
    expectedVersion: pending.version,
    requirements,
    assumptions: [],
    openIssues: [],
  });
  assert.equal(refused.code, 'CLARIFICATION_REQUIRED');
  assert.equal(refused.status, 'WAITING_FOR_USER');
  assert.equal(refused.nextAction, 'RESUME_CLARIFICATION');
  const unchanged = (await f.store.load()).state;
  assert.equal(unchanged.version, before.version);
  assert.equal(unchanged.context.changeAdd.revisions.length, 0);
  const questions = [{ id: 'Q-1', category: 'functional', text: 'Which fields?' }];
  assert.equal(
    (await f.service.askQuestions({ expectedVersion: pending.version, questions })).code,
    'CLARIFICATION_PENDING',
  );
  const resumed = await f.service.askQuestions({ expectedVersion: pending.version, round: 1 });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.state.context.changeAdd.rounds.length, 1);
  assert.equal(resumed.state.context.changeAdd.rounds[0].status, 'answered');
});

test('the final snapshot is rehashed during gate consumption and tampering refuses freeze', async () => {
  const f = fixture({ input: true, native: true });
  const original = f.store;
  f.service = createChangeAddService({
    ...f.options,
    store: {
      ...original,
      update: async (args) => {
        const result = await original.update(args);
        const frozen = args.patch?.context?.changeAdd?.frozen;
        if (result.ok && frozen) {
          const target = path.join(f.root, frozen.path);
          const body = JSON.parse(fs.readFileSync(target, 'utf8'));
          body.requirements[0].text = 'Tampered snapshot';
          fs.writeFileSync(target, JSON.stringify(body));
        }
        return result;
      },
    },
  });
  const state = await reviewed(f);
  const result = await f.service.requestH1({ expectedVersion: state.version });
  assert.equal(result.code, 'APPROVAL_ARTIFACT_CHANGED');
  assert.equal((await f.store.load()).state.phase, 'H1_PENDING');
});

test('source repository guard is read-only and refuses to create an active product change', async () => {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const service = createChangeAddService({
    projectRoot,
    store: createStateStore({ projectRoot }),
    verifyPrerequisites: async () => ({ ok: true }),
  });
  assert.equal((await service.inspectPrerequisites()).code, 'SOURCE_REPOSITORY_FORBIDDEN');
});

test('explicit assumptions are required for nonblocking unresolved issues', async () => {
  const f = fixture({ input: true });
  const state = await start(f);
  const args = {
    expectedVersion: state.version,
    requirements,
    assumptions: [],
    openIssues: [{ id: 'ISSUE-1', text: 'Page size needs confirmation.', blocking: false }],
  };
  assert.equal((await f.service.propose(args)).code, 'REQUIREMENTS_INVALID');
  const result = await f.service.propose({
    ...args,
    assumptions: [
      {
        id: 'ASM-1',
        text: 'Use 20 rows per page.',
        risk: 'Users may prefer a different default.',
        pendingConfirmation: true,
      },
    ],
    openIssues: [{ ...args.openIssues[0], assumptionId: 'ASM-1' }],
  });
  assert.equal(result.ok, true);
});

test('concurrent intake creates one active change without queueing another', async () => {
  const f = fixture({ input: true });
  const results = await Promise.all([
    f.service.start({ expectedVersion: 0, request: 'First candidate.' }),
    f.service.start({ expectedVersion: 0, request: 'Second candidate.' }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.ok(
    ['VERSION_CONFLICT', 'ACTIVE_CHANGE'].includes(results.find((result) => !result.ok).code),
  );
});

test('tampered immutable candidates fail closed instead of overwriting a revision', async () => {
  const f = fixture({ input: true, native: true });
  const state = await reviewed(f);
  const directory = path.join(f.root, '.specgate/codex/changes', state.changeId, 'requirements');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(
    directory,
    'candidate-' + state.context.artifacts.requirements.hash.replace(/^sha256:/, '') + '.json',
  );
  fs.writeFileSync(target, '{"untrusted":"existing content"}\n');
  assert.equal(
    (await f.service.requestH1({ expectedVersion: state.version })).code,
    'REQUIREMENTS_CHANGED',
  );
  assert.equal(fs.readFileSync(target, 'utf8'), '{"untrusted":"existing content"}\n');
  assert.equal((await f.store.load()).state.phase, 'H1_PENDING');
});

test('native answers containing apparent credentials are never persisted', async () => {
  const f = fixture();
  let calls = 0;
  f.service = createChangeAddService({
    ...f.options,
    userInputProvider: {
      trustedUserIdentity: nativeUser,
      request: async ({ questions }) => ({
        answers: questions.map((question, index) => ({
          questionId: question.id,
          answer:
            calls++ === 0
              ? 'Synthetic intake answer.'
              : index === 0
                ? 'password=top-secret-native-value'
                : 'Synthetic answer.',
        })),
      }),
    },
  });
  await start(f);
  const state = await draft(f);
  const result = await f.service.askQuestions({
    expectedVersion: state.version,
    questions: [{ id: 'Q-1', category: 'security', text: 'How are credentials configured?' }],
  });
  assert.equal(result.code, 'SENSITIVE_INPUT');
  assert.doesNotMatch(JSON.stringify(await f.store.load()), /top-secret-native-value/);
});

test('null schema entries return structured refusals instead of throwing', async () => {
  const f = fixture({ input: true });
  const intake = await start(f);
  assert.equal(
    (
      await f.service.propose({
        expectedVersion: intake.version,
        requirements,
        assumptions: [],
        openIssues: [null],
      })
    ).code,
    'REQUIREMENTS_INVALID',
  );
  const state = await draft(f);
  assert.equal(
    (await f.service.askQuestions({ expectedVersion: state.version, questions: [null] })).code,
    'INVALID_ARGUMENT',
  );
  assert.equal(
    (
      await f.service.critique({
        expectedVersion: state.version,
        report: { ...critique, ambiguities: [null] },
      })
    ).code,
    'CRITIQUE_INVALID',
  );
});

test('aborting native clarification retains the pending round and discards late provider answers', async () => {
  const f = fixture();
  let release;
  let started;
  let calls = 0;
  const entered = new Promise((resolve) => (started = resolve));
  const controller = new AbortController();
  f.service = createChangeAddService({
    ...f.options,
    userInputProvider: {
      trustedUserIdentity: nativeUser,
      request: async ({ questions }, { signal }) => {
        if (calls++ === 0)
          return {
            answers: questions.map((q) => ({
              questionId: q.id,
              answer: 'Synthetic automatic intake answer.',
            })),
          };
        assert.equal(signal, controller.signal);
        started();
        return new Promise((resolve) => (release = resolve)); // Deliberately ignores abort.
      },
    },
  });
  await start(f);
  const state = await draft(f);
  const pending = f.service.askQuestions(
    {
      expectedVersion: state.version,
      questions: [{ id: 'Q-1', category: 'functional', text: 'Which task fields?' }],
    },
    { signal: controller.signal },
  );
  await entered;
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.code, 'CANCELLED');
  const checkpoint = (await f.store.load()).state;
  assert.equal(cancelled.actualVersion, checkpoint.version);
  assert.equal(checkpoint.context.changeAdd.rounds.length, 2);
  assert.equal(checkpoint.context.changeAdd.rounds[1].status, 'pending');
  const stopped = await f.store.cancel({
    expectedVersion: checkpoint.version,
    reason: 'Synthetic cancellation',
  });
  assert.equal(stopped.ok, true);
  release({ answers: [{ questionId: 'Q-1', answer: 'A late answer must never be recorded.' }] });
  await new Promise(setImmediate);
  const after = (await f.store.load()).state;
  assert.equal(after.version, stopped.state.version);
  assert.equal(after.phase, 'CANCELLED');
  assert.deepEqual(after.context.changeAdd.rounds[1].answers, []);
});

test('aborting H1 terminates an unresponsive native peer and cannot apply a late approval', async () => {
  let release;
  let started;
  const entered = new Promise((resolve) => (started = resolve));
  const f = fixture({
    input: true,
    native: true,
    nativeRequest: async (_method, _params, { signal }) => {
      assert.ok(signal instanceof AbortSignal);
      started();
      return new Promise((resolve) => (release = resolve)); // Deliberately ignores abort.
    },
  });
  const state = await reviewed(f);
  const controller = new AbortController();
  const pending = f.service.requestH1(
    { expectedVersion: state.version },
    { signal: controller.signal },
  );
  await entered;
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.code, 'APPROVAL_CANCELLED');
  const checkpoint = (await f.store.load()).state;
  assert.equal(cancelled.actualVersion, checkpoint.version);
  assert.equal(checkpoint.phase, 'H1_PENDING');
  assert.equal(checkpoint.context.changeAdd.frozen, null);
  const stopped = await f.store.cancel({
    expectedVersion: checkpoint.version,
    reason: 'Synthetic cancellation',
  });
  assert.equal(stopped.ok, true);
  release({ action: 'accept', content: { decision: 'approve', comment: 'Late and invalid.' } });
  await new Promise(setImmediate);
  const after = (await f.store.load()).state;
  assert.equal(after.version, stopped.state.version);
  assert.equal(after.phase, 'CANCELLED');
  assert.equal(after.context.changeAdd.frozen, null);
});

test('an already aborted server context creates no clarification round or H1 artifact', async () => {
  const f = fixture({ input: true, native: true });
  await start(f);
  const draftState = await draft(f);
  const controller = new AbortController();
  controller.abort();
  const questions = await f.service.askQuestions(
    {
      expectedVersion: draftState.version,
      questions: [{ id: 'Q-1', category: 'functional', text: 'Which fields?' }],
    },
    { signal: controller.signal },
  );
  assert.equal(questions.code, 'CANCELLED');
  assert.equal((await f.store.load()).state.version, draftState.version);
  const reviewedState = (
    await f.service.critique({ expectedVersion: draftState.version, report: critique })
  ).state;
  const h1 = await f.service.requestH1(
    { expectedVersion: reviewedState.version },
    { signal: controller.signal },
  );
  assert.equal(h1.code, 'CANCELLED');
  assert.equal((await f.store.load()).state.version, reviewedState.version);
  // Critique already prepared the review document; aborting H1 adds no files.
  assert.equal(reviewedState.context.changeAdd.frozen, null);
  assert.ok(fs.existsSync(path.join(f.root, reviewedState.context.changeAdd.document.path)));
});

test('a parent change without impact still validates the parent before requiring impact', async () => {
  const f = incrementalFixture();
  // The library requires affected AC ids, so a parent change with no impact is refused.
  const missingImpact = await f.service.startTyped({
    expectedVersion: 0,
    request: 'Customer feedback without an impact list.',
    type: 'feature',
    parentDeliveryId: f.deliveryId,
  });
  assert.equal(missingImpact.code, 'INCREMENT_AC_INVALID', JSON.stringify(missingImpact));
  // Parent validation still runs first: a cross-project parent is rejected by the intake.
  const foreignParent = await f.service.startTyped({
    expectedVersion: 0,
    request: 'Feedback against another project delivery.',
    type: 'feature',
    parentDeliveryId: 'delivery-foreign-1',
  });
  assert.equal(foreignParent.code, 'PARENT_DELIVERY_PROJECT_MISMATCH');
  // Neither refusal wrote any state.
  assert.equal((await f.store.load()).state.version, 0);
  assert.equal((await f.store.load()).state.changeId, null);
});

test('a parent change with a valid impact persists an auditable incremental plan', async () => {
  const f = incrementalFixture();
  const result = await f.service.startTyped({
    expectedVersion: 0,
    request: 'Customer feedback on the accepted delivery.',
    type: 'feature',
    parentDeliveryId: f.deliveryId,
    impact: { affectedAcIds: ['AC-2'], reusedAcIds: ['AC-2'] },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.context.changeAdd.rounds[0].source, 'server-intake');
  assert.equal(result.state.context.changeAdd.rounds[0].status, 'answered');
  const incremental = result.state.context.changeAdd.incremental;
  assert.ok(incremental, 'the change state exposes an incremental plan');
  assert.match(incremental.hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(incremental.hash, 'sha256:' + hashValue(incremental.plan));
  assert.equal(incremental.plan.parentDeliveryId, f.deliveryId);
  assert.equal(incremental.plan.changeId, result.state.changeId);
  assert.deepEqual(incremental.plan.affectedAcIds, ['AC-2']);
  assert.deepEqual(incremental.plan.reusedAcIds, ['AC-2']);
  assert.match(incremental.plan.baselineCommit, /^[a-f0-9]{40,64}$/);
  const stored = JSON.parse(fs.readFileSync(path.join(f.root, incremental.path), 'utf8'));
  assert.deepEqual(stored, incremental.plan);
  assert.equal(result.state.context.changeAdd.change.parentDeliveryId, f.deliveryId);
});

test('unknown acceptance criteria and inconsistent reuse are rejected with the library codes', async () => {
  const f = incrementalFixture();
  const unknown = await f.service.startTyped({
    expectedVersion: 0,
    request: 'Feedback referencing an unknown criterion.',
    type: 'feature',
    parentDeliveryId: f.deliveryId,
    impact: { affectedAcIds: ['AC-404'], reusedAcIds: [] },
  });
  assert.equal(unknown.code, 'INCREMENT_AC_UNKNOWN', JSON.stringify(unknown));
  const inconsistent = await f.service.startTyped({
    expectedVersion: 0,
    request: 'Feedback reusing an unaffected criterion.',
    type: 'feature',
    parentDeliveryId: f.deliveryId,
    impact: { affectedAcIds: ['AC-2'], reusedAcIds: ['AC-1'] },
  });
  assert.equal(inconsistent.code, 'INCREMENT_AC_INCONSISTENT', JSON.stringify(inconsistent));
  assert.equal((await f.store.load()).state.version, 0);
});

test('impact is strictly validated and cannot be smuggled to the sg_change_add alias', async () => {
  const f = incrementalFixture();
  const unknownField = await f.service.startTyped({
    expectedVersion: 0,
    request: 'Feedback with a stray impact field.',
    type: 'feature',
    parentDeliveryId: f.deliveryId,
    impact: { affectedAcIds: ['AC-2'], reusedAcIds: [], invalidatedTestIds: ['CASE-1'] },
  });
  assert.equal(unknownField.code, 'INVALID_ARGUMENT');
  const aliasImpact = await f.service.start({
    expectedVersion: 0,
    request: 'Feedback via the feature alias.',
    impact: { affectedAcIds: ['AC-2'] },
  });
  assert.equal(aliasImpact.code, 'INVALID_ARGUMENT');
  assert.equal((await f.store.load()).state.version, 0);
  const accepted = await f.service.startTyped({
    expectedVersion: 0,
    request: 'Feedback with a well-formed impact.',
    type: 'feature',
    parentDeliveryId: f.deliveryId,
    impact: { affectedAcIds: ['AC-2'] },
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.ok(accepted.state.context.changeAdd.incremental);
  // reusedAcIds is optional and defaults to an empty list.
  assert.deepEqual(accepted.state.context.changeAdd.incremental.plan.reusedAcIds, []);
});

test('a change without a parent is unaffected and carries no incremental plan', async () => {
  const f = incrementalFixture();
  const result = await f.service.startTyped({
    expectedVersion: 0,
    request: 'A brand new feature with no parent delivery.',
    type: 'feature',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.context.changeAdd.incremental, null);
  assert.equal(result.state.context.changeAdd.change.parentDeliveryId, null);

  // A separate project shows a stray impact without a parent stays inert.
  const g = incrementalFixture();
  const stray = await g.service.startTyped({
    expectedVersion: 0,
    request: 'A brand new feature that passes a stray impact.',
    type: 'feature',
    impact: { affectedAcIds: ['AC-2'] },
  });
  assert.equal(stray.ok, true, JSON.stringify(stray));
  assert.equal(stray.state.context.changeAdd.incremental, null);
});
