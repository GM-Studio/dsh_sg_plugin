import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createApprovalAuthority } from '../src/codex/approvals.js';
import { createDevelopmentService } from '../src/codex/development.js';
import { canonicalJson, hashValue } from '../src/codex/events.js';
import { executeInit, previewInit } from '../src/codex/init.js';
import { createPlanService } from '../src/codex/plan.js';
import { createQualityService } from '../src/codex/quality.js';
import { createReleaseService } from '../src/codex/release.js';
import { createReviewService } from '../src/codex/review.js';
import { createStateStore } from '../src/codex/state-machine.js';
import { verifyProject } from '../src/codex/verify.js';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--') || index + 1 >= argv.length)
      throw new Error('Arguments must be --name value pairs');
    result[argv[index].slice(2)] = argv[++index];
  }
  return result;
}

function required(args, name) {
  if (typeof args[name] !== 'string' || !args[name]) throw new Error(`Missing required --${name}`);
  return path.resolve(args[name]);
}

const writeJson = (target, value) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
};

const readJson = (target) => JSON.parse(fs.readFileSync(target, 'utf8'));

function context(args) {
  return {
    root: required(args, 'root'),
    control: required(args, 'control'),
  };
}

async function setup(args) {
  const { root, control } = context(args);
  if (fs.existsSync(root)) throw new Error(`Acceptance root already exists: ${root}`);
  fs.mkdirSync(control, { recursive: true });
  const preview = previewInit({ root, preset: 'jdk8-boot2.7' });
  if (!preview.ok) throw new Error(JSON.stringify(preview));
  const initialized = await executeInit({
    root,
    preset: preview.preset,
    previewHash: preview.previewHash,
  });
  if (!initialized.ok) throw new Error(JSON.stringify(initialized));
  const baseline = await verifyProject({ root });
  if (!baseline.ok)
    throw new Error(`Generated baseline verification failed: ${JSON.stringify(baseline)}`);

  const changeId = 'priority-e2e';
  const requirementsPath = `.specgate/codex/changes/${changeId}/requirements/revision-1.json`;
  const requirements = {
    schemaVersion: 1,
    changeId,
    revision: 1,
    requirements: [
      {
        id: 'REQ-1',
        category: 'functional',
        text: 'Tasks expose a priority from 0 through 5 and default to zero.',
        acceptanceCriteria: [
          {
            id: 'AC-1',
            text: 'POST /api/tasks persists priority, rejects values outside 0-5, and GET returns the stored priority.',
          },
          {
            id: 'AC-2',
            text: 'The Vue task form submits priority and the task list displays the returned priority.',
          },
        ],
      },
    ],
    fixture: 'real-native-agent-e2e',
  };
  fs.mkdirSync(path.dirname(path.join(root, requirementsPath)), { recursive: true });
  fs.writeFileSync(path.join(root, requirementsPath), canonicalJson(requirements) + '\n');
  const requirementsHash = 'sha256:' + hashValue(requirements);
  let store;
  const authority = createApprovalAuthority({
    request: async () => ({
      action: 'accept',
      content: {
        decision: 'approve',
        comment:
          'Synthetic prerequisite approval for the isolated P6/P7 native-agent acceptance fixture.',
      },
    }),
    trustedPeerIdentity: {
      id: 'acceptance-user',
      kind: 'user',
      source: 'synthetic-acceptance-prerequisite-not-native-h1',
    },
    audit: async (entry) => {
      const current = await store.inspect();
      const saved = await store.recordEvent({
        expectedVersion: current.state.version,
        type: entry.type,
        payload: entry,
      });
      if (!saved.ok) throw new Error(saved.code);
    },
  });
  store = createStateStore({ projectRoot: root, authorizeGate: authority.authorizeGate });
  await store.create({
    expectedVersion: 0,
    changeId,
    context: {
      artifacts: { requirements: { hash: requirementsHash, revision: 1 } },
      changeAdd: {
        frozen: {
          path: requirementsPath,
          hash: requirementsHash,
          revision: 1,
          authority: 'REQ_FROZEN-gate-transition',
        },
      },
    },
  });
  for (const to of ['REQ_CLARIFYING', 'REQ_CRITIQUE', 'H1_PENDING']) {
    const current = await store.inspect();
    const moved = await store.transition({ expectedVersion: current.state.version, to });
    if (!moved.ok) throw new Error(JSON.stringify(moved));
  }
  const approval = await authority.requestApproval({
    gate: 'H1',
    scope: changeId,
    artifactHash: requirementsHash,
    readArtifactHash: async () => requirementsHash,
    summary: 'Synthetic prerequisite requirements for P6/P7 native-agent acceptance.',
  });
  const frozen = await store.transition({
    expectedVersion: (await store.inspect()).state.version,
    to: 'REQ_FROZEN',
    approval: approval.approval,
  });
  if (!frozen.ok) throw new Error(JSON.stringify(frozen));
  const plans = createPlanService({ projectRoot: root, store });
  const generated = await plans.generate({
    expectedVersion: (await store.inspect()).state.version,
  });
  if (!generated.ok) throw new Error(JSON.stringify(generated));
  const contracts = await plans.freezeContracts({
    expectedVersion: (await store.inspect()).state.version,
    contract: {
      version: 1,
      content: {
        endpoints: [
          { method: 'GET', path: '/api/tasks', operation: 'query' },
          { method: 'POST', path: '/api/tasks', operation: 'create' },
          { method: 'POST', path: '/api/tasks/update', operation: 'update' },
        ],
        task: {
          priority: { type: 'integer', minimum: 0, maximum: 5, default: 0 },
        },
      },
    },
    model: {
      version: 1,
      content: {
        entities: [
          {
            name: 'Task',
            fields: {
              id: 'long',
              title: 'string',
              completed: 'boolean',
              priority: 'integer 0..5 default 0',
            },
          },
        ],
      },
    },
  });
  if (!contracts.ok) throw new Error(JSON.stringify(contracts));
  writeJson(path.join(control, 'context.json'), {
    root,
    control,
    changeId,
    requirementsPath,
    requirementsHash,
    phase: contracts.state.phase,
    stateVersion: contracts.state.version,
    baselineVerified: true,
    baselineRunId: baseline.report?.runId,
  });
  process.stdout.write(
    JSON.stringify({
      ok: true,
      phase: contracts.state.phase,
      root,
      baselineRunId: baseline.report?.runId,
    }) + '\n',
  );
}

async function freeze(args) {
  const { root, control } = context(args);
  const product = readJson(path.join(control, 'context.json'));
  if (product.root !== root) throw new Error('Acceptance root does not match context');
  const assets = readJson(path.join(control, 'test-assets.json'));
  const store = createStateStore({ projectRoot: root });
  const plans = createPlanService({
    projectRoot: root,
    store,
    roleProvider: async () => assets,
  });
  const current = await store.inspect();
  if (current.state.phase === 'TEST_DESIGN') {
    const tests = await plans.freezeTests({ expectedVersion: current.state.version });
    if (!tests.ok) throw new Error(JSON.stringify(tests));
  } else if (current.state.phase !== 'TEST_CASES_FROZEN') {
    throw new Error(`Cannot resume freeze from phase ${current.state.phase}`);
  }
  const qualified = await plans.inspect();
  if (!qualified.ok) throw new Error(JSON.stringify(qualified));
  const testsDirectory = qualified.ref.tests.directory;
  const runner = path.join(root, testsDirectory, 'runner.mjs');
  const redReport = '.specgate/runs/agent-e2e/red-report.json';
  const development = createDevelopmentService({
    projectRoot: root,
    store,
    planService: plans,
    redRunner: () => ({
      command: process.execPath,
      args: [
        runner,
        '--mode',
        'red',
        '--root',
        root,
        '--tests',
        path.dirname(runner),
        '--report',
        path.join(root, redReport),
      ],
      cwd: root,
      reportPath: redReport,
    }),
  });
  const prepared = await development.prepare({
    expectedVersion: (await store.inspect()).state.version,
  });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared));
  writeJson(path.join(control, 'development.json'), {
    phase: prepared.state.phase,
    stateVersion: prepared.state.version,
    testsDirectory,
    runner,
    development: prepared.development,
  });
  process.stdout.write(
    JSON.stringify({
      ok: true,
      phase: prepared.state.phase,
      worktrees: prepared.development.worktrees,
      redEvidence: prepared.development.red,
    }) + '\n',
  );
}

async function waitForResult(control, role) {
  const start = path.join(control, `start-${role}`);
  const result = path.join(control, `${role}-result.json`);
  fs.writeFileSync(start, new Date().toISOString() + '\n');
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    if (fs.existsSync(result)) return readJson(result);
    await delay(1000);
  }
  return {
    ok: false,
    code: 'AGENT_TIMEOUT',
    message: `${role} did not publish a result within 20 minutes`,
  };
}

async function develop(args) {
  const { root, control } = context(args);
  const store = createStateStore({ projectRoot: root });
  const plans = createPlanService({ projectRoot: root, store });
  const current = await store.inspect();
  const developmentContext = current.state.context.development;
  const git = (cwd, gitArgs) =>
    execFileSync('git', gitArgs, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'SpecGate Native Agent Handoff',
        GIT_AUTHOR_EMAIL: 'specgate-agent@localhost',
        GIT_COMMITTER_NAME: 'SpecGate Native Agent Handoff',
        GIT_COMMITTER_EMAIL: 'specgate-agent@localhost',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  const service = createDevelopmentService({
    projectRoot: root,
    store,
    planService: plans,
    roleProvider: async (role) => {
      const handoff = path.join(control, `handoff-${role}.json`);
      if (fs.existsSync(handoff)) {
        const transfer = readJson(handoff);
        const worktree = developmentContext.worktrees[role].path;
        const before = git(worktree, ['rev-parse', 'HEAD']);
        for (const relative of transfer.files) {
          const source = path.join(transfer.sourceRoot, relative);
          const destination = path.join(worktree, relative);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.copyFileSync(source, destination);
        }
        git(worktree, ['add', '-A']);
        git(worktree, [
          'commit',
          '-q',
          '-m',
          `apply native ${role} agent handoff ${transfer.sourceCommit}`,
        ]);
        const after = git(worktree, ['rev-parse', 'HEAD']);
        if (after === before) throw new Error(`${role} handoff created no commit`);
        return {
          ok: true,
          summary: `${role} handoff applied from native-agent commit ${transfer.sourceCommit}`,
        };
      }
      const patch = path.join(control, `handoff-${role}.patch`);
      if (fs.existsSync(patch)) {
        const worktree = developmentContext.worktrees[role].path;
        const before = git(worktree, ['rev-parse', 'HEAD']);
        git(worktree, ['apply', '--index', patch]);
        git(worktree, ['commit', '-q', '-m', `apply native ${role} agent handoff`]);
        const after = git(worktree, ['rev-parse', 'HEAD']);
        if (after === before) throw new Error(`${role} handoff created no commit`);
        return {
          ok: true,
          summary: `${role} handoff applied from verified native-agent commit`,
        };
      }
      const result = await waitForResult(control, role);
      return result.ok === true
        ? {
            ok: true,
            precompleted: true,
            summary: String(result.summary || `${role} completed`),
          }
        : result;
    },
  });
  const result = await service.run({
    expectedVersion: current.state.version,
  });
  writeJson(path.join(control, 'p6-result.json'), result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

async function quality(args) {
  const { root, control } = context(args);
  const store = createStateStore({ projectRoot: root });
  const plans = createPlanService({ projectRoot: root, store });
  const qualified = await plans.inspect();
  if (!qualified.ok) throw new Error(JSON.stringify(qualified));
  const runner = path.join(root, qualified.ref.tests.directory, 'runner.mjs');
  const service = createQualityService({
    projectRoot: root,
    store,
    planService: plans,
    testRunner: async ({ worktree }) => ({
      command: process.execPath,
      args: [
        runner,
        '--mode',
        'green',
        '--root',
        worktree,
        '--tests',
        path.dirname(runner),
        '--report',
        path.join(worktree, '.specgate/priority-report.json'),
      ],
      cwd: worktree,
      reportPath: '.specgate/priority-report.json',
    }),
  });
  const result = await service.run({
    expectedVersion: (await store.inspect()).state.version,
  });
  writeJson(path.join(control, 'p7-result.json'), result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

async function refreshTests(args) {
  const { root, control } = context(args);
  const store = createStateStore({ projectRoot: root });
  const plans = createPlanService({ projectRoot: root, store });
  const assets = readJson(path.join(control, 'test-assets.json'));
  const result = await plans.replaceTests({
    expectedVersion: (await store.inspect()).state.version,
    assets,
    reason:
      'Native Test Agent corrected Checkstyle-invalid JUnit method names without changing case behavior or assertions.',
  });
  writeJson(path.join(control, 'refresh-tests-result.json'), result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

async function status(args) {
  const { root, control } = context(args);
  const store = createStateStore({ projectRoot: root });
  const loaded = await store.inspect();
  const summary = { state: loaded, control };
  if (fs.existsSync(path.join(control, 'development.json')))
    summary.development = readJson(path.join(control, 'development.json'));
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

async function review(args) {
  const { root, control } = context(args);
  fs.mkdirSync(control, { recursive: true });
  const store = createStateStore({ projectRoot: root });
  const plans = createPlanService({ projectRoot: root, store });
  const service = createReviewService({
    projectRoot: root,
    store,
    planService: plans,
    roleProvider: async (role, challenge) => {
      const { signal: _signal, ...safe } = challenge;
      writeJson(path.join(control, 'review-challenge.json'), safe);
      fs.writeFileSync(path.join(control, 'start-review'), new Date().toISOString() + '\n');
      const result = path.join(control, 'review-result.json');
      const deadline = Date.now() + 15 * 60 * 1000;
      while (Date.now() < deadline) {
        if (fs.existsSync(result)) return readJson(result);
        await delay(1000);
      }
      return { error: 'Review Agent timed out' };
    },
  });
  const input = { expectedVersion: (await store.inspect()).state.version };
  if (args.mode) input.mode = args.mode;
  const result = await service.run(input);
  writeJson(path.join(control, 'p8-result.json'), result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

async function releasePreview(args) {
  const { root, control } = context(args);
  const store = createStateStore({ projectRoot: root });
  const plans = createPlanService({ projectRoot: root, store });
  const result = await createReleaseService({
    projectRoot: root,
    store,
    planService: plans,
  }).preview();
  writeJson(path.join(control, 'release-preview.json'), result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

const [command, ...rest] = process.argv.slice(2);
const commands = {
  setup,
  freeze,
  develop,
  quality,
  'refresh-tests': refreshTests,
  status,
  review,
  'release-preview': releasePreview,
};
if (!Object.hasOwn(commands, command)) {
  process.stderr.write(
    'Usage: node scripts/codex-real-agent-e2e.mjs <setup|freeze|develop|quality|refresh-tests|status|review|release-preview> --root <path> --control <path>\n',
  );
  process.exitCode = 2;
} else {
  await commands[command](parseArgs(rest));
}
