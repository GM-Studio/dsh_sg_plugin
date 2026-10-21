import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalJson, hashValue } from './events.js';
import { verifyProject } from './verify.js';
import { VERIFY_STAGES } from '../v4/verify-evidence.js';
import { commandSpec } from '../v4/verify-evidence.js';
import { reconcileCoverage } from '../v4/coverage-evidence.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const EXPECTED_STAGES = Object.freeze([...VERIFY_STAGES, 'frontend-runtime']);
const MAX_LOG_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
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

function redact(value) {
  return String(value ?? '')
    .replace(
      /\b(password|passwd|secret|token|authorization|api[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi,
      '$1$2[REDACTED]',
    )
    .slice(0, MAX_LOG_BYTES);
}

function errorText(error) {
  return redact(error?.stderr || error?.stdout || error?.message || error);
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 60000,
  }).trim();
}

function ensureDirectory(root, target) {
  if (!inside(root, target)) fail('UNSAFE_PATH', 'Quality evidence escaped its project');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      fs.mkdirSync(current, 0o700);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail('UNSAFE_PATH', 'Quality evidence contains an unsafe directory');
  }
}

function readFile(root, relative, maximum = 8 * 1024 * 1024) {
  if (!safeRelative(relative)) fail('UNSAFE_PATH', 'Quality artifact path is unsafe');
  const target = path.resolve(root, relative);
  if (!inside(root, target)) fail('UNSAFE_PATH', 'Quality artifact escaped its project');
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail('UNSAFE_PATH', 'Quality artifact is a symlink');
    if (current === target) {
      if (!stat.isFile() || stat.nlink > 1 || stat.size > maximum)
        fail('UNSAFE_PATH', 'Quality artifact is unsafe or oversized');
    } else if (!stat.isDirectory()) {
      fail('UNSAFE_PATH', 'Quality artifact parent is unsafe');
    }
  }
  return fs.readFileSync(target, 'utf8');
}

function writeEvidence(root, relative, content) {
  if (!safeRelative(relative) || Buffer.byteLength(content) > MAX_LOG_BYTES * 2)
    fail('UNSAFE_PATH', 'Quality evidence path or content is unsafe');
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

function runCommand(specification, { signal, timeoutMs }) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    if (signal?.aborted) {
      resolve({
        ok: false,
        code: 'CANCELLED',
        stdout: '',
        stderr: '',
        exitCode: null,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
      });
      return;
    }
    let command;
    try {
      command = commandSpec(specification.command, specification.args);
    } catch (error) {
      resolve({
        ok: false,
        code: 'COMMAND_INVALID',
        message: error.message,
        stdout: '',
        stderr: '',
        exitCode: null,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
      });
      return;
    }
    const child = spawn(command.command, command.args, {
      cwd: specification.cwd,
      env: { ...process.env, ...(specification.env || {}) },
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: command.windowsVerbatimArguments,
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
      resolve({
        ...result,
        stdout: redact(stdout),
        stderr: redact(stderr),
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
      });
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
      if (Buffer.byteLength(stdout) > MAX_LOG_BYTES) stop('OUTPUT_LIMIT');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (Buffer.byteLength(stderr) > MAX_LOG_BYTES) stop('OUTPUT_LIMIT');
    });
    child.on('error', (error) => {
      finish({
        ok: false,
        code: reason || 'COMMAND_START_FAILED',
        message: error.message,
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

function validateRunner(root, value) {
  if (
    !object(value) ||
    typeof value.command !== 'string' ||
    !path.isAbsolute(value.command) ||
    !Array.isArray(value.args) ||
    value.args.length > 64 ||
    value.args.some((arg) => typeof arg !== 'string' || arg.length > 16384)
  )
    fail(
      'TEST_RUNNER_INVALID',
      'The Test provider must return an absolute command and bounded arguments',
    );
  const cwd = path.resolve(root, value.cwd || '.');
  if (!inside(root, cwd) || !fs.lstatSync(cwd).isDirectory())
    fail('TEST_RUNNER_INVALID', 'The Test command cwd must remain inside the test worktree');
  if (!safeRelative(value.reportPath) || !isTestPath(value.reportPath))
    fail('TEST_RUNNER_INVALID', 'The Test provider must declare a safe JSON report path');
  const env =
    value.env === undefined
      ? {}
      : object(value.env)
        ? Object.fromEntries(
            Object.entries(value.env).map(([key, entry]) => {
              if (
                !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) ||
                !['string', 'number', 'boolean'].includes(typeof entry) ||
                String(entry).length > 8192
              )
                fail('TEST_RUNNER_INVALID', 'The Test command environment is invalid');
              return [key, String(entry)];
            }),
          )
        : (() => fail('TEST_RUNNER_INVALID', 'The Test command environment is invalid'))();
  return {
    command: value.command,
    args: [...value.args],
    cwd,
    env,
    reportPath: value.reportPath,
  };
}

function isTestPath(filePath) {
  return (
    filePath.startsWith('.specgate/') ||
    /(^|\/)(?:test|tests|__tests__|fixtures)\//i.test(filePath) ||
    /\.(?:test|spec)\.[^/]+$/i.test(filePath)
  );
}

function changedTestWorktreePaths(worktree, integrationCommit) {
  const status = worktreeStatus(worktree);
  const paths = new Set();
  for (const entry of status) paths.add(entry.path);
  const tracked = git(worktree, ['diff', '--name-only', integrationCommit, '--']);
  for (const file of tracked.split('\n').filter(Boolean)) paths.add(file);
  return [...paths];
}

function worktreeStatus(worktree) {
  const output = git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (!output) return [];
  return output.split('\n').map((line) => ({
    status: line.slice(0, 2),
    path: line.slice(3).replace(/\\/g, '/'),
  }));
}

function validateCaseReport(root, reportPath, frozenCases, expected = 'pass') {
  let report;
  try {
    report = JSON.parse(readFile(root, reportPath));
  } catch (error) {
    if (error.code === 'UNSAFE_PATH') throw error;
    fail('FROZEN_CASE_REPORT_INVALID', 'The frozen test command produced no valid JSON report');
  }
  if (!Array.isArray(report?.cases))
    fail('FROZEN_CASE_REPORT_INVALID', 'The frozen test report has no case results');
  const expectedCases = new Map(frozenCases.map((entry) => [entry.id, entry]));
  const seen = new Map();
  for (const result of report.cases) {
    if (
      !object(result) ||
      !identifier(result.id) ||
      !['pass', 'fail', 'skip'].includes(result.status) ||
      !expectedCases.has(result.id) ||
      seen.has(result.id)
    )
      fail('FROZEN_CASE_REPORT_INVALID', 'Frozen test report contains unknown or duplicate cases');
    seen.set(result.id, result);
  }
  if (seen.size !== expectedCases.size)
    fail('FROZEN_CASE_RECONCILIATION_FAILED', 'Not every frozen case was executed');
  if (expected === 'pass' && [...seen.values()].some((entry) => entry.status !== 'pass'))
    fail('FROZEN_CASE_RECONCILIATION_FAILED', 'Every frozen case must pass without skips');
  return { report, cases: [...seen.values()] };
}

function coverageFileEntries(root, changedFiles) {
  const file = path.join(root, 'frontend/coverage/coverage-final.json');
  if (!fs.existsSync(file))
    fail('CHANGED_COVERAGE_UNAVAILABLE', 'Frontend coverage-final.json is required');
  let coverage;
  try {
    coverage = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail('CHANGED_COVERAGE_UNAVAILABLE', 'Frontend coverage-final.json is invalid');
  }
  const entries = Object.entries(coverage);
  const changed = changedFiles.filter((filePath) =>
    /^frontend\/.+\.(?:js|jsx|ts|tsx|vue)$/i.test(filePath),
  );
  let executable = 0;
  let covered = 0;
  let unavailable = 0;
  for (const changedFile of changed) {
    const normalized = changedFile.replace(/\\/g, '/');
    const match = entries.find(([key]) => {
      const candidate = path.resolve(key).replace(/\\/g, '/');
      return candidate.endsWith('/' + normalized) || candidate === normalized;
    });
    if (!match) {
      unavailable += 1;
      continue;
    }
    const [, data] = match;
    for (const [id, statement] of Object.entries(data?.statementMap || {})) {
      const line = statement?.start?.line;
      if (!Number.isSafeInteger(line)) continue;
      executable += 1;
      if (Number(data?.s?.[id]) > 0) covered += 1;
    }
  }
  return { executable, covered, unavailable, changed: changed.length };
}

function changedLineRanges(root, base, head) {
  const output = git(root, [
    'diff',
    '--unified=0',
    '--no-color',
    `${base}..${head}`,
    '--',
    'backend',
    'frontend',
  ]);
  const files = new Map();
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice(6);
      if (isTestPath(current)) current = null;
      else files.set(current, new Set());
      continue;
    }
    if (!current) continue;
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let index = 0; index < count; index++) files.get(current).add(start + index);
  }
  return files;
}

function isDeclarationOnlyJavaInterface(source) {
  if (typeof source !== 'string') return false;
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\r\n]*/g, ' ');
  const normalized = withoutComments
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
  const declaration =
    /\binterface\s+[A-Za-z_$][\w$]*(?:\s*<[^{}]*>)?(?:\s+extends\s+[^{}\r\n]+)?\s*\{/.exec(
      normalized,
    );
  if (!declaration) return false;
  const start = declaration.index + declaration[0].lastIndexOf('{');
  const end = normalized.lastIndexOf('}');
  if (end <= start) return false;
  return !/[{}]/.test(normalized.slice(start + 1, end));
}

function javaCoverage(root, changed) {
  const file = path.join(root, 'backend/target/site/jacoco/jacoco.xml');
  if (!fs.existsSync(file))
    return { executable: 0, covered: 0, unavailable: changed.size, changed: changed.size };
  const xml = fs.readFileSync(file, 'utf8');
  const byName = new Map();
  for (const packageMatch of xml.matchAll(/<package name="([^"]+)">([\s\S]*?)<\/package>/g)) {
    const packageName = packageMatch[1];
    for (const sourceMatch of packageMatch[2].matchAll(
      /<sourcefile name="([^"]+)">([\s\S]*?)<\/sourcefile>/g,
    )) {
      const relative = `backend/src/main/java/${packageName}/${sourceMatch[1]}`.replace(/\\/g, '/');
      byName.set(relative, sourceMatch[2]);
    }
  }
  let executable = 0;
  let covered = 0;
  let unavailable = 0;
  for (const [relative, lines] of changed) {
    if (!relative.endsWith('.java')) continue;
    let body = byName.get(relative);
    if (!body) {
      const basename = path.posix.basename(relative);
      const matches = [...byName.entries()].filter(
        ([candidate]) => path.posix.basename(candidate) === basename,
      );
      if (matches.length === 1) body = matches[0][1];
    }
    if (!body) {
      const sourceFile = path.join(root, relative);
      if (inside(root, sourceFile)) {
        try {
          if (isDeclarationOnlyJavaInterface(fs.readFileSync(sourceFile, 'utf8'))) continue;
        } catch {
          // An unreadable source file still has no verifiable executable coverage.
        }
      }
      unavailable += 1;
      continue;
    }
    for (const lineMatch of body.matchAll(/<line nr="(\d+)" mi="(\d+)" ci="(\d+)"/g)) {
      const line = Number(lineMatch[1]);
      if (!lines.has(line)) continue;
      executable += 1;
      if (Number(lineMatch[3]) > 0) covered += 1;
    }
  }
  return { executable, covered, unavailable, changed: changed.size };
}

export function computeChangedCoverage({ root, base, head }) {
  try {
    const changed = changedLineRanges(root, base, head);
    const backend = javaCoverage(root, changed);
    const frontend = coverageFileEntries(root, [...changed.keys()]);
    const executable = backend.executable + frontend.executable;
    const covered = backend.covered + frontend.covered;
    const unavailable = backend.unavailable + frontend.unavailable;
    const result = {
      ok: unavailable === 0 && executable > 0 && covered / executable >= 0.9,
      covered,
      executable,
      unavailable,
      rate: executable === 0 ? 0 : covered / executable,
      threshold: 0.9,
      sides: { backend, frontend },
    };
    return result.ok
      ? result
      : {
          ...result,
          code: 'CHANGED_COVERAGE_BELOW_THRESHOLD',
          message:
            unavailable > 0
              ? 'Changed production files have no executable coverage evidence'
              : `Changed-line coverage ${(result.rate * 100).toFixed(1)}% is below 90%`,
        };
  } catch (error) {
    return {
      ok: false,
      code: error.code || 'CHANGED_COVERAGE_UNAVAILABLE',
      message: errorText(error),
      rate: 0,
      covered: 0,
      executable: 0,
      unavailable: 1,
      threshold: 0.9,
    };
  }
}

function validateVerification(result) {
  if (!object(result) || result.ok !== true)
    return failure(result?.code || 'VERIFY_FAILED', result?.message || 'Verification failed');
  const report = result.report;
  if (
    !object(report) ||
    report.ok !== true ||
    report.v1Complete !== true ||
    report.status !== 'verified'
  )
    return failure('VERIFY_EVIDENCE_INCOMPLETE', 'Verification did not publish complete evidence');
  const stages = Array.isArray(report.stages) ? report.stages : [];
  for (const name of EXPECTED_STAGES) {
    const matches = stages.filter((stage) => stage.name === name);
    if (matches.length !== 1 || matches[0].status !== 0 || matches[0].fixture)
      return failure(
        'VERIFY_EVIDENCE_INCOMPLETE',
        `Verification stage is missing, failed or synthetic: ${name}`,
      );
  }
  if (
    !object(report.reconciliation) ||
    report.reconciliation.failed !== 0 ||
    report.reconciliation.notRun !== 0
  )
    return failure('VERIFY_EVIDENCE_INCOMPLETE', 'Verification reconciliation is incomplete');
  for (const name of ['backend-verify', 'frontend-test']) {
    const tests = stages.find((stage) => stage.name === name)?.tests;
    if (
      !object(tests) ||
      !Number.isSafeInteger(tests.total) ||
      tests.total < 1 ||
      tests.passed !== tests.total ||
      (tests.failed ?? 0) !== 0 ||
      (tests.skipped ?? 0) !== 0
    )
      return failure('VERIFY_EVIDENCE_INCOMPLETE', `Test evidence is incomplete: ${name}`);
  }
  return { ok: true, report };
}

export function createQualityService({
  projectRoot,
  store,
  planService,
  testRunner,
  verifier = verifyProject,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot)
    throw new TypeError('projectRoot is required');
  if (!store || typeof store.inspect !== 'function')
    throw new TypeError('A server state store is required');
  if (!planService || typeof planService.inspect !== 'function')
    throw new TypeError('A server plan service is required');
  if (typeof verifier !== 'function') throw new TypeError('verifier must be a function');
  const root = fs.realpathSync(projectRoot);
  const safeRoot = !inside(SOURCE_ROOT, root) && !inside(root, SOURCE_ROOT);
  const protect = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      return failure(error.code || 'QUALITY_FAILED', errorText(error));
    }
  };

  async function current(args, phases) {
    if (!safeRoot)
      return failure(
        'SOURCE_REPOSITORY_FORBIDDEN',
        'The plugin repository cannot host product quality verification',
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
      return failure('INVALID_TRANSITION', 'This phase cannot perform quality verification');
    return loaded;
  }

  function testWorktree(development) {
    const test = development?.worktrees?.test;
    const integration = development?.worktrees?.integration;
    if (
      !object(test) ||
      !object(integration) ||
      !fs.existsSync(test.path) ||
      !fs.existsSync(integration.path) ||
      !inside(root, test.path) ||
      !inside(root, integration.path)
    )
      fail('TEST_WORKTREE_MISSING', 'The fixed test or integration worktree is unavailable');
    return { test, integration };
  }

  function alignTestWorktree(test, integrationCommit) {
    const head = git(test.path, ['rev-parse', 'HEAD']);
    if (head !== integrationCommit) {
      if (git(test.path, ['status', '--porcelain', '--untracked-files=all']))
        fail('TEST_WORKTREE_DIRTY', 'The test worktree has changes before alignment');
      git(test.path, ['checkout', '--detach', integrationCommit]);
    }
    if (git(test.path, ['rev-parse', 'HEAD']) !== integrationCommit)
      fail('TEST_WORKTREE_MISMATCH', 'The test worktree is not on the integration commit');
  }

  function prepareVerificationMetadata(worktree) {
    for (const relative of ['.specgate/state.json', '.specgate/init-report.json']) {
      const source = path.join(root, relative);
      if (!fs.existsSync(source)) continue;
      const sourceStat = fs.lstatSync(source);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.nlink > 1)
        fail('UNSAFE_PATH', `Unsafe verification metadata source: ${relative}`);
      const target = path.join(worktree, relative);
      ensureDirectory(worktree, path.dirname(target));
      if (fs.existsSync(target)) {
        const targetStat = fs.lstatSync(target);
        if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.nlink > 1)
          fail('UNSAFE_PATH', `Unsafe verification metadata target: ${relative}`);
      }
      fs.copyFileSync(source, target);
    }
  }

  function frozenCases(checked) {
    let manifest;
    try {
      manifest = JSON.parse(readFile(root, checked.ref.tests.path));
    } catch (error) {
      if (error.code === 'UNSAFE_PATH') throw error;
      fail('FROZEN_CASE_REPORT_INVALID', 'Frozen test manifest is unreadable');
    }
    if (
      !Array.isArray(manifest.cases) ||
      !manifest.cases.length ||
      manifest.cases.some((entry) => !identifier(entry?.id))
    )
      fail('FROZEN_CASE_REPORT_INVALID', 'Frozen test case list is invalid');
    return manifest;
  }

  function evidenceLocation(changeId) {
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    return {
      runId,
      directory: `.specgate/codex/changes/${changeId}/quality/${runId}`,
    };
  }

  function defectForRunner(result, report) {
    const owners = new Set();
    for (const entry of report?.cases || []) {
      if (entry.status === 'pass') continue;
      const file = String(entry.file || '');
      if (file.startsWith('frontend/')) owners.add('frontend');
      else if (file.startsWith('backend/')) owners.add('backend');
    }
    return {
      id: `QUALITY-${result.runId}`,
      severity: 'P1',
      stage: 'frozen-cases',
      code: result.code || 'FROZEN_CASE_RECONCILIATION_FAILED',
      message: result.message || 'Frozen tests did not all pass',
      owners: [...owners],
    };
  }

  async function finishFailure({ development, run, code, message, defects, retryable = true }) {
    const current = await store.inspect();
    if (!current.ok) return current;
    const body = {
      ...run,
      status: 'failed',
      code,
      message,
      defects,
      p0: defects.filter((entry) => entry.severity === 'P0').length,
      p1: defects.filter((entry) => entry.severity === 'P1').length,
      checkedAt: new Date().toISOString(),
    };
    const summaryPath = `${run.directory}/report.json`;
    writeEvidence(root, summaryPath, canonicalJson(body) + '\n');
    const quality = {
      ...body,
      reportPath: summaryPath,
      hash: digest(body),
    };
    if (current.state.phase !== 'TESTING')
      return failure('CANCELLED', 'Quality verification stopped before publishing its result', {
        state: current.state,
        quality,
        defects,
        retryAllowed: false,
      });
    const saved = await store.update({
      expectedVersion: current.state.version,
      patch: { context: { quality } },
    });
    if (!saved.ok) return saved;
    if (!retryable)
      return failure(code, message, {
        state: saved.state,
        quality,
        defects,
        retryAllowed: false,
      });
    const retried = await store.retry({
      expectedVersion: saved.state.version,
      taskId: 'quality',
      category: 'test',
      error: `${code}: ${message}`,
    });
    if (!retried.ok) return retried;
    if (!retried.retryAllowed)
      return failure('WORKFLOW_BLOCKED', 'Quality failures exceeded the automatic retry ceiling', {
        state: retried.state,
        quality,
        defects,
        retryAllowed: false,
      });
    return failure(code, message, {
      state: retried.state,
      quality,
      defects,
      retryAllowed: true,
    });
  }

  async function run(args = {}, { signal } = {}) {
    return protect(async () => {
      const loaded = await current(args, ['TESTING']);
      if (!loaded.ok) return loaded;
      if (typeof testRunner !== 'function')
        return failure(
          'TEST_RUNNER_UNAVAILABLE',
          'A server-owned Test runner is required for quality verification',
        );
      const checked = await planService.inspect();
      if (!checked.ok) return checked;
      const development = loaded.state.context?.development;
      if (!object(development))
        return failure('DEVELOPMENT_REQUIRED', 'Development evidence is missing');
      const { test, integration } = testWorktree(development);
      const integrationCommit = git(integration.path, ['rev-parse', 'HEAD']);
      const lastMerge = development.merged?.at(-1)?.integrationCommit;
      if (!lastMerge || lastMerge !== integrationCommit)
        return failure(
          'INTEGRATION_EVIDENCE_INVALID',
          'Integration HEAD does not match the last recorded merge',
        );
      const manifest = frozenCases(checked);
      alignTestWorktree(test, integrationCommit);
      const evidence = evidenceLocation(loaded.state.changeId);
      const runEvidence = {
        schemaVersion: 1,
        changeId: loaded.state.changeId,
        integrationCommit,
        freezeCommit: development.freezeCommit,
        requirementsHash: checked.ref.hash,
        testsHash: checked.ref.tests.hash,
        startedAt: new Date().toISOString(),
        directory: evidence.directory,
        runId: evidence.runId,
      };
      const initialProductionChanges = changedTestWorktreePaths(
        test.path,
        integrationCommit,
      ).filter((file) => !isTestPath(file));
      if (initialProductionChanges.length)
        return failure(
          'TEST_WORKTREE_DIRTY',
          `The test worktree already contains production changes: ${initialProductionChanges.join(', ')}`,
        );
      ensureDirectory(root, path.resolve(root, runEvidence.directory));
      let proposed;
      try {
        proposed = await testRunner({
          operation: 'run-frozen-tests',
          changeId: loaded.state.changeId,
          worktree: test.path,
          integrationCommit,
          tests: manifest,
          plan: checked.plan,
        });
      } catch (error) {
        return failure(error.code || 'TEST_RUNNER_FAILED', errorText(error));
      }
      if (signal?.aborted) return failure('CANCELLED', 'Quality verification was cancelled');
      let specification;
      try {
        specification = validateRunner(test.path, proposed);
      } catch (error) {
        return failure(error.code || 'TEST_RUNNER_INVALID', error.message);
      }
      const changedByTest = changedTestWorktreePaths(test.path, integrationCommit);
      const policyViolations = changedByTest.filter((file) => !isTestPath(file));
      if (policyViolations.length)
        return failure(
          'TEST_ROLE_POLICY_VIOLATION',
          `The Test role changed production files: ${policyViolations.join(', ')}`,
          { violations: policyViolations, quality: runEvidence },
        );
      const command = await runCommand(specification, { signal, timeoutMs });
      const stdoutPath = `${runEvidence.directory}/stdout.log`;
      const stderrPath = `${runEvidence.directory}/stderr.log`;
      const testLog = `${runEvidence.directory}/test.log`;
      writeEvidence(root, stdoutPath, command.stdout + '\n');
      writeEvidence(root, stderrPath, command.stderr + '\n');
      writeEvidence(
        root,
        testLog,
        [
          `command: ${specification.command}`,
          `args: ${JSON.stringify(specification.args)}`,
          `cwd: ${path.relative(root, specification.cwd).replace(/\\/g, '/') || '.'}`,
          `startedAt: ${command.startedAt}`,
          `finishedAt: ${command.finishedAt}`,
          `durationMs: ${command.durationMs}`,
          `exitCode: ${command.exitCode}`,
          `reason: ${command.code || ''}`,
          '',
        ].join('\n'),
      );
      runEvidence.testLog = testLog;
      runEvidence.stdoutLog = stdoutPath;
      runEvidence.stderrLog = stderrPath;
      runEvidence.command = {
        command: specification.command,
        args: specification.args,
        cwd: path.relative(root, specification.cwd).replace(/\\/g, '/') || '.',
        startedAt: command.startedAt,
        finishedAt: command.finishedAt,
        durationMs: command.durationMs,
        exitCode: command.exitCode,
        reason: command.code || null,
      };
      const productionAfterCommand = changedTestWorktreePaths(test.path, integrationCommit).filter(
        (file) => !isTestPath(file),
      );
      if (productionAfterCommand.length)
        return failure(
          'TEST_ROLE_POLICY_VIOLATION',
          `The Test command changed production files: ${productionAfterCommand.join(', ')}`,
          { violations: productionAfterCommand, quality: runEvidence },
        );
      let checkedCases;
      try {
        checkedCases = validateCaseReport(
          test.path,
          specification.reportPath,
          manifest.cases,
          signal?.aborted ? 'any' : 'pass',
        );
      } catch (error) {
        const result = {
          runId: runEvidence.runId,
          code: signal?.aborted ? 'CANCELLED' : error.code || 'FROZEN_CASE_REPORT_INVALID',
          message: signal?.aborted ? 'Quality verification was cancelled' : error.message,
        };
        runEvidence.cases = [];
        return finishFailure({
          development,
          run: runEvidence,
          code: result.code,
          message: result.message,
          defects: [defectForRunner(result)],
          retryable: !signal?.aborted,
        });
      }
      runEvidence.cases = checkedCases.cases;
      if (signal?.aborted)
        return finishFailure({
          development,
          run: runEvidence,
          code: 'CANCELLED',
          message: 'Quality verification was cancelled',
          defects: [],
          retryable: false,
        });
      if (command.code === 'COMMAND_TIMEOUT')
        return finishFailure({
          development,
          run: runEvidence,
          code: 'TEST_COMMAND_TIMEOUT',
          message: 'The frozen test command exceeded its time limit',
          defects: [
            {
              id: `QUALITY-${runEvidence.runId}`,
              severity: 'P1',
              stage: 'frozen-cases',
              code: 'TEST_COMMAND_TIMEOUT',
              message: 'The frozen test command timed out',
              owners: [],
            },
          ],
        });
      if (!command.ok || command.exitCode !== 0)
        return finishFailure({
          development,
          run: runEvidence,
          code: command.code || 'TEST_COMMAND_FAILED',
          message: command.message || `Frozen tests exited with ${command.exitCode}`,
          defects: [
            {
              id: `QUALITY-${runEvidence.runId}`,
              severity: 'P1',
              stage: 'frozen-cases',
              code: command.code || 'TEST_COMMAND_FAILED',
              message: command.message || `Frozen tests exited with ${command.exitCode}`,
              owners: [],
            },
          ],
        });
      prepareVerificationMetadata(test.path);
      const verified = validateVerification(
        await verifier({ root: test.path }, { signal, timeoutMs }),
      );
      if (!verified.ok)
        return finishFailure({
          development,
          run: runEvidence,
          code: verified.code,
          message: verified.message,
          defects: [
            {
              id: `QUALITY-${runEvidence.runId}`,
              severity: 'P1',
              stage: 'verification',
              code: verified.code,
              message: verified.message,
              owners: [],
            },
          ],
        });
      writeEvidence(
        root,
        `${runEvidence.directory}/verification-report.json`,
        JSON.stringify(verified.report, null, 2) + '\n',
      );
      const aggregateCoverage = reconcileCoverage(test.path, {
        since: Date.parse(runEvidence.startedAt),
        directory: path.resolve(root, runEvidence.directory),
      });
      if (!aggregateCoverage.ok)
        return finishFailure({
          development,
          run: runEvidence,
          code: aggregateCoverage.code || 'COVERAGE_FAILED',
          message: aggregateCoverage.message,
          defects: [
            {
              id: `QUALITY-${runEvidence.runId}`,
              severity: 'P1',
              stage: 'coverage',
              code: aggregateCoverage.code || 'COVERAGE_FAILED',
              message: aggregateCoverage.message,
              owners: [],
            },
          ],
        });
      const changedCoverage = computeChangedCoverage({
        root: test.path,
        base: development.freezeCommit,
        head: integrationCommit,
      });
      if (!changedCoverage.ok)
        return finishFailure({
          development,
          run: {
            ...runEvidence,
            coverage: { aggregate: aggregateCoverage, changed: changedCoverage },
          },
          code: changedCoverage.code,
          message: changedCoverage.message,
          defects: [
            {
              id: `QUALITY-${runEvidence.runId}`,
              severity: 'P1',
              stage: 'changed-coverage',
              code: changedCoverage.code,
              message: changedCoverage.message,
              owners: [],
            },
          ],
        });
      const body = {
        schemaVersion: 1,
        status: 'passed',
        ...runEvidence,
        coverage: { aggregate: aggregateCoverage, changed: changedCoverage },
        p0: 0,
        p1: 0,
        defects: [],
        checkedAt: new Date().toISOString(),
      };
      const latest = await store.inspect();
      if (!latest.ok) return latest;
      if (latest.state.phase !== 'TESTING')
        return failure('CANCELLED', 'Quality verification stopped before publishing a pass', {
          state: latest.state,
          quality: body,
          retryAllowed: false,
        });
      const reportPath = `${runEvidence.directory}/report.json`;
      writeEvidence(root, reportPath, canonicalJson(body) + '\n');
      const quality = {
        ...body,
        reportPath,
        hash: digest(body),
      };
      const saved = await store.update({
        expectedVersion: latest.state.version,
        patch: { context: { quality } },
      });
      if (!saved.ok) return saved;
      const reviewing = await store.transition({
        expectedVersion: saved.state.version,
        to: 'REVIEWING',
      });
      return reviewing.ok ? { ...reviewing, quality } : reviewing;
    });
  }

  async function inspect() {
    return protect(async () => {
      if (!safeRoot)
        return failure(
          'SOURCE_REPOSITORY_FORBIDDEN',
          'The plugin repository cannot host product quality verification',
        );
      const loaded = await store.inspect();
      if (!loaded.ok) return loaded;
      const checked = await planService.inspect();
      if (!checked.ok) return checked;
      const quality = loaded.state.context?.quality;
      if (!object(quality) || !safeRelative(quality.reportPath))
        return failure('QUALITY_REQUIRED', 'Run the quality gate before Review');
      const report = JSON.parse(readFile(root, quality.reportPath));
      if (digest(report) !== quality.hash)
        return failure('QUALITY_EVIDENCE_CHANGED', 'Quality evidence was modified');
      return { ok: true, state: loaded.state, quality: report };
    });
  }

  return Object.freeze({ run, inspect });
}
