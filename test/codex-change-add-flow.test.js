import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createChangeAddService, stableChangeName } from '../src/codex/change-add.js';
import { createStateStore } from '../src/codex/state-machine.js';
import { createApprovalAuthority } from '../src/codex/approvals.js';
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

async function start(f) {
  const result = await f.service.start({
    request: 'Add a searchable task list.',
    expectedVersion: 0,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
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
  const f = fixture();
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
  const f = fixture();
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
  for (let index = 0; index < 3; index++) {
    state = (await f.store.load()).state;
    const result = await f.service.askQuestions({ expectedVersion: state.version, questions });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(
      result.state.context.changeAdd.rounds[index].answers[0].source,
      'native-user-provider',
    );
    assert.deepEqual(result.state.context.changeAdd.rounds[index].answers[0].actor, nativeUser);
  }
  state = (await f.store.load()).state;
  assert.equal(
    (await f.service.askQuestions({ expectedVersion: state.version, questions })).code,
    'QUESTION_LIMIT',
  );
});

test('without a trusted input source, plain tool answers and client identities are refused', async () => {
  const f = fixture();
  await start(f);
  const state = await draft(f);
  const questions = [{ id: 'Q-1', category: 'functional', text: 'Which task fields?' }];
  assert.equal(
    (await f.service.askQuestions({ expectedVersion: state.version, questions })).code,
    'TRUSTED_USER_INPUT_UNAVAILABLE',
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
  assert.equal((await f.store.load()).state.context.changeAdd.rounds.length, 0);
});

test('critique requires structured categories and valid requirement references', async () => {
  const f = fixture();
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

test('blocking issues or critique findings cannot freeze at H1', async () => {
  for (const mode of ['issue', 'critique']) {
    const f = fixture({ native: true });
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
  const f = fixture();
  const state = await reviewed(f);
  const result = await f.service.requestH1({ expectedVersion: state.version });
  assert.equal(result.ok, false);
  assert.equal((await f.store.load()).state.phase, 'H1_PENDING');
});

test('simulated native H1 approval creates a versioned immutable snapshot bound to the approval hash', async () => {
  const f = fixture({ native: true });
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
  const f = fixture({ native: true });
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
  const f = fixture();
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
    const f = fixture({ native: true, decision });
    const state = await reviewed(f);
    const result = await f.service.requestH1({ expectedVersion: state.version });
    assert.equal(result.ok, false);
    assert.equal(result.state.phase, decision === 'modify' ? 'REQ_CLARIFYING' : 'CANCELLED');
    assert.equal(result.state.context.changeAdd.frozen, null);
  }
});

test('a failed clarification resumes the same round without accepting tool-supplied answers', async () => {
  const f = fixture({ input: true });
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
  await start(f);
  const state = await draft(f);
  const questions = [{ id: 'Q-1', category: 'functional', text: 'Which fields?' }];
  assert.equal(
    (await f.service.askQuestions({ expectedVersion: state.version, questions })).code,
    'USER_INPUT_FAILED',
  );
  const pending = (await f.store.load()).state;
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
  const f = fixture({ native: true });
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
  const f = fixture();
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
  const f = fixture();
  const results = await Promise.all([
    f.service.start({ expectedVersion: 0, request: 'First candidate.' }),
    f.service.start({ expectedVersion: 0, request: 'Second candidate.' }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.ok(
    ['VERSION_CONFLICT', 'ACTIVE_CHANGE'].includes(results.find((result) => !result.ok).code),
  );
});

test('preexisting immutable artifact conflicts fail closed instead of overwriting a revision', async () => {
  const f = fixture({ native: true });
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
    'SNAPSHOT_CONFLICT',
  );
  assert.equal(fs.readFileSync(target, 'utf8'), '{"untrusted":"existing content"}\n');
  assert.equal((await f.store.load()).state.phase, 'H1_PENDING');
});

test('native answers containing apparent credentials are never persisted', async () => {
  const f = fixture();
  f.service = createChangeAddService({
    ...f.options,
    userInputProvider: {
      trustedUserIdentity: nativeUser,
      request: async () => ({
        answers: [{ questionId: 'Q-1', answer: 'password=top-secret-native-value' }],
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
  const entered = new Promise((resolve) => (started = resolve));
  const controller = new AbortController();
  f.service = createChangeAddService({
    ...f.options,
    userInputProvider: {
      trustedUserIdentity: nativeUser,
      request: async (_input, { signal }) => {
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
  assert.equal(checkpoint.context.changeAdd.rounds[0].status, 'pending');
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
  assert.deepEqual(after.context.changeAdd.rounds[0].answers, []);
});

test('aborting H1 terminates an unresponsive native peer and cannot apply a late approval', async () => {
  let release;
  let started;
  const entered = new Promise((resolve) => (started = resolve));
  const f = fixture({
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
  assert.equal(fs.existsSync(path.join(f.root, '.specgate/codex/changes')), false);
});
