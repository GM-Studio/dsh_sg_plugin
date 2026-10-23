import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson, hashValue, verifyEventChain } from './events.js';
import { readProjectConventions } from './project-conventions.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const identifier = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/.test(value);
const digest = (value) => 'sha256:' + hashValue(value);
const failure = (code, message) => ({ ok: false, code, message });
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
const kinds = [
  'contract',
  'model',
  'backend',
  'frontend',
  'test',
  'integration',
  'review-precheck',
  'docs',
];
const roles = ['backend', 'frontend', 'test', 'integration', 'review', 'docs'];
const roleForKind = {
  contract: 'backend',
  model: 'backend',
  backend: 'backend',
  frontend: 'frontend',
  test: 'test',
  integration: 'integration',
  'review-precheck': 'review',
  docs: 'docs',
};
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
};

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 60000,
  }).trim();
}

function registeredWorktree(root, target) {
  const output = git(root, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: path.resolve(line.slice(9)) };
    } else if (current && line.startsWith('HEAD ')) current.head = line.slice(5);
    else if (current && line.startsWith('branch ')) current.branch = line.slice(7);
  }
  if (current) entries.push(current);
  return entries.find((entry) => {
    if (!fs.existsSync(entry.path)) return false;
    try {
      return fs.realpathSync(entry.path) === fs.realpathSync(target);
    } catch {
      return false;
    }
  });
}

function createRegisteredWorktree(root, relative, branch, baseCommit) {
  const target = path.join(root, relative);
  const existing = registeredWorktree(root, target);
  if (existing) {
    if (existing.branch !== `refs/heads/${branch}`)
      fail('TEST_WORKTREE_BROKEN', 'The test-design worktree is on the wrong branch');
    return { path: target, branch, reused: true };
  }
  if (fs.existsSync(target)) fail('TEST_WORKTREE_BROKEN', 'The test-design path is not registered');
  let current = root;
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    try {
      fs.mkdirSync(current, 0o700);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail('UNSAFE_PATH', 'The test-design workspace contains an unsafe directory');
  }
  try {
    git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    fail('TEST_WORKTREE_BRANCH_EXISTS', 'A stale test-design branch already exists');
  } catch (error) {
    if (error.code === 'TEST_WORKTREE_BRANCH_EXISTS') throw error;
  }
  try {
    git(root, ['worktree', 'add', '-b', branch, target, baseCommit]);
  } catch (error) {
    fail('TEST_WORKTREE_CREATE_FAILED', error.message);
  }
  return { path: target, branch, reused: false };
}

function acList(snapshot) {
  if (!Array.isArray(snapshot?.requirements) || !snapshot.requirements.length)
    fail('REQUIREMENTS_INVALID', 'A frozen requirements list is required');
  const result = [];
  const reqIds = new Set();
  const acIds = new Set();
  for (const req of snapshot.requirements) {
    if (
      !identifier(req.id) ||
      reqIds.has(req.id) ||
      !text(req.text) ||
      !Array.isArray(req.acceptanceCriteria) ||
      !req.acceptanceCriteria.length
    )
      fail(
        'REQUIREMENTS_INVALID',
        'Requirements and acceptance criteria must have unique identifiers',
      );
    reqIds.add(req.id);
    for (const ac of req.acceptanceCriteria) {
      if (!identifier(ac.id) || acIds.has(ac.id) || !text(ac.text))
        fail('REQUIREMENTS_INVALID', 'Acceptance criteria must have unique identifiers and text');
      acIds.add(ac.id);
      result.push({ id: ac.id, requirementId: req.id, text: ac.text, caseId: `CASE-${ac.id}` });
    }
  }
  return result;
}

function validateGraph(graph) {
  const invalid = () =>
    failure(
      'PLAN_GRAPH_INVALID',
      'Task graph has invalid mappings, dependencies, ordering or concurrency',
    );
  if (
    !object(graph) ||
    graph.maxParallelDevelopment !== 1 ||
    !Array.isArray(graph.acs) ||
    !graph.acs.length ||
    !Array.isArray(graph.tasks) ||
    !graph.tasks.length
  )
    return invalid();
  const acs = new Map(graph.acs.map((ac) => [ac.id, ac]));
  if (
    acs.size !== graph.acs.length ||
    new Set(graph.acs.map((ac) => ac.caseId)).size !== graph.acs.length ||
    graph.acs.some(
      (ac) =>
        !identifier(ac.id) ||
        !identifier(ac.caseId) ||
        !identifier(ac.requirementId) ||
        !text(ac.text),
    )
  )
    return invalid();
  const tasks = new Map();
  const coverage = Object.fromEntries(kinds.map((kind) => [kind, new Set()]));
  for (const task of graph.tasks) {
    if (
      !object(task) ||
      !identifier(task.id) ||
      tasks.has(task.id) ||
      !kinds.includes(task.kind) ||
      !roles.includes(task.role) ||
      task.role !== roleForKind[task.kind] ||
      !Array.isArray(task.acIds) ||
      !task.acIds.length ||
      !Array.isArray(task.caseIds) ||
      !task.caseIds.length ||
      !Array.isArray(task.deps) ||
      !Array.isArray(task.acceptance) ||
      !task.acceptance.length ||
      !task.acceptance.every(text)
    )
      return invalid();
    if (
      new Set(task.acIds).size !== task.acIds.length ||
      new Set(task.caseIds).size !== task.caseIds.length ||
      new Set(task.deps).size !== task.deps.length ||
      task.acIds.some((ac) => !acs.has(ac)) ||
      task.caseIds.some((caseId) => !task.acIds.some((acId) => acs.get(acId).caseId === caseId)) ||
      task.acIds.some((acId) => !task.caseIds.includes(acs.get(acId).caseId))
    )
      return invalid();
    tasks.set(task.id, task);
    for (const ac of task.acIds) coverage[task.kind].add(ac);
  }
  if (kinds.some((kind) => !graph.tasks.some((task) => task.kind === kind))) return invalid();
  const visited = new Set();
  const visiting = new Set();
  function visit(id) {
    if (visiting.has(id) || !tasks.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const dependency of tasks.get(id).deps) if (!visit(dependency)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  }
  for (const task of graph.tasks) {
    if (!visit(task.id)) return invalid();
    if (
      ['frontend', 'backend'].includes(task.kind) &&
      (!task.deps.includes('contract') ||
        !task.deps.includes('model') ||
        !task.acIds.every((acId) =>
          task.deps.some(
            (dependency) =>
              tasks.get(dependency)?.kind === 'test' && tasks.get(dependency).acIds.includes(acId),
          ),
        ))
    )
      return invalid();
  }
  if (
    tasks.get('contract')?.kind !== 'contract' ||
    tasks.get('model')?.kind !== 'model' ||
    !tasks.get('model').deps.includes('contract')
  )
    return invalid();
  for (const acId of acs.keys())
    if (kinds.some((kind) => !coverage[kind].has(acId))) return invalid();
  return { ok: true };
}

export function validateTaskGraph(graph) {
  try {
    return validateGraph(graph);
  } catch {
    return failure('PLAN_GRAPH_INVALID', 'Task graph is malformed');
  }
}

export function buildTaskGraph(snapshot) {
  try {
    const acs = acList(snapshot);
    const tasks = [];
    const task = (id, kind, role, selected, deps, acceptance) => ({
      id,
      kind,
      role,
      acIds: selected.map((ac) => ac.id),
      caseIds: selected.map((ac) => ac.caseId),
      deps,
      acceptance,
    });
    tasks.push(
      task(
        'contract',
        'contract',
        'backend',
        acs,
        [],
        ['Freeze the versioned API contract with every acceptance criterion mapped.'],
      ),
    );
    tasks.push(
      task(
        'model',
        'model',
        'backend',
        acs,
        ['contract'],
        ['Freeze the versioned data model and its constraints.'],
      ),
    );
    for (const ac of acs) {
      const suffix = hashValue({ requirementId: ac.requirementId, acId: ac.id }).slice(0, 16);
      const testId = 'test-' + suffix;
      tasks.push(
        task(
          testId,
          'test',
          'test',
          [ac],
          ['contract', 'model'],
          [
            ac.text,
            'Freeze executable cases and fixtures; retain actual failing baseline evidence before development.',
          ],
        ),
      );
      for (const role of ['backend', 'frontend'])
        tasks.push(
          task(
            `${role}-${suffix}`,
            role,
            role,
            [ac],
            ['contract', 'model', testId],
            [ac.text, `Pass ${ac.caseId} against the frozen contract and model.`],
          ),
        );
    }
    const integrations = [];
    for (const requirement of snapshot.requirements) {
      const selected = acs.filter((ac) => ac.requirementId === requirement.id);
      const suffix = hashValue(requirement.id).slice(0, 16);
      const integration = 'integration-' + suffix;
      integrations.push(integration);
      tasks.push(
        task(
          integration,
          'integration',
          'integration',
          selected,
          tasks
            .filter(
              (entry) =>
                ['frontend', 'backend'].includes(entry.kind) &&
                entry.acIds.some((acId) => selected.some((ac) => ac.id === acId)),
            )
            .map((entry) => entry.id),
          [requirement.text, 'Reconcile integrated behavior with all mapped cases.'],
        ),
      );
      tasks.push(
        task(
          'docs-' + suffix,
          'docs',
          'docs',
          selected,
          [integration],
          ['Update documentation for the mapped acceptance criteria.'],
        ),
      );
    }
    tasks.push(
      task('review-precheck', 'review-precheck', 'review', acs, integrations, [
        'Reconcile frozen assets, quality commands and acceptance evidence before Review.',
      ]),
    );
    const graph = { schemaVersion: 1, maxParallelDevelopment: 1, acs, tasks };
    const checked = validateTaskGraph(graph);
    return checked.ok ? { ok: true, graph } : checked;
  } catch (error) {
    return failure(error.code || 'REQUIREMENTS_INVALID', error.message);
  }
}

function safeRelative(relative) {
  return (
    typeof relative === 'string' &&
    /^[A-Za-z0-9.][A-Za-z0-9._/-]{0,399}$/.test(relative) &&
    relative
      .split('/')
      .every(
        (part) =>
          part &&
          !['.', '..'].includes(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}

export function createPlanService({ projectRoot, store, roleProvider } = {}) {
  const root = fs.realpathSync(projectRoot);
  if (!store || typeof store.inspect !== 'function')
    throw new TypeError('A server state store is required');
  const safeRoot = !inside(SOURCE_ROOT, root) && !inside(root, SOURCE_ROOT);
  const protect = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      return failure(error.code || 'PLAN_STORAGE_FAILED', error.message);
    }
  };
  function read(relative, maxBytes = 4 * 1024 * 1024) {
    if (!safeRelative(relative)) fail('PLAN_ARTIFACT_CHANGED', 'Unsafe plan artifact path');
    const target = path.resolve(root, relative);
    if (!inside(root, target)) fail('PLAN_ARTIFACT_CHANGED', 'Artifact escaped its project');
    let current = root;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      if (
        stat.isSymbolicLink() ||
        (current === target
          ? !stat.isFile() || stat.nlink > 1 || stat.size > maxBytes
          : !stat.isDirectory())
      )
        fail('PLAN_ARTIFACT_CHANGED', 'Unsafe plan artifact');
    }
    return fs.readFileSync(target, 'utf8');
  }
  function json(relative) {
    try {
      return JSON.parse(read(relative));
    } catch (error) {
      fail('PLAN_ARTIFACT_CHANGED', error.message);
    }
  }
  function immutable(relative, content) {
    if (!safeRelative(relative) || Buffer.byteLength(content) > 4 * 1024 * 1024)
      fail('PLAN_STORAGE_FAILED', 'Unsafe or oversized frozen asset');
    let current = root;
    for (const part of relative.split('/').slice(0, -1)) {
      current = path.join(current, part);
      try {
        fs.mkdirSync(current);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        fail('PLAN_STORAGE_FAILED', 'Unsafe frozen asset directory');
    }
    let fd;
    let created = false;
    let failure = null;
    try {
      fd = fs.openSync(path.join(root, relative), 'wx', 0o600);
      created = true;
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
    } catch (error) {
      failure = error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    if (failure) {
      if (created) {
        try {
          fs.rmSync(path.join(root, relative), { force: true, maxRetries: 20, retryDelay: 100 });
        } catch {
          // preserve the original write failure; the partial asset is never treated as frozen
        }
      }
      if (failure.code !== 'EEXIST' || read(relative) !== content) throw failure;
    }
    if (process.platform !== 'win32') {
      const directory = fs.openSync(path.dirname(path.join(root, relative)), 'r');
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    }
  }
  function freeze(base, kind, body) {
    const hash = digest(body);
    const relative = `${base}/${kind}-${hash.slice(7)}.json`;
    immutable(relative, canonicalJson(body) + '\n');
    return { path: relative, hash, version: body.version ?? 1 };
  }
  function verifyRef(ref) {
    if (!object(ref) || typeof ref.hash !== 'string')
      fail('PLAN_ARTIFACT_CHANGED', 'A frozen asset no longer matches its hash');
    const body = json(ref.path);
    if (digest(body) !== ref.hash)
      fail('PLAN_ARTIFACT_CHANGED', 'A frozen asset no longer matches its hash');
    return body;
  }
  async function frozenRequirements(state) {
    const locator = state.context.changeAdd?.frozen;
    const prefix = `.specgate/codex/changes/${state.changeId}/requirements/`;
    if (
      !locator ||
      locator.authority !== 'REQ_FROZEN-gate-transition' ||
      !locator.path?.startsWith(prefix) ||
      locator.hash !== state.context.artifacts?.requirements?.hash
    )
      fail('H1_EVIDENCE_INVALID', 'An H1-bound P4 frozen locator is required');
    let snapshot;
    try {
      snapshot = json(locator.path);
    } catch {
      fail('REQUIREMENTS_HASH_MISMATCH', 'Frozen requirements cannot be read');
    }
    if (
      digest(snapshot) !== locator.hash ||
      snapshot.changeId !== state.changeId ||
      snapshot.revision !== locator.revision
    )
      fail('REQUIREMENTS_HASH_MISMATCH', 'Frozen requirements no longer match their locator');
    const chain = verifyEventChain(read('.specgate/codex/events.jsonl', 128 * 1024 * 1024));
    if (!chain.ok || chain.events.at(-1)?.state.version !== state.version)
      fail('H1_EVIDENCE_INVALID', 'State and H1 audit history disagree');
    const transition = chain.events.findLast(
      (event) =>
        event.changeId === state.changeId &&
        event.type === 'state.transitioned' &&
        event.state.phase === 'REQ_FROZEN' &&
        event.payload?.from === 'H1_PENDING' &&
        event.payload?.to === 'REQ_FROZEN' &&
        event.payload?.gate === 'H1',
    );
    const approval = transition?.payload.approval;
    if (!object(approval)) fail('H1_EVIDENCE_INVALID', 'A consumed H1 approval record is required');
    const consumed = chain.events.find(
      (event) =>
        event.changeId === state.changeId &&
        event.type === 'approval.consumed' &&
        event.sequence < transition?.sequence &&
        object(event.payload?.record) &&
        canonicalJson(event.payload.record) === canonicalJson(approval),
    );
    if (
      !transition ||
      !consumed ||
      approval?.gate !== 'H1' ||
      approval.scope !== state.changeId ||
      approval.artifactHash !== locator.hash ||
      approval.decision !== 'approve' ||
      !/^[a-f0-9]{64}$/.test(approval.nonce || '') ||
      !text(approval.consumedAt) ||
      !Number.isFinite(Date.parse(approval.consumedAt)) ||
      !(Date.parse(approval.consumedAt) < Date.parse(approval.expiresAt)) ||
      approval.actor?.kind !== 'user' ||
      !text(approval.actor.source) ||
      transition.state.context.changeAdd?.frozen?.hash !== locator.hash
    )
      fail(
        'H1_EVIDENCE_INVALID',
        'A matching consumed H1 approval and freeze transition are required',
      );
    acList(snapshot);
    return { snapshot, locator, approval };
  }
  async function current(args, phases, allowed = ['expectedVersion']) {
    if (!safeRoot)
      return failure(
        'SOURCE_REPOSITORY_FORBIDDEN',
        'The plugin repository cannot host a product plan',
      );
    if (
      !object(args) ||
      Object.keys(args).some((key) => !allowed.includes(key)) ||
      !Number.isSafeInteger(args.expectedVersion) ||
      args.expectedVersion < 0
    )
      return failure(
        'INVALID_ARGUMENT',
        'Only the declared arguments and a nonnegative expectedVersion are accepted',
      );
    const loaded = await store.inspect();
    if (!loaded.ok) return loaded;
    if (loaded.state.version !== args.expectedVersion)
      return {
        ...failure('VERSION_CONFLICT', 'Read the current state before retrying'),
        actualVersion: loaded.state.version,
      };
    if (!phases.includes(loaded.state.phase))
      return failure(
        'INVALID_TRANSITION',
        'This phase cannot perform the requested plan operation',
      );
    return loaded;
  }
  async function inspect() {
    if (!safeRoot)
      return failure(
        'SOURCE_REPOSITORY_FORBIDDEN',
        'The plugin repository cannot host a product plan',
      );
    const loaded = await store.inspect();
    if (!loaded.ok) return loaded;
    const { state } = loaded;
    const requirements = await frozenRequirements(state);
    const ref = state.context.plan;
    if (!ref) return failure('PLAN_REQUIRED', 'Generate a plan before freezing downstream assets');
    const plan = verifyRef(ref);
    if (plan.requirementsHash !== requirements.locator.hash || !validateTaskGraph(plan.graph).ok)
      fail('PLAN_ARTIFACT_CHANGED', 'Plan is no longer bound to the frozen requirements');
    for (const kind of ['contract', 'model']) {
      if (!ref[kind]) continue;
      const body = verifyRef(ref[kind]);
      if (
        body.planHash !== ref.hash ||
        body.requirementsHash !== requirements.locator.hash ||
        body.kind !== kind
      )
        fail('PLAN_ARTIFACT_CHANGED', 'Contract or model binding changed');
    }
    if (ref.tests) {
      const body = verifyRef(ref.tests);
      if (
        body.planHash !== ref.hash ||
        body.contractHash !== ref.contract?.hash ||
        body.modelHash !== ref.model?.hash ||
        body.requirementsHash !== requirements.locator.hash
      )
        fail('PLAN_ARTIFACT_CHANGED', 'Test freeze binding changed');
      for (const [relative, hash] of Object.entries(body.files))
        if (digest(read(ref.tests.directory + '/' + relative)) !== hash)
          fail('PLAN_ARTIFACT_CHANGED', 'Frozen executable test or fixture content changed');
    }
    return { ok: true, state, plan, ref };
  }
  const update = (state, ref) =>
    store.update({ expectedVersion: state.version, patch: { context: { plan: ref } } });
  function validateAssets(assets, graph) {
    if (
      !object(assets) ||
      assets.role !== 'test' ||
      !Array.isArray(assets.cases) ||
      !assets.cases.length ||
      !object(assets.code) ||
      !Object.keys(assets.code).length ||
      !object(assets.fixtures) ||
      !Object.keys(assets.fixtures).length ||
      !object(assets.coverage) ||
      !Number.isFinite(assets.coverage.lines) ||
      !Number.isFinite(assets.coverage.branches) ||
      assets.coverage.lines < 80 ||
      assets.coverage.branches < 70 ||
      assets.coverage.lines > 100 ||
      assets.coverage.branches > 100
    )
      return false;
    const cases = new Set();
    if (
      !assets.cases.every((entry) => {
        if (
          !object(entry) ||
          !identifier(entry.id) ||
          cases.has(entry.id) ||
          !text(entry.description) ||
          !Array.isArray(entry.acIds) ||
          !entry.acIds.length ||
          !Array.isArray(entry.codeFiles) ||
          !entry.codeFiles.length ||
          !entry.codeFiles.every((file) => Object.hasOwn(assets.code, file)) ||
          !entry.acIds.every((acId) =>
            graph.acs.some((ac) => ac.id === acId && ac.caseId === entry.id),
          )
        )
          return false;
        cases.add(entry.id);
        return true;
      }) ||
      graph.acs.some(
        (ac) =>
          !assets.cases.some((entry) => entry.id === ac.caseId && entry.acIds.includes(ac.id)),
      )
    )
      return false;
    const names = [...Object.keys(assets.code), ...Object.keys(assets.fixtures)];
    return (
      new Set(names).size === names.length &&
      names.every(safeRelative) &&
      Object.values(assets.code).every(text) &&
      Object.values(assets.fixtures).every(text)
    );
  }

  async function recordTestAssets(loaded, checked, assets, extra = {}) {
    if (!validateAssets(assets, checked.plan.graph))
      return failure(
        'TEST_ASSETS_INVALID',
        'Test assets require valid AC mappings, executable code, fixtures and coverage targets',
      );
    const files = {
      ...assets.code,
      ...assets.fixtures,
      'cases.json': canonicalJson(assets.cases) + '\n',
      'cases.md':
        '# Frozen test cases\n\n' +
        assets.cases
          .map(
            (entry) =>
              `## ${entry.id}\n\n${entry.description}\n\nAC: ${entry.acIds.join(', ')}\nCode: ${entry.codeFiles.join(', ')}\n`,
          )
          .join('\n'),
    };
    if (
      ['cases.json', 'cases.md'].some(
        (relative) =>
          Object.hasOwn(assets.code, relative) || Object.hasOwn(assets.fixtures, relative),
      )
    )
      return failure(
        'TEST_ASSETS_INVALID',
        'cases.json and cases.md are reserved for the human-readable case index',
      );
    const body = {
      schemaVersion: 1,
      kind: 'tests',
      version: 1,
      requirementsHash: checked.plan.requirementsHash,
      planHash: checked.ref.hash,
      contractHash: checked.ref.contract.hash,
      modelHash: checked.ref.model.hash,
      role: 'test',
      coverage: assets.coverage,
      cases: assets.cases,
      files: Object.fromEntries(
        Object.entries(files).map(([relative, content]) => [relative, digest(content)]),
      ),
      ...extra,
    };
    const directory = `.specgate/codex/changes/${loaded.state.changeId}/tests/v1-${hashValue(body)}`;
    for (const [relative, content] of Object.entries(files))
      immutable(directory + '/' + relative, content);
    const tests = { ...freeze(directory, 'manifest', body), directory };
    const saved = await update(loaded.state, { ...checked.ref, tests });
    if (!saved.ok) return saved;
    const moved = await store.transition({
      expectedVersion: saved.state.version,
      to: 'TEST_CASES_FROZEN',
    });
    return { ...moved, tests: body };
  }

  function testManifest(worktree) {
    const relative = 'specgate-tests.json';
    const target = path.join(worktree, relative);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1 || stat.size > 4 * 1024 * 1024)
      fail('TEST_MANIFEST_INVALID', 'specgate-tests.json must be an ordinary bounded file');
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      fail('TEST_MANIFEST_INVALID', 'specgate-tests.json is not valid JSON');
    }
    if (
      !object(manifest) ||
      manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.code) ||
      !Array.isArray(manifest.fixtures) ||
      !manifest.code.length ||
      !text(manifest.runner) ||
      !manifest.code.includes(manifest.runner) ||
      !object(manifest.coverage)
    )
      fail(
        'TEST_MANIFEST_INVALID',
        'Test manifest requires schemaVersion 1, code, fixtures, runner and coverage',
      );
    const readFiles = (entries) =>
      Object.fromEntries(
        entries.map((relative) => {
          if (!safeRelative(relative) || !relative.startsWith('specgate-tests/'))
            fail('TEST_MANIFEST_INVALID', 'Test files must stay under specgate-tests/');
          const file = path.resolve(worktree, relative);
          if (!inside(worktree, file)) fail('TEST_MANIFEST_INVALID', 'Test file escaped worktree');
          let current = worktree;
          for (const part of relative.split('/')) {
            current = path.join(current, part);
            const entry = fs.lstatSync(current);
            if (entry.isSymbolicLink())
              fail('TEST_MANIFEST_INVALID', 'Test files cannot be symlinks');
            if (current === file) {
              if (!entry.isFile() || entry.nlink > 1 || entry.size > 4 * 1024 * 1024)
                fail('TEST_MANIFEST_INVALID', 'Test files must be ordinary bounded files');
            } else if (!entry.isDirectory()) {
              fail('TEST_MANIFEST_INVALID', 'Test file parents must be ordinary directories');
            }
          }
          return [relative, fs.readFileSync(file, 'utf8')];
        }),
      );
    return {
      manifestHash: digest(manifest),
      assets: {
        role: 'test',
        cases: manifest.cases,
        code: readFiles(manifest.code),
        fixtures: readFiles(manifest.fixtures),
        coverage: manifest.coverage,
      },
      runner: manifest.runner,
    };
  }

  return Object.freeze({
    inspect: () => protect(inspect),
    generate: (args = {}) =>
      protect(async () => {
        const loaded = await current(args, ['REQ_FROZEN']);
        if (!loaded.ok) return loaded;
        const frozen = await frozenRequirements(loaded.state);
        const built = buildTaskGraph(frozen.snapshot);
        if (!built.ok) return built;
        const plan = {
          schemaVersion: 1,
          version: 1,
          changeId: loaded.state.changeId,
          requirementsHash: frozen.locator.hash,
          approvalSource: frozen.approval.actor.source,
          runtimeApprovalAttested: false,
          graph: built.graph,
        };
        const ref = freeze(`.specgate/codex/changes/${loaded.state.changeId}/plan`, 'plan', plan);
        const saved = await update(loaded.state, ref);
        if (!saved.ok) return saved;
        const moved = await store.transition({
          expectedVersion: saved.state.version,
          to: 'PLANNING',
        });
        return { ...moved, plan };
      }),
    freezeContracts: (args = {}) =>
      protect(async () => {
        const loaded = await current(args, ['PLANNING'], ['expectedVersion', 'contract', 'model']);
        if (!loaded.ok) return loaded;
        const checked = await inspect();
        if (!checked.ok) return checked;
        for (const kind of ['contract', 'model'])
          if (
            !object(args[kind]) ||
            args[kind].version !== 1 ||
            !(
              text(args[kind].content) ||
              (object(args[kind].content) && Object.keys(args[kind].content).length)
            )
          )
            return failure(
              'INVALID_ARGUMENT',
              'Nonempty version 1 contract and model documents are required',
            );
        const ref = { ...checked.ref };
        for (const kind of ['contract', 'model'])
          ref[kind] = freeze(`.specgate/codex/changes/${loaded.state.changeId}/plan`, kind, {
            schemaVersion: 1,
            kind,
            version: 1,
            requirementsHash: checked.plan.requirementsHash,
            planHash: ref.hash,
            content: args[kind].content,
          });
        const saved = await update(loaded.state, ref);
        if (!saved.ok) return saved;
        return store.transition({ expectedVersion: saved.state.version, to: 'TEST_DESIGN' });
      }),
    freezeTests: (args = {}) =>
      protect(async () => {
        const loaded = await current(args, ['TEST_DESIGN']);
        if (!loaded.ok) return loaded;
        const checked = await inspect();
        if (!checked.ok) return checked;
        if (!checked.ref.contract || !checked.ref.model)
          return failure(
            'CONTRACT_FREEZE_REQUIRED',
            'Freeze the contract and model before designing tests',
          );
        if (typeof roleProvider !== 'function')
          return failure('TEST_ROLE_UNAVAILABLE', 'A server-owned Test role provider is required');
        let assets;
        try {
          assets = await roleProvider('test', {
            operation: 'freeze-tests',
            changeId: loaded.state.changeId,
            plan: checked.plan,
            contract: verifyRef(checked.ref.contract),
            model: verifyRef(checked.ref.model),
            conventions: readProjectConventions({ projectRoot: root }),
          });
        } catch {
          return failure('TEST_ROLE_UNAVAILABLE', 'The Test role provider did not produce assets');
        }
        return recordTestAssets(loaded, checked, assets);
      }),
    testDesignPrepare: (args = {}) =>
      protect(async () => {
        const loaded = await current(args, ['TEST_DESIGN']);
        if (!loaded.ok) return loaded;
        const checked = await inspect();
        if (!checked.ok) return checked;
        if (!checked.ref.contract || !checked.ref.model)
          return failure(
            'CONTRACT_FREEZE_REQUIRED',
            'Freeze contract and model before test design',
          );
        if (git(root, ['status', '--porcelain', '--untracked-files=all']))
          return failure('GIT_NOT_CLEAN', 'The main worktree must be clean before test design');
        const baseCommit = git(root, ['rev-parse', 'HEAD']);
        const relative = `.specgate/codex/worktrees/${loaded.state.changeId}/test-design`;
        const branch = `sg/codex/${loaded.state.changeId}/test-design`;
        let worktree;
        try {
          worktree = createRegisteredWorktree(root, relative, branch, baseCommit);
        } catch (error) {
          return failure(error.code || 'TEST_WORKTREE_FAILED', error.message);
        }
        const testDesign = {
          schemaVersion: 1,
          path: worktree.path,
          relative,
          branch,
          baseCommit,
          manifest: 'specgate-tests.json',
          preparedAt: new Date().toISOString(),
        };
        const saved = await update(loaded.state, { ...checked.ref, testDesign });
        return saved.ok
          ? {
              ...saved,
              testDesign,
              challenge: {
                requirements: checked.plan.graph,
                contract: verifyRef(checked.ref.contract),
                model: verifyRef(checked.ref.model),
                manifest: 'specgate-tests.json',
                testRoot: 'specgate-tests/',
                conventions: readProjectConventions({ projectRoot: root }),
              },
            }
          : saved;
      }),
    testDesignFreeze: (args = {}) =>
      protect(async () => {
        const loaded = await current(args, ['TEST_DESIGN']);
        if (!loaded.ok) return loaded;
        const checked = await inspect();
        if (!checked.ok) return checked;
        const prepared = checked.ref.testDesign;
        if (!object(prepared) || !text(prepared.path))
          return failure('TEST_DESIGN_REQUIRED', 'Prepare the test-design worktree first');
        const worktree = path.resolve(prepared.path);
        if (!inside(root, worktree) || !fs.existsSync(worktree))
          return failure('TEST_WORKTREE_MISSING', 'The test-design worktree is unavailable');
        if (git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']) !== prepared.branch)
          return failure('TEST_WORKTREE_BROKEN', 'The test-design worktree changed branch');
        if (git(worktree, ['status', '--porcelain', '--untracked-files=all']))
          return failure('TEST_WORKTREE_DIRTY', 'Commit all test assets before freezing');
        const head = git(worktree, ['rev-parse', 'HEAD']);
        if (head === prepared.baseCommit)
          return failure('TEST_COMMIT_REQUIRED', 'The Test Designer did not create a commit');
        const changed = git(worktree, ['diff', '--name-only', prepared.baseCommit, head])
          .split('\n')
          .filter(Boolean);
        if (
          !changed.length ||
          changed.some(
            (relative) =>
              relative !== 'specgate-tests.json' && !relative.startsWith('specgate-tests/'),
          )
        )
          return failure(
            'TEST_ROLE_POLICY_VIOLATION',
            'Test Designer may only add specgate-tests.json and specgate-tests/ files',
          );
        let materialized;
        try {
          materialized = testManifest(worktree);
        } catch (error) {
          return failure(error.code || 'TEST_MANIFEST_INVALID', error.message);
        }
        return recordTestAssets(loaded, checked, materialized.assets, {
          source: {
            kind: 'native-codex-subagent',
            role: 'test-designer',
            worktree: path.relative(root, worktree).replace(/\\/g, '/'),
            branch: prepared.branch,
            baseCommit: prepared.baseCommit,
            commit: head,
            manifestHash: materialized.manifestHash,
            runner: materialized.runner,
          },
        });
      }),
    replaceTests: (args = {}) =>
      protect(async () => {
        const loaded = await current(args, ['TESTING'], ['expectedVersion', 'assets', 'reason']);
        if (!loaded.ok) return loaded;
        const checked = await inspect();
        if (!checked.ok) return checked;
        if (typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 2048)
          return failure('INVALID_ARGUMENT', 'A bounded Test Agent replacement reason is required');
        if (!validateAssets(args.assets, checked.plan.graph))
          return failure(
            'TEST_ASSETS_INVALID',
            'Replacement test assets need valid AC mappings, code, fixtures and coverage',
          );
        const version = checked.ref.tests.version + 1;
        const files = {
          ...args.assets.code,
          ...args.assets.fixtures,
          'cases.json': canonicalJson(args.assets.cases) + '\n',
          'cases.md':
            '# Frozen test cases\n\n' +
            args.assets.cases
              .map(
                (entry) =>
                  `## ${entry.id}\n\n${entry.description}\n\nAC: ${entry.acIds.join(', ')}\nCode: ${entry.codeFiles.join(', ')}\n`,
              )
              .join('\n'),
        };
        if (
          ['cases.json', 'cases.md'].some(
            (relative) =>
              Object.hasOwn(args.assets.code, relative) ||
              Object.hasOwn(args.assets.fixtures, relative),
          )
        )
          return failure(
            'TEST_ASSETS_INVALID',
            'cases.json and cases.md are reserved for the frozen case index',
          );
        const body = {
          schemaVersion: 1,
          kind: 'tests',
          version,
          requirementsHash: checked.plan.requirementsHash,
          planHash: checked.ref.hash,
          contractHash: checked.ref.contract.hash,
          modelHash: checked.ref.model.hash,
          role: 'test',
          coverage: args.assets.coverage,
          cases: args.assets.cases,
          replacement: {
            reason: args.reason.trim(),
            previousHash: checked.ref.tests.hash,
            previousPath: checked.ref.tests.path,
            requestedAt: new Date().toISOString(),
          },
          files: Object.fromEntries(
            Object.entries(files).map(([relative, content]) => [relative, digest(content)]),
          ),
        };
        const directory = `.specgate/codex/changes/${loaded.state.changeId}/tests/v${version}-${hashValue(body)}`;
        for (const [relative, content] of Object.entries(files))
          immutable(directory + '/' + relative, content);
        const tests = { ...freeze(directory, 'manifest', body), directory };
        const development = object(loaded.state.context?.development)
          ? {
              ...loaded.state.context.development,
              testsHash: tests.hash,
              controlledReplacements: [
                ...(loaded.state.context.development.controlledReplacements || []),
                {
                  previousHash: checked.ref.tests.hash,
                  hash: tests.hash,
                  reason: args.reason.trim(),
                  at: new Date().toISOString(),
                },
              ],
            }
          : loaded.state.context?.development;
        const saved = await store.update({
          expectedVersion: loaded.state.version,
          patch: {
            context: {
              plan: { ...checked.ref, tests },
              ...(development ? { development } : {}),
            },
          },
        });
        if (!saved.ok) return saved;
        const event = await store.recordEvent({
          expectedVersion: saved.state.version,
          type: 'test.assets.replaced',
          payload: {
            previousHash: checked.ref.tests.hash,
            hash: tests.hash,
            reason: args.reason.trim(),
          },
        });
        return event.ok ? { ...event, tests: body } : event;
      }),
    checkDevelopmentReady: () =>
      protect(async () => {
        const checked = await inspect();
        if (!checked.ok) return checked;
        if (checked.state.phase !== 'TEST_CASES_FROZEN' || !checked.ref.tests)
          return failure('TEST_FREEZE_REQUIRED', 'Freeze all Test role assets before development');
        return failure(
          'RED_EVIDENCE_REQUIRED',
          'A real failing baseline command, exit result, logs and failed test mapping are required; this core has no red runner',
        );
      }),
    beginDevelopment: (args = {}) =>
      protect(async () => {
        const loaded = await current(args, ['TEST_CASES_FROZEN']);
        if (!loaded.ok) return loaded;
        const checked = await inspect();
        if (!checked.ok) return checked;
        return failure(
          'RED_EVIDENCE_REQUIRED',
          'Development is disabled until a real failing baseline runner is integrated',
        );
      }),
  });
}
