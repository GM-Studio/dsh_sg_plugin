import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalJson, hashValue } from './events.js';
import { frontendFrameworkViolation, readProjectConventions } from './project-conventions.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ROLES = Object.freeze(['frontend', 'backend', 'integration', 'test', 'review', 'format']);
const DEVELOPMENT_ROLES = Object.freeze(['frontend', 'backend']);
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/.test(value);
const digest = (value) => 'sha256:' + hashValue(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
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

function bounded(value, maximum = 4096) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function redact(value) {
  return String(value ?? '')
    .replace(
      /\b(password|passwd|secret|token|authorization|api[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi,
      '$1$2[REDACTED]',
    )
    .slice(0, MAX_OUTPUT_BYTES);
}

function errorText(error) {
  return redact(error?.stderr || error?.stdout || error?.message || error);
}

function runGit(root, args, environment) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...(environment || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 60000,
  }).trim();
}

const COMMIT_ENV = {
  GIT_AUTHOR_NAME: 'SpecGate Codex',
  GIT_AUTHOR_EMAIL: 'specgate-codex@localhost',
  GIT_COMMITTER_NAME: 'SpecGate Codex',
  GIT_COMMITTER_EMAIL: 'specgate-codex@localhost',
};

function ensureDirectory(root, target) {
  const relative = path.relative(root, target);
  if (!inside(root, target)) fail('UNSAFE_PATH', 'A development path escaped its project');
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      fs.mkdirSync(current, 0o700);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail('UNSAFE_PATH', 'A development directory contains an unsafe path');
  }
}

function inspectFile(root, relative, maximum = 4 * 1024 * 1024) {
  if (!safeRelative(relative)) fail('UNSAFE_PATH', 'A development artifact path is unsafe');
  const target = path.resolve(root, relative);
  if (!inside(root, target)) fail('UNSAFE_PATH', 'A development artifact escaped its project');
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail('UNSAFE_PATH', 'A development artifact is a symlink');
    if (current === target) {
      if (!stat.isFile() || stat.nlink > 1 || stat.size > maximum)
        fail('UNSAFE_PATH', 'A development artifact is unsafe or oversized');
    } else if (!stat.isDirectory()) {
      fail('UNSAFE_PATH', 'A development artifact parent is unsafe');
    }
  }
  return target;
}

function readFile(root, relative, maximum) {
  return fs.readFileSync(inspectFile(root, relative, maximum), 'utf8');
}

function readJson(root, relative) {
  try {
    return JSON.parse(readFile(root, relative));
  } catch (error) {
    if (error.code === 'UNSAFE_PATH') throw error;
    fail('DEVELOPMENT_ARTIFACT_INVALID', 'A frozen development artifact is unreadable');
  }
}

function writeEvidence(root, relative, content) {
  if (!safeRelative(relative) || Buffer.byteLength(content) > MAX_OUTPUT_BYTES)
    fail('UNSAFE_PATH', 'A development evidence path or payload is unsafe');
  const target = path.resolve(root, relative);
  ensureDirectory(root, path.dirname(target));
  let fd;
  try {
    fd = fs.openSync(target, 'wx', 0o600);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return target;
}

function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => {
      try {
        child.kill();
      } catch {
        // The process already exited.
      }
    });
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      // The process already exited.
    }
  }
}

function runProcess(specification, { signal, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, code: 'CANCELLED', stdout: '', stderr: '', exitCode: null });
      return;
    }
    const child = spawn(specification.command, specification.args, {
      cwd: specification.cwd,
      env: { ...process.env, ...(specification.env || {}) },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let reason = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ ...result, stdout: redact(stdout), stderr: redact(stderr) });
    };
    const stop = (code) => {
      if (!reason) reason = code;
      terminate(child);
    };
    const abort = () => stop('CANCELLED');
    const timer = setTimeout(() => stop('COMMAND_TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) stop('OUTPUT_LIMIT');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) stop('OUTPUT_LIMIT');
    });
    child.on('error', (error) => {
      finish({
        ok: false,
        code: reason || 'COMMAND_START_FAILED',
        message: redact(error.message),
        exitCode: null,
      });
    });
    child.on('close', (exitCode, exitSignal) => {
      finish({
        ok: !reason && exitCode !== null,
        code: reason || (exitCode === null ? 'COMMAND_FAILED' : null),
        exitCode,
        exitSignal,
      });
    });
  });
}

function validateCommand(root, value) {
  if (
    !object(value) ||
    typeof value.command !== 'string' ||
    !path.isAbsolute(value.command) ||
    !Array.isArray(value.args) ||
    value.args.length > 64 ||
    value.args.some((arg) => typeof arg !== 'string' || arg.length > 16384)
  )
    fail(
      'RED_RUNNER_INVALID',
      'The server Test provider must return an absolute command and bounded arguments',
    );
  const cwd = path.resolve(root, value.cwd || '.');
  if (!inside(root, cwd) || !fs.lstatSync(cwd).isDirectory())
    fail('RED_RUNNER_INVALID', 'The red baseline cwd must be an ordinary project directory');
  if (
    value.env !== undefined &&
    (!object(value.env) ||
      Object.entries(value.env).some(
        ([key, entry]) =>
          !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) ||
          !['string', 'number', 'boolean'].includes(typeof entry) ||
          String(entry).length > 8192,
      ))
  )
    fail('RED_RUNNER_INVALID', 'The red baseline environment is invalid');
  return {
    command: value.command,
    args: [...value.args],
    cwd,
    env: Object.fromEntries(
      Object.entries(value.env || {}).map(([key, entry]) => [key, String(entry)]),
    ),
    reportPath: value.reportPath,
  };
}

function parseChangedFiles(root, base, head) {
  const output = runGit(root, ['diff', '--name-status', '--no-renames', `${base}..${head}`]);
  if (!output) return [];
  return output.split('\n').map((line) => {
    const [status, ...parts] = line.split('\t');
    return { status, path: parts.at(-1) };
  });
}

function isTestPath(filePath) {
  return (
    filePath.startsWith('.specgate/') ||
    /(^|\/)(?:test|tests|__tests__)\//i.test(filePath) ||
    /\.(?:test|spec)\.[^/]+$/i.test(filePath)
  );
}

function defaultRolePolicy(role, filePath) {
  const prefix = role === 'frontend' ? 'frontend/' : role === 'backend' ? 'backend/' : null;
  if (!prefix || !filePath.startsWith(prefix))
    return {
      ok: false,
      reason: `${role} may only change files below ${prefix}`,
    };
  if (isTestPath(filePath))
    return { ok: false, reason: `${role} cannot change frozen or product test files` };
  return { ok: true };
}

function worktreeList(root) {
  const output = runGit(root, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: path.resolve(line.slice(9)) };
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice(5);
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice(7);
    }
  }
  if (current) entries.push(current);
  return entries;
}

function createWorktree(root, changeId, role, freezeCommit, round = null) {
  const relative = round
    ? `.specgate/codex/worktrees/${changeId}/round-${round}/${role}`
    : `.specgate/codex/worktrees/${changeId}/${role}`;
  const target = path.join(root, relative);
  const branch = round
    ? `sg/codex/${changeId}/round-${round}/${role}`
    : `sg/codex/${changeId}/${role}`;
  const registered = worktreeList(root);
  const existing = registered.find((entry) => {
    if (!fs.existsSync(entry.path)) return false;
    try {
      return fs.realpathSync(entry.path) === fs.realpathSync(target);
    } catch {
      return false;
    }
  });
  if (existing) {
    if (existing.branch !== `refs/heads/${branch}`)
      fail('WORKTREE_BROKEN', 'A registered worktree is attached to the wrong branch');
    if (runGit(target, ['rev-parse', '--abbrev-ref', 'HEAD']) !== branch)
      fail('WORKTREE_BROKEN', 'A registered worktree branch cannot be verified');
    return { role, path: target, branch, reused: true };
  }
  if (fs.existsSync(target))
    fail('WORKTREE_BROKEN', 'A worktree directory exists without a matching registration');
  try {
    runGit(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    fail('WORKTREE_BRANCH_EXISTS', 'A stale role branch already exists');
  } catch (error) {
    if (error.code === 'WORKTREE_BRANCH_EXISTS') throw error;
  }
  ensureDirectory(root, path.dirname(target));
  try {
    runGit(root, ['worktree', 'add', '-b', branch, target, freezeCommit]);
  } catch (error) {
    fail('WORKTREE_CREATE_FAILED', errorText(error));
  }
  if (runGit(target, ['rev-parse', 'HEAD']) !== freezeCommit)
    fail('WORKTREE_BROKEN', 'A new role worktree did not start from the freeze commit');
  return { role, path: target, branch, reused: false };
}

export function createPrecompletedRoleProvider() {
  return async (role) => ({
    ok: true,
    precompleted: true,
    summary: `${role} completed by a native Codex subagent`,
  });
}

function cleanWorktree(worktree, label) {
  const status = runGit(worktree, ['status', '--porcelain', '--untracked-files=all']);
  if (status) fail('WORKTREE_DIRTY', `${label} contains uncommitted changes`);
}

function ensureFreezeCommit(root, checked, redEvidence) {
  cleanWorktree(root, 'The main worktree');
  const head = runGit(root, ['rev-parse', 'HEAD']);
  const message = [
    'SpecGate Codex frozen development baseline',
    `change: ${checked.state.changeId}`,
    `requirements: ${checked.ref.hash}`,
    `contract: ${checked.ref.contract.hash}`,
    `model: ${checked.ref.model.hash}`,
    `tests: ${checked.ref.tests.hash}`,
    `red: ${redEvidence.hash}`,
  ].join('\n');
  return runGit(root, ['commit-tree', `${head}^{tree}`, '-p', head, '-m', message], COMMIT_ENV);
}

function validateRedReport(root, specification, cases) {
  if (!safeRelative(specification.reportPath))
    fail('RED_RUNNER_INVALID', 'The red baseline must declare a safe JSON report path');
  let report;
  try {
    report = JSON.parse(readFile(root, specification.reportPath));
  } catch (error) {
    if (error.code === 'UNSAFE_PATH') throw error;
    fail('RED_REPORT_INVALID', 'The red baseline did not produce a readable JSON report');
  }
  if (!Array.isArray(report?.cases))
    fail('RED_REPORT_INVALID', 'The red baseline report has no case results');
  const expected = new Map(cases.map((entry) => [entry.id, entry]));
  const seen = new Map();
  for (const result of report.cases) {
    if (
      !object(result) ||
      !identifier(result.id) ||
      !['pass', 'fail', 'skip'].includes(result.status) ||
      !expected.has(result.id) ||
      seen.has(result.id)
    )
      fail('RED_REPORT_INVALID', 'The red baseline report contains unknown or duplicate cases');
    seen.set(result.id, result.status);
  }
  if (seen.size !== expected.size || [...expected.keys()].some((id) => seen.get(id) !== 'fail'))
    fail(
      'RED_REPORT_INVALID',
      'Every frozen case must be observed as failing before development starts',
    );
  return report;
}

function artifactDetails(root, checked) {
  const tests = readJson(root, checked.ref.tests.path);
  if (
    !Array.isArray(tests.cases) ||
    !tests.cases.length ||
    tests.cases.some((entry) => !identifier(entry?.id))
  )
    fail('DEVELOPMENT_ARTIFACT_INVALID', 'Frozen test cases are invalid');
  return {
    contract: readJson(root, checked.ref.contract.path),
    model: readJson(root, checked.ref.model.path),
    tests,
  };
}

async function redBaseline({ root, checked, redRunner, signal, timeoutMs }) {
  if (typeof redRunner !== 'function')
    return failure(
      'RED_RUNNER_UNAVAILABLE',
      'A server-owned Test role baseline runner is required before development',
    );
  const details = artifactDetails(root, checked);
  let proposed;
  try {
    proposed = await redRunner({
      operation: 'run-red-baseline',
      changeId: checked.state.changeId,
      plan: checked.plan,
      contract: details.contract,
      model: details.model,
      tests: details.tests,
    });
  } catch (error) {
    return failure(error.code || 'RED_RUNNER_FAILED', errorText(error));
  }
  let specification;
  try {
    specification = validateCommand(root, proposed);
  } catch (error) {
    return failure(error.code || 'RED_RUNNER_INVALID', error.message);
  }
  const run = await runProcess(specification, { signal, timeoutMs });
  if (!run.ok && run.code === 'CANCELLED')
    return failure('CANCELLED', 'Red baseline execution was cancelled');
  if (run.code === 'COMMAND_TIMEOUT')
    return failure('RED_BASELINE_TIMEOUT', 'The red baseline command exceeded its time limit');
  if (run.code === 'OUTPUT_LIMIT')
    return failure(
      'RED_BASELINE_OUTPUT_LIMIT',
      'The red baseline command produced too much output',
    );
  if (!run.ok)
    return failure(run.code || 'RED_BASELINE_FAILED', run.message || 'Red baseline did not run');
  if (run.exitCode === 0)
    return failure(
      'RED_BASELINE_NOT_FAILING',
      'The frozen tests passed before implementation; strict TDD requires an observed failure',
    );
  let report;
  try {
    report = validateRedReport(root, specification, details.tests.cases);
  } catch (error) {
    return failure(error.code || 'RED_REPORT_INVALID', error.message);
  }
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const directory = `.specgate/codex/changes/${checked.state.changeId}/red/${runId}`;
  const stdoutPath = `${directory}/stdout.log`;
  const stderrPath = `${directory}/stderr.log`;
  const reportPath = `${directory}/report.json`;
  writeEvidence(root, stdoutPath, run.stdout + '\n');
  writeEvidence(root, stderrPath, run.stderr + '\n');
  writeEvidence(root, reportPath, canonicalJson(report) + '\n');
  const evidence = {
    schemaVersion: 1,
    kind: 'codex-red-baseline',
    changeId: checked.state.changeId,
    planHash: checked.ref.hash,
    testsHash: checked.ref.tests.hash,
    command: specification.command,
    args: specification.args,
    cwd: path.relative(root, specification.cwd).replace(/\\/g, '/') || '.',
    exitCode: run.exitCode,
    observedAt: new Date().toISOString(),
    cases: report.cases,
    logs: { stdout: stdoutPath, stderr: stderrPath, report: reportPath },
  };
  const evidencePath = `${directory}/evidence.json`;
  writeEvidence(root, evidencePath, canonicalJson(evidence) + '\n');
  return {
    ok: true,
    path: evidencePath,
    hash: digest(evidence),
    exitCode: run.exitCode,
    cases: report.cases,
  };
}

export function createDevelopmentService({
  projectRoot,
  store,
  planService,
  redRunner,
  roleProvider,
  rolePolicy = defaultRolePolicy,
  timeoutMs = COMMAND_TIMEOUT_MS,
} = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot)
    throw new TypeError('projectRoot is required');
  if (!store || typeof store.inspect !== 'function')
    throw new TypeError('A server state store is required');
  if (!planService || typeof planService.inspect !== 'function')
    throw new TypeError('A server plan service is required');
  if (typeof rolePolicy !== 'function') throw new TypeError('rolePolicy must be a function');
  const root = fs.realpathSync(projectRoot);
  const safeRoot = !inside(SOURCE_ROOT, root) && !inside(root, SOURCE_ROOT);
  const protect = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      return failure(error.code || 'DEVELOPMENT_FAILED', errorText(error));
    }
  };

  async function current(args, phases) {
    if (!safeRoot)
      return failure(
        'SOURCE_REPOSITORY_FORBIDDEN',
        'The plugin repository cannot host product development worktrees',
      );
    if (
      !object(args) ||
      Object.keys(args).some((key) => key !== 'expectedVersion') ||
      !Number.isSafeInteger(args.expectedVersion) ||
      args.expectedVersion < 0
    )
      return failure('INVALID_ARGUMENT', 'Only a nonnegative expectedVersion is accepted');
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
        'This phase cannot perform the requested development operation',
      );
    return loaded;
  }

  async function checkedPlan() {
    const checked = await planService.inspect();
    if (!checked.ok) return checked;
    if (!checked.ref.contract || !checked.ref.model || !checked.ref.tests)
      return failure(
        'TEST_FREEZE_REQUIRED',
        'Contract, model and executable tests must be frozen before development',
      );
    artifactDetails(root, checked);
    return checked;
  }

  async function saveDevelopment(patch, expectedVersion) {
    const loaded = await store.inspect();
    if (!loaded.ok) return loaded;
    if (expectedVersion !== undefined && loaded.state.version !== expectedVersion)
      return {
        ...failure('VERSION_CONFLICT', 'Development state changed; inspect it before retrying'),
        actualVersion: loaded.state.version,
      };
    const previous = object(loaded.state.context?.development)
      ? loaded.state.context.development
      : {};
    if (!object(previous.worktrees) && !object(patch.worktrees))
      return failure('DEVELOPMENT_REQUIRED', 'Prepare fixed role worktrees first');
    const development = {
      ...previous,
      ...patch,
      roles: { ...previous.roles, ...(patch.roles || {}) },
    };
    const saved = await store.update({
      expectedVersion: loaded.state.version,
      patch: { context: { development } },
    });
    return saved.ok ? { ...saved, development } : saved;
  }

  async function prepare(args = {}, { signal } = {}) {
    return protect(async () => {
      const loaded = await current(args, ['TEST_CASES_FROZEN']);
      if (!loaded.ok) return loaded;
      const checked = await checkedPlan();
      if (!checked.ok) return checked;
      const red = await redBaseline({ root, checked, redRunner, signal, timeoutMs });
      if (!red.ok) return red;
      const afterRed = await store.inspect();
      if (!afterRed.ok) return afterRed;
      if (
        afterRed.state.version !== loaded.state.version ||
        afterRed.state.phase !== 'TEST_CASES_FROZEN'
      )
        return failure(
          'STORE_BUSY',
          'The change changed while the red baseline was running; inspect it before retrying',
        );
      const freezeCommit = ensureFreezeCommit(root, checked, red);
      const worktrees = {};
      for (const role of ROLES)
        worktrees[role] = createWorktree(root, checked.state.changeId, role, freezeCommit);
      const roles = Object.fromEntries(
        DEVELOPMENT_ROLES.map((role) => [
          role,
          {
            status: 'pending',
            attempts: 0,
            commit: freezeCommit,
            worktree: worktrees[role].path,
            branch: worktrees[role].branch,
          },
        ]),
      );
      const development = {
        schemaVersion: 1,
        changeId: checked.state.changeId,
        requirementsHash: checked.ref.hash,
        contractHash: checked.ref.contract.hash,
        modelHash: checked.ref.model.hash,
        testsHash: checked.ref.tests.hash,
        freezeCommit,
        red,
        worktrees,
        roles,
        rounds: [],
        merged: [],
        conflicts: [],
        preparedAt: new Date().toISOString(),
      };
      const saved = await saveDevelopment(development, loaded.state.version);
      if (!saved.ok) return saved;
      const moved = await store.transition({
        expectedVersion: saved.state.version,
        to: 'DEVELOPING',
      });
      return moved.ok ? { ...moved, development } : moved;
    });
  }

  async function runRole(role, development, challenge, { signal } = {}) {
    if (!DEVELOPMENT_ROLES.includes(role))
      return failure('INVALID_ARGUMENT', 'Unknown development role');
    if (typeof roleProvider !== 'function')
      return failure('ROLE_PROVIDER_UNAVAILABLE', 'A server-owned role provider is required');
    const record = development.roles[role];
    if (!object(record) || !object(development.worktrees[role]))
      return failure('DEVELOPMENT_REQUIRED', 'The role worktree is not registered');
    const worktree = record.worktree;
    if (!fs.existsSync(worktree))
      return failure('WORKTREE_MISSING', 'The role worktree no longer exists');
    cleanWorktree(worktree, `${role} worktree`);
    if (runGit(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']) !== record.branch)
      return failure('WORKTREE_BROKEN', 'The role worktree is on the wrong branch');
    const previousHead = runGit(worktree, ['rev-parse', 'HEAD']);
    const roleBaseCommit =
      Number.isInteger(development.round) &&
      Number.isInteger(development.reworkRound) &&
      development.reworkBaseCommit
        ? development.reworkBaseCommit
        : development.freezeCommit;
    let result;
    try {
      result = await roleProvider(role, {
        operation: challenge.operation,
        changeId: development.changeId,
        role,
        worktree,
        branch: record.branch,
        freezeCommit: development.freezeCommit,
        previousCommit: previousHead,
        graph: challenge.graph,
        contract: challenge.contract,
        model: challenge.model,
        conventions: challenge.conventions,
        tests: {
          hash: development.testsHash,
          cases: challenge.tests.cases,
        },
        ...(challenge.conflictPaths ? { conflictPaths: challenge.conflictPaths } : {}),
        ...(challenge.integrationBranch
          ? {
              integrationBranch: challenge.integrationBranch,
              integrationCommit: challenge.integrationCommit,
            }
          : {}),
      });
    } catch (error) {
      return failure(error.code || 'ROLE_PROVIDER_FAILED', errorText(error));
    }
    if (signal?.aborted) return failure('CANCELLED', 'Development was cancelled');
    if (!object(result) || result.ok !== true)
      return failure(
        result?.code || 'ROLE_PROVIDER_FAILED',
        bounded(result?.message || 'The role provider did not complete its task', 4096),
      );
    cleanWorktree(worktree, `${role} worktree`);
    const head = runGit(worktree, ['rev-parse', 'HEAD']);
    if (head === previousHead && result.precompleted !== true)
      return failure('NO_COMMIT', 'The role provider did not create a commit');
    if (result.precompleted === true) {
      if (head === roleBaseCommit)
        return failure('NO_COMMIT', 'The precompleted role branch has no freeze-following commit');
      try {
        runGit(root, ['merge-base', '--is-ancestor', roleBaseCommit, head]);
      } catch {
        return failure(
          'ROLE_COMMIT_INVALID',
          'The precompleted role commit is not descended from its role base commit',
        );
      }
    }
    const entries = parseChangedFiles(root, roleBaseCommit, head);
    if (!entries.length)
      return failure('NO_CHANGES', 'The role branch has no change against the freeze commit');
    const violations = [];
    const conventions = readProjectConventions({ projectRoot: root });
    const backendSourcePrefix =
      conventions.backendPackage && role === 'backend'
        ? `backend/src/main/java/${conventions.backendPackage.replace(/\./g, '/')}/`
        : null;
    for (const entry of entries) {
      if (isTestPath(entry.path)) {
        violations.push({ path: entry.path, reason: `${role} cannot change test assets` });
        continue;
      }
      let allowed;
      try {
        allowed = await rolePolicy(role, entry.path, {
          changeId: development.changeId,
          entry,
        });
      } catch {
        allowed = { ok: false, reason: 'The role path policy rejected this change' };
      }
      if (!object(allowed) || allowed.ok !== true)
        violations.push({
          path: entry.path,
          reason: bounded(allowed?.reason || 'Change is outside the role boundary', 1024),
        });
      if (
        backendSourcePrefix &&
        entry.status === 'A' &&
        /\.java$/i.test(entry.path) &&
        entry.path.startsWith('backend/src/main/java/') &&
        !entry.path.startsWith(backendSourcePrefix)
      )
        violations.push({
          path: entry.path,
          reason: `New Java source must use ${conventions.backendPackage}`,
        });
      if (entry.status === 'A' && entry.path.startsWith('backend/src/main/java/com/example/'))
        violations.push({
          path: entry.path,
          reason: 'New Java source cannot be added under com.example.*',
        });
      if (role === 'frontend') {
        const frameworkViolation = frontendFrameworkViolation(
          conventions.frontendFramework,
          entry.path,
        );
        if (frameworkViolation)
          violations.push({ path: entry.path, reason: frameworkViolation });
      }
    }
    if (violations.length)
      return failure(
        'ROLE_POLICY_VIOLATION',
        violations.map((entry) => `${entry.path}: ${entry.reason}`).join('; '),
        { violations },
      );
    return {
      ok: true,
      role,
      commit: head,
      summary: bounded(result.summary || `${role} completed`, 4096),
      files: entries.map((entry) => entry.path),
    };
  }

  async function retryRole(role, message) {
    const loaded = await store.inspect();
    if (!loaded.ok) return loaded;
    const retried = await store.retry({
      expectedVersion: loaded.state.version,
      taskId: role,
      category: 'development',
      error: bounded(message, 4096),
    });
    if (!retried.ok) return retried;
    return {
      ...retried,
      retryAllowed: retried.retryAllowed,
      blocked: !retried.retryAllowed,
    };
  }

  async function mergeOnce(development, role) {
    const integration = development.worktrees.integration;
    const branch = development.roles[role].branch;
    const expected = development.roles[role].commit;
    const actual = runGit(root, ['rev-parse', branch]);
    if (actual !== expected)
      return failure('HEAD_MISMATCH', 'The role branch moved after it was validated');
    if (runGit(integration.path, ['rev-parse', '--abbrev-ref', 'HEAD']) !== integration.branch)
      return failure('WORKTREE_BROKEN', 'The integration worktree is on the wrong branch');
    cleanWorktree(integration.path, 'The integration worktree');
    try {
      runGit(integration.path, ['merge', '--no-ff', '--no-commit', '-m', `merge ${role}`, branch]);
    } catch (error) {
      const conflictPaths = runGit(integration.path, ['diff', '--name-only', '--diff-filter=U'])
        .split('\n')
        .filter(Boolean);
      try {
        runGit(integration.path, ['merge', '--abort']);
      } catch {
        // Conflict state may already have been removed.
      }
      return failure('MERGE_CONFLICT', errorText(error), {
        conflictPaths,
      });
    }
    try {
      runGit(integration.path, ['commit', '-m', `merge ${role}`], COMMIT_ENV);
    } catch (error) {
      try {
        runGit(integration.path, ['merge', '--abort']);
      } catch {
        // Merge commit may not be in progress.
      }
      return failure('MERGE_COMMIT_FAILED', errorText(error));
    }
    return {
      ok: true,
      role,
      branch,
      commit: runGit(integration.path, ['rev-parse', 'HEAD']),
    };
  }

  async function mergeRole(development, role, challenge, { signal } = {}) {
    for (let retry = 0; retry < 4; retry++) {
      const merged = await mergeOnce(development, role);
      if (merged.ok) {
        const record = {
          role,
          branch: development.roles[role].branch,
          roleCommit: development.roles[role].commit,
          integrationCommit: merged.commit,
          mergedAt: new Date().toISOString(),
        };
        const nextDevelopment = {
          ...development,
          merged: [...(development.merged || []).filter((item) => item.role !== role), record],
        };
        const saved = await saveDevelopment({ merged: nextDevelopment.merged });
        if (!saved.ok) return saved;
        return { ...saved, development: saved.development };
      }
      if (merged.code !== 'MERGE_CONFLICT') return merged;
      if (signal?.aborted) return failure('CANCELLED', 'Development was cancelled');
      const conflict = {
        role,
        paths: merged.conflictPaths,
        occurredAt: new Date().toISOString(),
        retry: retry + 1,
        message: bounded(merged.message, 4096),
      };
      const conflictPath = `.specgate/codex/changes/${development.changeId}/conflicts/${Date.now()}-${randomUUID()}.json`;
      writeEvidence(root, conflictPath, canonicalJson(conflict) + '\n');
      const retried = await retryRole(role, `merge conflict: ${merged.message}`);
      if (!retried.ok) return retried;
      if (!retried.retryAllowed)
        return {
          ...failure(
            'WORKFLOW_BLOCKED',
            'Integration conflicts exceeded the shared automatic retry ceiling',
          ),
          state: retried.state,
          development: retried.state.context.development,
        };
      const integration = development.worktrees.integration;
      const resolved = await runRole(
        role,
        development,
        {
          ...challenge,
          operation: 'resolve-conflict',
          conflictPaths: merged.conflictPaths,
          integrationBranch: integration.branch,
          integrationCommit: runGit(integration.path, ['rev-parse', 'HEAD']),
        },
        { signal },
      );
      if (!resolved.ok) {
        const failed = await retryRole(role, resolved.message);
        if (!failed.ok) return failed;
        if (!failed.retryAllowed)
          return {
            ...failure('WORKFLOW_BLOCKED', 'Conflict resolution exceeded the retry ceiling'),
            state: failed.state,
            development: failed.state.context.development,
          };
        return failure('MERGE_CONFLICT', resolved.message, {
          development: failed.state.context.development,
          state: failed.state,
        });
      }
      const current = await store.inspect();
      if (!current.ok) return current;
      const roleRecord = {
        ...development.roles[role],
        status: 'resolved',
        attempts: (development.roles[role].attempts || 0) + retry + 1,
        commit: resolved.commit,
        summary: resolved.summary,
      };
      const saved = await saveDevelopment(
        {
          roles: { [role]: roleRecord },
          conflicts: [...(development.conflicts || []), { ...conflict, evidence: conflictPath }],
        },
        current.state.version,
      );
      if (!saved.ok) return saved;
      development = saved.development;
    }
    return failure('WORKFLOW_BLOCKED', 'Integration conflict retry loop exhausted');
  }

  async function run(args = {}, { signal } = {}) {
    return protect(async () => {
      const loaded = await current(args, ['DEVELOPING']);
      if (!loaded.ok) return loaded;
      let development = loaded.state.context?.development;
      if (!object(development) || !object(development.worktrees))
        return failure('DEVELOPMENT_REQUIRED', 'Prepare fixed role worktrees first');
      if (typeof roleProvider !== 'function')
        return failure('ROLE_PROVIDER_UNAVAILABLE', 'A server-owned role provider is required');
      const checked = await checkedPlan();
      if (!checked.ok) return checked;
      const details = artifactDetails(root, checked);
      const challenge = {
        graph: checked.plan.graph,
        contract: details.contract,
        model: details.model,
        tests: details.tests,
        conventions: readProjectConventions({ projectRoot: root }),
      };
      let pending = DEVELOPMENT_ROLES.filter(
        (role) => development.roles?.[role]?.status !== 'skipped',
      );
      const lastErrors = {};
      while (pending.length) {
        if (signal?.aborted) return failure('CANCELLED', 'Development was cancelled');
        const settled = [];
        for (const role of pending) {
          settled.push({
            role,
            result: await runRole(role, development, challenge, { signal }),
          });
        }
        const current = await store.inspect();
        if (!current.ok) return current;
        if (current.state.phase !== 'DEVELOPING')
          return failure(
            'INVALID_TRANSITION',
            'Development stopped while role providers were running',
            { state: current.state },
          );
        const roleChanges = {};
        const failures = [];
        for (const { role, result } of settled) {
          const previous = development.roles[role];
          if (result.ok) {
            roleChanges[role] = {
              ...previous,
              status: 'completed',
              attempts: (previous.attempts || 0) + 1,
              commit: result.commit,
              summary: result.summary,
              files: result.files,
            };
          } else {
            lastErrors[role] = result;
            roleChanges[role] = {
              ...previous,
              status: 'failed',
              attempts: (previous.attempts || 0) + 1,
              error: bounded(`${result.code}: ${result.message}`, 4096),
            };
            failures.push({ role, result });
          }
        }
        const saved = await saveDevelopment(
          {
            roles: roleChanges,
            rounds: [
              ...(development.rounds || []),
              {
                at: new Date().toISOString(),
                results: settled.map(({ role, result }) => ({
                  role,
                  ok: result.ok,
                  code: result.code || null,
                  commit: result.commit || null,
                  files: result.files || [],
                })),
              },
            ],
          },
          current.state.version,
        );
        if (!saved.ok) return saved;
        development = saved.development;
        if (!failures.length) break;
        for (const failureEntry of failures) {
          const retried = await retryRole(
            failureEntry.role,
            `${failureEntry.result.code}: ${failureEntry.result.message}`,
          );
          if (!retried.ok) return retried;
          if (!retried.retryAllowed)
            return {
              ...failure(
                'WORKFLOW_BLOCKED',
                `The ${failureEntry.role} task exceeded the shared automatic retry ceiling`,
              ),
              state: retried.state,
              development: retried.state.context.development,
              errors: lastErrors,
            };
        }
        pending = failures.map((entry) => entry.role);
      }

      const intact = await checkedPlan();
      if (!intact.ok)
        return {
          ...failure(
            'TEST_ASSETS_CHANGED',
            'Frozen contracts, models or tests changed during development',
          ),
          state: (await store.inspect()).state,
          development,
        };
      const beforeIntegration = await store.inspect();
      if (!beforeIntegration.ok) return beforeIntegration;
      if (beforeIntegration.state.phase !== 'DEVELOPING')
        return failure('INVALID_TRANSITION', 'Development left its writable phase');
      const integrating = await store.transition({
        expectedVersion: beforeIntegration.state.version,
        to: 'INTEGRATING',
      });
      if (!integrating.ok) return integrating;
      development = integrating.state.context.development;
      for (const role of DEVELOPMENT_ROLES.filter(
        (entry) => development.roles?.[entry]?.status !== 'skipped',
      )) {
        const merged = await mergeRole(development, role, challenge, { signal });
        if (!merged.ok) return { ...merged, development: merged.development || development };
        development = merged.development;
      }
      const final = await store.inspect();
      if (!final.ok) return final;
      const tested = await store.transition({
        expectedVersion: final.state.version,
        to: 'TESTING',
      });
      return tested.ok ? { ...tested, development: tested.state.context.development } : tested;
    });
  }

  async function prepareRound(
    args,
    { phase, findings, source, eventKey, activeRoles = DEVELOPMENT_ROLES },
  ) {
    return protect(async () => {
      const loaded = await current(args, [phase]);
      if (!loaded.ok) return loaded;
      const checked = await checkedPlan();
      if (!checked.ok) return checked;
      if (!Array.isArray(findings) || !findings.length)
        return failure('REPAIR_NOT_REQUIRED', `${source} has no blocking findings`);
      const previous = loaded.state.context?.development;
      if (!object(previous) || !object(previous.worktrees))
        return failure('DEVELOPMENT_REQUIRED', 'Development worktrees are unavailable');
      const integration = previous.worktrees.integration;
      if (!object(integration) || !fs.existsSync(integration.path))
        return failure('WORKTREE_MISSING', 'The integration worktree is unavailable');
      cleanWorktree(integration.path, 'The integration worktree');
      if (runGit(integration.path, ['rev-parse', '--abbrev-ref', 'HEAD']) !== integration.branch)
        return failure('WORKTREE_BROKEN', 'The integration worktree changed branch');
      const repairBaseCommit = runGit(integration.path, ['rev-parse', 'HEAD']);
      const round = (Number.isInteger(previous.reworkRound) ? previous.reworkRound : 0) + 1;
      const worktrees = { ...previous.worktrees };
      const history = Array.isArray(previous.history) ? [...previous.history] : [];
      history.push({
        round: Number.isInteger(previous.reworkRound) ? previous.reworkRound : 0,
        worktrees: Object.fromEntries(
          ['frontend', 'backend', 'format'].map((role) => [role, previous.worktrees[role]]),
        ),
        source: eventKey,
        findings,
        recordedAt: new Date().toISOString(),
      });
      const rolesToCreate = [...new Set([...activeRoles, 'format'])];
      for (const role of rolesToCreate)
        worktrees[role] = createWorktree(
          root,
          loaded.state.changeId,
          role,
          repairBaseCommit,
          round,
        );
      const roles = Object.fromEntries(
        DEVELOPMENT_ROLES.map((role) => [
          role,
          activeRoles.includes(role)
            ? {
                status: 'pending',
                attempts: 0,
                commit: repairBaseCommit,
                worktree: worktrees[role].path,
                branch: worktrees[role].branch,
              }
            : {
                ...(previous.roles?.[role] || {}),
                status: 'skipped',
                worktree: worktrees[role]?.path || null,
                branch: worktrees[role]?.branch || null,
              },
        ]),
      );
      const reworkPatch = JSON.parse(
        JSON.stringify({
          worktrees,
          roles,
          rounds: [],
          merged: [],
          conflicts: [],
          round,
          reworkRound: round,
          repairBaseCommit,
          reworkBaseCommit: repairBaseCommit,
          repairFindings: findings,
          reworkFindings: findings,
          history,
        }),
      );
      const saved = await saveDevelopment(reworkPatch, loaded.state.version);
      if (!saved.ok) return saved;
      const moved = await store.transition({
        expectedVersion: saved.state.version,
        to: 'DEVELOPING',
      });
      return moved.ok
        ? {
            ...moved,
            development: moved.state.context.development,
            [eventKey]: {
              round,
              baseCommit: repairBaseCommit,
              findings,
              worktrees: {
                frontend: worktrees.frontend,
                backend: worktrees.backend,
                format: worktrees.format,
              },
            },
          }
        : moved;
    });
  }

  async function prepareRework(args = {}) {
    const loaded = await store.inspect();
    if (!loaded.ok) return loaded;
    const blocking = Array.isArray(loaded.state.context?.review?.blocking)
      ? loaded.state.context.review.blocking
      : [];
    if (loaded.state.context?.review?.status !== 'failed' || !blocking.length)
      return failure('REWORK_NOT_REQUIRED', 'Review has no blocking findings to rework');
    return prepareRound(args, {
      phase: 'REVIEWING',
      findings: blocking,
      source: 'review',
      eventKey: 'rework',
    });
  }

  async function prepareRepair(args = {}) {
    const loaded = await store.inspect();
    if (!loaded.ok) return loaded;
    const defects = Array.isArray(loaded.state.context?.quality?.defects)
      ? loaded.state.context.quality.defects
      : [];
    if (loaded.state.context?.quality?.status !== 'failed' || !defects.length)
      return failure('REPAIR_NOT_REQUIRED', 'Quality has no failing defects to repair');
    const declaredOwners = defects
      .flatMap((defect) => (Array.isArray(defect.owners) ? defect.owners : []))
      .filter((role) => DEVELOPMENT_ROLES.includes(role));
    const messageText = defects.map((defect) => defect.message || '').join('\n');
    const activeRoles = declaredOwners.length
      ? declaredOwners
      : /frontend/i.test(messageText)
        ? ['frontend']
        : /backend/i.test(messageText)
          ? ['backend']
          : [...DEVELOPMENT_ROLES];
    return prepareRound(args, {
      phase: 'TESTING',
      findings: defects,
      source: 'quality',
      eventKey: 'repair',
      activeRoles: [...new Set(activeRoles)],
    });
  }

  async function inspect() {
    return protect(async () => {
      if (!safeRoot)
        return failure(
          'SOURCE_REPOSITORY_FORBIDDEN',
          'The plugin repository cannot host product development worktrees',
        );
      const loaded = await store.inspect();
      if (!loaded.ok) return loaded;
      const checked = await checkedPlan();
      if (!checked.ok) return checked;
      const development = loaded.state.context?.development;
      if (!object(development) || !object(development.worktrees))
        return failure('DEVELOPMENT_REQUIRED', 'Prepare fixed role worktrees first');
      const evidence = readJson(root, development.red.path);
      if (digest(evidence) !== development.red.hash)
        return failure('DEVELOPMENT_EVIDENCE_CHANGED', 'Red baseline evidence was modified');
      const worktrees = {};
      const integrationCommit = development.merged?.at(-1)?.integrationCommit;
      for (const role of ROLES) {
        const entry = development.worktrees[role];
        if (!object(entry) || !fs.existsSync(entry.path))
          return failure('WORKTREE_MISSING', `The ${role} worktree no longer exists`);
        const branch = runGit(entry.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const head = runGit(entry.path, ['rev-parse', 'HEAD']);
        const detachedAtIntegration =
          (role === 'test' || role === 'review') && branch === 'HEAD' && head === integrationCommit;
        if (branch !== entry.branch && !detachedAtIntegration)
          return failure('WORKTREE_BROKEN', `The ${role} worktree branch changed`);
        worktrees[role] = {
          ...entry,
          head,
          clean:
            runGit(entry.path, ['status', '--porcelain', '--untracked-files=all']).length === 0,
        };
      }
      return {
        ok: true,
        state: loaded.state,
        development: { ...development, worktrees },
      };
    });
  }

  return Object.freeze({ prepare, prepareRework, prepareRepair, run, inspect });
}
