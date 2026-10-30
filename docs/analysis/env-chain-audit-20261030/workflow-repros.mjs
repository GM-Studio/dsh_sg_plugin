import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const sourceImport = (file) => import(pathToFileURL(path.join(root, 'src/codex', file)));
const { createNativeFormatter } = await sourceImport('format.js');
const { createReviewService } = await sourceImport('review.js');
const { createReleaseService } = await sourceImport('release.js');
const { createDevelopmentService } = await sourceImport('development.js');
const { createApprovalAuthority } = await sourceImport('approvals.js');
const { resolveProfile, policyFor, scenarioProfile } = await sourceImport(
  'core/validation-profile.js',
);

async function loadFixture(file, marker, exports) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const end = source.indexOf(marker);
  if (end < 0) throw new Error('Fixture marker not found');
  const prelude = source
    .slice(0, end)
    .replaceAll("'../src/", "'" + pathToFileURL(path.join(root, 'src')).href + '/');
  return import(
    'data:text/javascript;base64,' +
      Buffer.from(prelude + '\nexport { ' + exports.join(', ') + ' };').toString('base64')
  );
}

const reviewFixture = await loadFixture(
  'test/codex-review-release.test.js',
  "test('risk selection",
  ['fixture', 'passingProvider', 'git'],
);
const developmentFixture = await loadFixture(
  'test/codex-development-flow.test.js',
  "test('red baseline requires",
  ['fixture'],
);
const results = [];

// Use the existing synthetic fixture only to isolate actual Review/H3/archive behavior.
// This is not a real business project or real native approval acceptance.
const a = await reviewFixture.fixture({ projectBacked: true });
const issue = {
  id: 'AUDIT-P3',
  severity: 'P3',
  file: 'backend/src/main/java/Controller.java',
  line: 1,
  acIds: ['AC-1'],
  evidence:
    'public class Controller { public void deleteAccount() { System.out.println("secure"); } }',
  recommendation: 'AUDIT_KNOWN_ISSUE_MUST_REACH_CUSTOMER',
};
const provider = async (role, challenge) => ({
  ...(await reviewFixture.passingProvider(a)(role, challenge)),
  findings: [issue],
});
const review = createReviewService({
  projectRoot: a.root,
  store: a.store,
  planService: a.planService,
  roleProvider: provider,
  approvalAuthority: a.authority,
});
const reviewed = await review.run({ expectedVersion: await a.version(), mode: 'standard' });
const report = JSON.parse(fs.readFileSync(path.join(a.root, reviewed.review.reportPath), 'utf8'));
const h3 = await review.requestH3({ expectedVersion: await a.version() });
const archived = await createReleaseService({
  projectRoot: a.root,
  store: a.store,
  planService: a.planService,
}).run({ expectedVersion: await a.version() });
const delivery = archived.report?.delivery;
const customer =
  delivery &&
  fs.readFileSync(
    path.join(a.root, '.specgate/codex/deliveries', delivery.deliveryId, 'customer.md'),
    'utf8',
  );
results.push({
  case: 'nonblocking-review-finding-lost',
  reviewOk: reviewed.ok,
  savedFindings: report.report.findings,
  h3Ok: h3.ok,
  archiveOk: archived.ok,
  deliveryKnownIssues: delivery?.knownIssues,
  customerContainsKnownIssue: customer?.includes(issue.recommendation),
});

for (const decision of ['modify', 'cancel']) {
  const b = await reviewFixture.fixture();
  const authority = createApprovalAuthority({
    request: async () => ({
      action: 'accept',
      content: { decision, comment: 'Synthetic audit requests correction or cancellation' },
    }),
    trustedPeerIdentity: {
      kind: 'user',
      id: 'audit-fixture',
      source: 'synthetic-audit-not-runtime',
    },
    audit: async (event) => {
      const current = await b.store.inspect();
      const saved = await b.store.recordEvent({
        expectedVersion: current.state.version,
        type: event.type,
        payload: event,
      });
      if (!saved.ok) throw new Error(saved.code);
    },
  });
  const service = createReviewService({
    projectRoot: b.root,
    store: b.store,
    planService: b.planService,
    roleProvider: reviewFixture.passingProvider(b),
    approvalAuthority: authority,
  });
  await service.run({ expectedVersion: await b.version() });
  const response = await service.requestH3({ expectedVersion: await b.version() });
  const rework = await createDevelopmentService({
    projectRoot: b.root,
    store: b.store,
    planService: b.planService,
  }).prepareRework({ expectedVersion: await b.version() });
  results.push({
    case: 'h3-' + decision,
    responseCode: response.code,
    phase: (await b.store.inspect()).state.phase,
    reworkCode: rework.code,
  });
}

const c = await developmentFixture.fixture({ redPasses: true });
const originalChangeAdd = (await c.store.inspect()).state.context.changeAdd;
await c.store.update({
  expectedVersion: await c.version(),
  patch: {
    context: {
      changeAdd: { ...originalChangeAdd, change: { type: 'refactor' } },
      validationProfile: scenarioProfile(),
    },
  },
});
const state = (await c.store.inspect()).state;
const policy = policyFor(resolveProfile(state).profile, state.type || 'feature');
const prepared = await createDevelopmentService({
  projectRoot: c.root,
  store: c.store,
  planService: c.planService,
  redRunner: c.redRunner,
}).prepare({ expectedVersion: await c.version() });
const update = await c.store.update({
  expectedVersion: await c.version(),
  patch: { validationProfile: scenarioProfile() },
});
results.push({
  case: 'scenario-profile-not-connected',
  declaredType: state.context.changeAdd.change.type,
  topLevelType: state.type ?? null,
  declaredContextProfile: state.context.validationProfile.profileId,
  resolvedProfile: resolveProfile(state),
  selectedPolicy: policy,
  prepareCode: prepared.code,
  topLevelProfileWriteCode: update.code,
});

const formatterRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-audit-format-'));
fs.writeFileSync(
  path.join(formatterRoot, 'package.json'),
  JSON.stringify({ scripts: { format: 'prettier --write .' } }),
);
results.push({
  case: 'root-node-project-format',
  result: await createNativeFormatter()({ worktree: formatterRoot }),
});

const d = await reviewFixture.fixture({ projectBacked: true });
reviewFixture.git(d.root, [
  'remote',
  'add',
  'origin',
  path.join(os.tmpdir(), 'audit-unused-no-network.git'),
]);
reviewFixture.git(d.root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
reviewFixture.git(d.root, ['config', 'branch.main.remote', 'origin']);
reviewFixture.git(d.root, ['config', 'branch.main.merge', 'refs/heads/main']);
const reviewD = createReviewService({
  projectRoot: d.root,
  store: d.store,
  planService: d.planService,
  roleProvider: reviewFixture.passingProvider(d),
  approvalAuthority: d.authority,
});
await reviewD.run({ expectedVersion: await d.version() });
await reviewD.requestH3({ expectedVersion: await d.version() });
fs.writeFileSync(
  path.join(d.root, '.specgate/codex/deliveries'),
  'Injected write failure; no production changes',
);
const releaseD = createReleaseService({
  projectRoot: d.root,
  store: d.store,
  planService: d.planService,
});
const before = reviewFixture.git(d.root, ['rev-parse', 'HEAD']);
const first = await releaseD.run({ expectedVersion: await d.version() });
const after = reviewFixture.git(d.root, ['rev-parse', 'HEAD']);
fs.unlinkSync(path.join(d.root, '.specgate/codex/deliveries'));
const retry = await releaseD.run({ expectedVersion: await d.version() });
const newH3 = await reviewD.requestH3({ expectedVersion: await d.version() });
results.push({
  case: 'archive-failure-after-merge-cannot-retry',
  firstCode: first.code,
  targetMoved: before !== after,
  targetIsReviewedIntegration: after === d.integrationCommit,
  retryCode: retry.code,
  requestNewH3Code: newH3.code,
  phase: (await d.store.inspect()).state.phase,
});

fs.writeFileSync(
  path.join(root, '.tmp/env-chain-audit-20261030/workflow-repros.json'),
  JSON.stringify(results, null, 2) + '\n',
);
console.log(JSON.stringify(results, null, 2));
