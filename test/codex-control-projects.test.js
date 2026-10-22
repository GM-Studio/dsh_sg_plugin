import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  aggregatePortfolio,
  modeConfig,
  projectRegistry,
  resolveGlobalConcurrency,
  selectControlMode,
} from '../src/codex/control/projects.js';
import { hashValue } from '../src/codex/events.js';

const at = (seconds) => `2026-10-22T00:00:${String(seconds).padStart(2, '0')}.000Z`;

function makeState({ projects = [], workItems = [], attention = [] } = {}) {
  return {
    schemaVersion: 1,
    version: 1,
    projects: Object.fromEntries(projects.map((entry) => [entry.projectId, entry])),
    workItems: Object.fromEntries(workItems.map((entry) => [entry.workItemId, entry])),
    runs: {},
    attention: Object.fromEntries(attention.map((entry) => [entry.requestId, entry])),
    decisions: {},
    notifications: {},
    leases: {},
    workSequence: workItems.length,
  };
}

function project(projectId, overrides = {}) {
  return {
    schemaVersion: 1,
    projectId,
    name: projectId,
    projectRoot: `C:\\work\\${projectId}`,
    status: 'READY',
    createdAt: at(0),
    updatedAt: at(0),
    ...overrides,
  };
}

let workSeq = 0;
function workItem(overrides = {}) {
  workSeq += 1;
  const sequence = overrides.queueSequence ?? workSeq;
  return {
    schemaVersion: 1,
    workItemId: `work-${workSeq}`,
    projectId: 'project-a',
    executionState: 'QUEUED',
    priority: 'normal',
    queueSequence: sequence,
    createdAt: at(sequence),
    updatedAt: at(sequence),
    ...overrides,
  };
}

function attentionRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    requestId: overrides.requestId,
    workItemId: 'work-1',
    projectId: 'project-a',
    type: 'CLARIFICATION',
    status: 'OPEN',
    createdAt: at(0),
    updatedAt: at(0),
    expiresAt: '2026-10-23T00:00:00.000Z',
    ...overrides,
  };
}

test('registry and aggregate projections tolerate an empty or partial state', () => {
  assert.deepEqual(projectRegistry({}), []);
  assert.deepEqual(projectRegistry(null), []);
  assert.deepEqual(projectRegistry(undefined), []);
  assert.deepEqual(projectRegistry({ projects: {}, workItems: {} }), []);
  const empty = aggregatePortfolio({});
  assert.deepEqual(empty.projects, []);
  assert.deepEqual(empty.attention, []);
  assert.deepEqual(empty.queue, []);
  assert.equal(empty.concurrency.effective, 2);
  assert.equal(empty.concurrency.ok, true);
  assert.deepEqual(aggregatePortfolio(null).projects, []);
  assert.deepEqual(aggregatePortfolio(undefined).attention, []);
});

test('projectRegistry summarizes a single project from mixed WorkItem states', () => {
  const state = makeState({
    projects: [project('project-a')],
    workItems: [
      workItem({ executionState: 'RUNNING', updatedAt: at(1) }),
      workItem({ executionState: 'WAITING_FOR_USER', updatedAt: at(2) }),
      workItem({ executionState: 'BLOCKED', updatedAt: at(3) }),
      workItem({ executionState: 'BLOCKED', updatedAt: at(4) }),
      workItem({ executionState: 'FAILED', updatedAt: at(5) }),
      workItem({ executionState: 'QUEUED', updatedAt: at(6) }),
      workItem({ executionState: 'COMPLETED', updatedAt: at(7) }),
    ],
  });
  assert.deepEqual(projectRegistry(state), [
    {
      projectId: 'project-a',
      projectRoot: 'C:\\work\\project-a',
      mode: 'aggregate',
      workItemCount: 7,
      running: 1,
      waitingForUser: 1,
      blocked: 2,
      failed: 1,
      lastActivityAt: at(7),
    },
  ]);
});

test('projectRegistry reports an idle project from its own updatedAt', () => {
  const state = makeState({ projects: [project('project-a', { updatedAt: at(11) })] });
  assert.deepEqual(projectRegistry(state), [
    {
      projectId: 'project-a',
      projectRoot: 'C:\\work\\project-a',
      mode: 'aggregate',
      workItemCount: 0,
      running: 0,
      waitingForUser: 0,
      blocked: 0,
      failed: 0,
      lastActivityAt: at(11),
    },
  ]);
});

test('projectRegistry keeps per-project counts, a stable order and ignores orphans', () => {
  const state = makeState({
    projects: [project('project-b'), project('project-a')],
    workItems: [
      workItem({ projectId: 'project-a', executionState: 'RUNNING', updatedAt: at(2) }),
      workItem({ projectId: 'project-a', executionState: 'FAILED', updatedAt: at(3) }),
      workItem({ projectId: 'project-b', executionState: 'WAITING_FOR_USER', updatedAt: at(8) }),
      workItem({ projectId: 'project-c', executionState: 'RUNNING', updatedAt: at(5) }),
    ],
  });
  const rows = projectRegistry(state);
  assert.deepEqual(
    rows.map((row) => row.projectId),
    ['project-a', 'project-b'],
  );
  assert.equal(rows[0].workItemCount, 2);
  assert.equal(rows[0].running, 1);
  assert.equal(rows[0].failed, 1);
  assert.equal(rows[0].lastActivityAt, at(3));
  assert.equal(rows[1].workItemCount, 1);
  assert.equal(rows[1].waitingForUser, 1);
  assert.equal(rows[1].lastActivityAt, at(8));
});

test('aggregatePortfolio orders open attention by severity then oldest by default', () => {
  const state = makeState({
    attention: [
      attentionRequest({ requestId: 'attention-5', type: 'COMPLETION', createdAt: at(5) }),
      attentionRequest({ requestId: 'attention-3', type: 'H1_APPROVAL', createdAt: at(3) }),
      attentionRequest({ requestId: 'attention-1', type: 'BLOCKED', createdAt: at(1) }),
      attentionRequest({ requestId: 'attention-2', type: 'H1_APPROVAL', createdAt: at(2) }),
      attentionRequest({ requestId: 'attention-9', type: 'FAILED', status: 'DECIDED' }),
    ],
  });
  const { attention } = aggregatePortfolio(state);
  assert.deepEqual(
    attention.map((entry) => entry.requestId),
    ['attention-2', 'attention-3', 'attention-1', 'attention-5'],
  );
});

test('aggregatePortfolio honours a supplied attention comparator or ranker', () => {
  const state = makeState({
    attention: [
      attentionRequest({ requestId: 'attention-1', type: 'BLOCKED', createdAt: at(1) }),
      attentionRequest({ requestId: 'attention-2', type: 'COMPLETION', createdAt: at(2) }),
      attentionRequest({ requestId: 'attention-3', type: 'CLARIFICATION', createdAt: at(3) }),
    ],
  });
  const byIdDescending = aggregatePortfolio(state, {
    rankAttention: (left, right) => right.requestId.localeCompare(left.requestId),
  });
  assert.deepEqual(
    byIdDescending.attention.map((entry) => entry.requestId),
    ['attention-3', 'attention-2', 'attention-1'],
  );

  const rankFunction = aggregatePortfolio(state, {
    rankAttention: (entry) => (entry.type === 'COMPLETION' ? -1 : 0),
  });
  assert.deepEqual(
    rankFunction.attention.map((entry) => entry.requestId),
    ['attention-2', 'attention-1', 'attention-3'],
  );
});

test('aggregatePortfolio queues queued/running items in claimNext order', () => {
  const state = makeState({
    workItems: [
      workItem({ workItemId: 'q1', projectId: 'project-a', priority: 'normal', queueSequence: 2 }),
      workItem({ workItemId: 'q2', projectId: 'project-b', priority: 'high', queueSequence: 5 }),
      workItem({ workItemId: 'q3', projectId: 'project-a', priority: 'low', queueSequence: 1 }),
      workItem({ workItemId: 'q4', projectId: 'project-b', priority: 'high', queueSequence: 3 }),
      workItem({ workItemId: 'q5', projectId: 'project-a', priority: 'normal', queueSequence: 4 }),
      workItem({
        workItemId: 'r1',
        projectId: 'project-a',
        priority: 'high',
        queueSequence: 6,
        executionState: 'RUNNING',
      }),
      workItem({ workItemId: 'c1', projectId: 'project-a', executionState: 'COMPLETED' }),
      workItem({ workItemId: 'w1', projectId: 'project-b', executionState: 'WAITING_FOR_USER' }),
    ],
  });
  const { queue } = aggregatePortfolio(state);
  assert.deepEqual(
    queue.map((entry) => entry.workItemId),
    ['q4', 'q2', 'r1', 'q1', 'q5', 'q3'],
  );

  // The queued subset reproduces the supervisor's claimable order exactly.
  const rank = { high: 0, normal: 1, low: 2 };
  const claimable = Object.values(state.workItems)
    .filter((entry) => entry.executionState === 'QUEUED')
    .sort(
      (left, right) =>
        rank[left.priority] - rank[right.priority] ||
        left.queueSequence - right.queueSequence ||
        Date.parse(left.createdAt) - Date.parse(right.createdAt),
    )
    .map((entry) => entry.workItemId);
  assert.deepEqual(
    queue.filter((entry) => entry.executionState === 'QUEUED').map((entry) => entry.workItemId),
    claimable,
  );
});

test('selectControlMode derives aggregate by default and isolated per project', () => {
  const rootA = 'C:\\work\\crm';
  const empty = makeState({});
  const fallback = selectControlMode(empty, { projectRoot: rootA });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.mode, 'aggregate');
  assert.equal(fallback.registered, false);
  assert.equal(fallback.projectId, `project-${hashValue({ root: rootA }).slice(0, 16)}`);

  const registered = makeState({
    projects: [project('project-a', { projectRoot: rootA, mode: 'isolated' })],
  });
  const isolated = selectControlMode(registered, { projectRoot: rootA });
  assert.equal(isolated.mode, 'isolated');
  assert.equal(isolated.projectId, 'project-a');
  assert.equal(isolated.registered, true);

  assert.equal(
    selectControlMode({ mode: 'isolated', projects: {} }, { projectRoot: rootA }).mode,
    'isolated',
  );

  const bogus = makeState({
    projects: [project('project-a', { projectRoot: rootA, mode: 'nope' })],
  });
  assert.equal(selectControlMode(bogus, { projectRoot: rootA }).mode, 'aggregate');

  assert.equal(selectControlMode(empty, {}).code, 'PROJECT_ROOT_INVALID');
  assert.equal(selectControlMode(empty).code, 'PROJECT_ROOT_INVALID');
  assert.equal(selectControlMode(empty, null).code, 'PROJECT_ROOT_INVALID');
  assert.equal(selectControlMode(empty, { projectRoot: '' }).code, 'PROJECT_ROOT_INVALID');
  assert.equal(selectControlMode(empty, { projectRoot: 123 }).code, 'PROJECT_ROOT_INVALID');
});

test('modeConfig shares one control home in aggregate and isolates per project', () => {
  const rootA = 'C:\\work\\crm';
  const controlRoot = 'C:\\control';
  const aggregate = modeConfig('aggregate', {
    projectRoot: rootA,
    controlRoot,
    managementPort: 43120,
  });
  assert.equal(aggregate.ok, true);
  assert.equal(aggregate.shared, true);
  assert.equal(aggregate.controlRoot, path.resolve(controlRoot));
  assert.equal(aggregate.managementPort, 43120);

  const isolated = modeConfig('isolated', {
    projectRoot: rootA,
    controlRoot,
    managementPort: 43120,
  });
  assert.equal(isolated.shared, false);
  const projectId = `project-${hashValue({ root: rootA }).slice(0, 16)}`;
  assert.equal(isolated.projectId, projectId);
  assert.equal(isolated.controlRoot, path.join(path.resolve(controlRoot), 'projects', projectId));
  assert.ok(isolated.managementPort > 43120 && isolated.managementPort <= 43120 + 999);

  // Deterministic per root, distinct across roots.
  const again = modeConfig('isolated', { projectRoot: rootA, controlRoot, managementPort: 43120 });
  assert.equal(again.managementPort, isolated.managementPort);
  const other = modeConfig('isolated', {
    projectRoot: 'C:\\work\\otherapp',
    controlRoot,
    managementPort: 43120,
  });
  assert.notEqual(other.managementPort, isolated.managementPort);
  assert.notEqual(other.controlRoot, isolated.controlRoot);

  // The management port defaults when omitted.
  assert.equal(modeConfig('aggregate', { projectRoot: rootA, controlRoot }).managementPort, 43120);

  assert.equal(modeConfig('nope', { projectRoot: rootA, controlRoot }).code, 'MODE_INVALID');
  assert.equal(modeConfig(null).code, 'MODE_INVALID');
  assert.equal(modeConfig('isolated', { controlRoot }).code, 'PROJECT_ROOT_INVALID');
  assert.equal(modeConfig('isolated', { projectRoot: rootA }).code, 'CONTROL_ROOT_INVALID');
  assert.equal(
    modeConfig('isolated', { projectRoot: rootA, controlRoot, managementPort: 70000 }).code,
    'MANAGEMENT_PORT_INVALID',
  );
  assert.equal(
    modeConfig('isolated', { projectRoot: rootA, controlRoot, managementPort: 'abc' }).code,
    'MANAGEMENT_PORT_INVALID',
  );
});

test('resolveGlobalConcurrency clamps to configured bounds and reports the effective value', () => {
  const state = {};
  assert.deepEqual(resolveGlobalConcurrency(state, 4), {
    ok: true,
    requested: 4,
    effective: 4,
    min: 1,
    max: 8,
    bounds: { min: 1, max: 8 },
    clamped: false,
  });
  assert.equal(resolveGlobalConcurrency(state, 100).effective, 8);
  assert.equal(resolveGlobalConcurrency(state, 100).clamped, true);
  assert.equal(resolveGlobalConcurrency(state, 0).effective, 1);
  assert.equal(resolveGlobalConcurrency(state, -5).effective, 1);
  assert.equal(resolveGlobalConcurrency(state, undefined).effective, 2);

  const configured = { concurrency: { min: 2, max: 3, default: 3 } };
  assert.equal(resolveGlobalConcurrency(configured, 5).effective, 3);
  assert.equal(resolveGlobalConcurrency(configured, 5).min, 2);
  assert.equal(resolveGlobalConcurrency(configured, 5).max, 3);
  assert.equal(resolveGlobalConcurrency(configured, undefined).effective, 3);
  assert.equal(resolveGlobalConcurrency(configured, 1).effective, 2);

  for (const bad of ['many', NaN, Infinity, {}]) {
    const result = resolveGlobalConcurrency(state, bad);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CONCURRENCY_INVALID');
  }
});

test('aggregate projections never throw on malformed entries and do not mutate state', () => {
  const state = {
    projects: { good: { projectId: 'project-a', projectRoot: 'C:\\work\\a' }, bad: null, list: [] },
    workItems: {
      a: { projectId: 'project-a', executionState: 'RUNNING' },
      b: { executionState: 'QUEUED' },
      c: null,
    },
    attention: {
      x: { requestId: 'x', status: 'OPEN', type: 'H1_APPROVAL' },
      y: 'nope',
    },
  };
  const snapshot = JSON.parse(JSON.stringify(state));
  const result = aggregatePortfolio(state);
  assert.deepEqual(state, snapshot);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].projectId, 'project-a');
  assert.equal(result.projects[0].running, 1);
  assert.equal(result.attention.length, 1);
  assert.equal(result.queue.length, 2);
});

test('registry rows report the effective mode from the project row or the control home', () => {
  const mixed = makeState({
    projects: [project('project-a', { mode: 'isolated' }), project('project-b')],
  });
  const rows = projectRegistry(mixed);
  assert.equal(rows.find((row) => row.projectId === 'project-a').mode, 'isolated');
  assert.equal(rows.find((row) => row.projectId === 'project-b').mode, 'aggregate');

  const homeIsolated = makeState({ projects: [project('project-b')] });
  homeIsolated.controlMode = 'isolated';
  assert.equal(projectRegistry(homeIsolated)[0].mode, 'isolated');

  const invalid = makeState({ projects: [project('project-a', { mode: 'bogus' })] });
  assert.equal(projectRegistry(invalid)[0].mode, 'aggregate');
});

test('aggregatePortfolio reports the global concurrency clamp it enforces', () => {
  assert.equal(aggregatePortfolio({}, { limit: 100 }).concurrency.effective, 8);
  assert.equal(aggregatePortfolio({}, { limit: 100 }).concurrency.clamped, true);
  const configured = { concurrency: { min: 2, max: 4, default: 3 } };
  assert.equal(aggregatePortfolio(configured, { limit: 1 }).concurrency.effective, 2);
  assert.equal(aggregatePortfolio(configured, {}).concurrency.effective, 3);
});
