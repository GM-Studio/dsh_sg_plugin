import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
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

const argsFor = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined)
      throw new Error('Arguments must be --name value pairs');
    args[argv[index].slice(2)] = argv[index + 1];
  }
  return args;
};
const required = (args, key) => {
  if (!args[key]) throw new Error(`Missing --${key}`);
  return path.resolve(args[key]);
};
const context = (args) => ({
  root: required(args, 'root'),
  control: required(args, 'control'),
});
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

function authorities(root) {
  let store;
  let authority;
  store = createStateStore({
    projectRoot: root,
    authorizeGate: async (challenge) => authority.authorizeGate(challenge),
  });
  authority = createApprovalAuthority({
    request: async () => ({
      action: 'accept',
      content: {
        decision: 'approve',
        comment: 'Synthetic isolated customer E2E H3 approval.',
      },
    }),
    trustedPeerIdentity: {
      id: 'customer-fixture-user',
      kind: 'user',
      source: 'synthetic-customer-e2e-h3',
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
    resolveGateArtifact: ({ gate, state }) => ({
      scope: state?.changeId,
      artifactHash:
        gate === 'H1'
          ? state?.context?.artifacts?.requirements?.hash
          : state?.context?.artifacts?.h3?.hash,
    }),
  });
  return { store, authority };
}

async function setup(args) {
  const { root, control } = context(args);
  if (fs.existsSync(root)) throw new Error(`Target already exists: ${root}`);
  fs.mkdirSync(control, { recursive: true });
  const preview = previewInit({ root, preset: 'jdk8-boot2.7' });
  if (!preview.ok) throw new Error(JSON.stringify(preview));
  const initialized = await executeInit({ root, previewHash: preview.previewHash });
  if (!initialized.ok) throw new Error(JSON.stringify(initialized));
  const baseline = await verifyProject({ root });
  if (!baseline.ok) throw new Error(JSON.stringify(baseline));

  const changeId = 'customer-crm';
  const requirementsPath = `.specgate/codex/changes/${changeId}/requirements/revision-1.json`;
  const requirements = {
    schemaVersion: 1,
    changeId,
    revision: 1,
    requirements: [
      {
        id: 'REQ-1',
        category: 'functional',
        text: 'A small customer management system supports reliable customer lifecycle management.',
        acceptanceCriteria: [
          {
            id: 'AC-1',
            text: 'Customers can be created, queried, updated and deleted through JSON APIs with persistent fields.',
          },
          {
            id: 'AC-2',
            text: 'Name, email and status are validated; email is unique and status is ACTIVE or INACTIVE.',
          },
          {
            id: 'AC-3',
            text: 'A summary endpoint returns total, active and inactive customer counts.',
          },
          {
            id: 'AC-4',
            text: 'The Vue UI supports search, status filtering, create/edit/delete and displays summary counts.',
          },
        ],
      },
    ],
    fixture: 'customer-crm-native-agent-e2e',
  };
  fs.mkdirSync(path.dirname(path.join(root, requirementsPath)), { recursive: true });
  fs.writeFileSync(path.join(root, requirementsPath), canonicalJson(requirements) + '\n');
  const requirementsHash = 'sha256:' + hashValue(requirements);
  const { store, authority } = authorities(root);
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
  const h1 = await authority.requestApproval({
    gate: 'H1',
    scope: changeId,
    artifactHash: requirementsHash,
    readArtifactHash: async () => requirementsHash,
    summary: 'Synthetic isolated customer E2E requirements.',
  });
  const frozen = await store.transition({
    expectedVersion: (await store.inspect()).state.version,
    to: 'REQ_FROZEN',
    approval: h1.approval,
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
          { method: 'GET', path: '/api/customers', operation: 'query' },
          { method: 'GET', path: '/api/customers/{id}', operation: 'get' },
          { method: 'GET', path: '/api/customers/summary', operation: 'summary' },
          { method: 'POST', path: '/api/customers', operation: 'create' },
          { method: 'POST', path: '/api/customers/update', operation: 'update' },
          { method: 'POST', path: '/api/customers/delete', operation: 'delete' },
        ],
        customer: {
          name: 'string 1..100 required',
          email: 'string email required unique',
          company: 'string max 200',
          status: 'ACTIVE or INACTIVE',
          notes: 'string max 500',
        },
      },
    },
    model: {
      version: 1,
      content: {
        entities: [
          {
            name: 'Customer',
            fields: {
              id: 'long',
              name: 'string',
              email: 'string unique',
              company: 'string',
              status: 'ACTIVE|INACTIVE',
              notes: 'string',
            },
          },
        ],
      },
    },
  });
  if (!contracts.ok) throw new Error(JSON.stringify(contracts));
  writeJson(path.join(control, 'context.json'), {
    root,
    changeId,
    requirementsPath,
    baselineRunId: baseline.report?.runId,
    phase: contracts.state.phase,
  });
  process.stdout.write(
    JSON.stringify({
      ok: true,
      root,
      phase: contracts.state.phase,
      baselineRunId: baseline.report?.runId,
    }) + '\n',
  );
}

async function freeze(args) {
  const { root, control } = context(args);
  const assets = readJson(path.join(control, 'test-assets.json'));
  const { store } = authorities(root);
  const plans = createPlanService({
    projectRoot: root,
    store,
    roleProvider: async () => assets,
  });
  const current = await store.inspect();
  if (current.state.phase === 'TEST_DESIGN') {
    const frozen = await plans.freezeTests({ expectedVersion: current.state.version });
    if (!frozen.ok) throw new Error(JSON.stringify(frozen));
  }
  const checked = await plans.inspect();
  if (!checked.ok) throw new Error(JSON.stringify(checked));
  const runner = path.join(root, checked.ref.tests.directory, 'runner.mjs');
  const redReport = '.specgate/runs/customer-e2e/red-report.json';
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
  writeJson(path.join(control, 'development.json'), prepared.development);
  process.stdout.write(
    JSON.stringify({
      ok: true,
      phase: prepared.state.phase,
      testsDirectory: checked.ref.tests.directory,
      worktrees: prepared.development.worktrees,
    }) + '\n',
  );
}

async function waitResult(control, role) {
  fs.writeFileSync(path.join(control, `start-${role}`), new Date().toISOString() + '\n');
  const result = path.join(control, `${role}-result.json`);
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    if (fs.existsSync(result)) return readJson(result);
    await delay(1000);
  }
  return { ok: false, code: 'AGENT_TIMEOUT', message: `${role} timed out` };
}

async function develop(args) {
  const { root, control } = context(args);
  const { store } = authorities(root);
  const plans = createPlanService({ projectRoot: root, store });
  const service = createDevelopmentService({
    projectRoot: root,
    store,
    planService: plans,
    roleProvider: async (role) => waitResult(control, role),
  });
  const result = await service.run({
    expectedVersion: (await store.inspect()).state.version,
  });
  writeJson(path.join(control, 'p6-result.json'), result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

async function quality(args) {
  const { root, control } = context(args);
  const { store } = authorities(root);
  const plans = createPlanService({ projectRoot: root, store });
  const checked = await plans.inspect();
  if (!checked.ok) throw new Error(JSON.stringify(checked));
  const runner = path.join(root, checked.ref.tests.directory, 'runner.mjs');
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
        path.join(worktree, '.specgate/customer-report.json'),
      ],
      cwd: worktree,
      reportPath: '.specgate/customer-report.json',
    }),
  });
  const result = await service.run({
    expectedVersion: (await store.inspect()).state.version,
  });
  writeJson(path.join(control, 'p7-result.json'), result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

async function review(args) {
  const { root, control } = context(args);
  const { store } = authorities(root);
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
      return { error: 'Review timed out' };
    },
  });
  const result = await service.run({
    expectedVersion: (await store.inspect()).state.version,
  });
  writeJson(path.join(control, 'p8-result.json'), result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

async function h3(args) {
  const { root, control } = context(args);
  const { store, authority } = authorities(root);
  const plans = createPlanService({ projectRoot: root, store });
  const result = await createReviewService({
    projectRoot: root,
    store,
    planService: plans,
    approvalAuthority: authority,
  }).requestH3({ expectedVersion: (await store.inspect()).state.version });
  writeJson(path.join(control, 'h3-result.json'), result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

async function archive(args) {
  const { root, control } = context(args);
  const { store } = authorities(root);
  const plans = createPlanService({ projectRoot: root, store });
  const result = await createReleaseService({
    projectRoot: root,
    store,
    planService: plans,
  }).run({ expectedVersion: (await store.inspect()).state.version });
  writeJson(path.join(control, 'p9-result.json'), result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

async function refreshTests(args) {
  const { root, control } = context(args);
  const { store } = authorities(root);
  const plans = createPlanService({ projectRoot: root, store });
  const assets = readJson(path.join(control, 'test-assets.json'));
  const result = await plans.replaceTests({
    expectedVersion: (await store.inspect()).state.version,
    assets,
    reason:
      'Correct frozen customer tests: JSONPath numeric conversion and post-filter API assertion.',
  });
  writeJson(path.join(control, 'refresh-tests-result.json'), result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

const [command, ...rest] = process.argv.slice(2);
const commands = {
  setup,
  freeze,
  develop,
  quality,
  review,
  h3,
  archive,
  'refresh-tests': refreshTests,
};
if (!Object.hasOwn(commands, command)) {
  process.stderr.write(
    'Usage: node scripts/codex-customer-e2e.mjs <setup|freeze|develop|quality|review|h3|archive|refresh-tests> --root <path> --control <path>\n',
  );
  process.exitCode = 2;
} else {
  await commands[command](argsFor(rest));
}
