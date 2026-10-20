import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { executeJavaInit } from './java-init-execution.js';

const STAGES = ['test', 'lint', 'format', 'review'];
const reportFile = (stage) => 'docs/initialization/agent-reports/' + stage + '.json';
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const SOURCE =
  /^(backend\/src\/main\/.*\.(java|properties|ya?ml)|frontend\/src\/.*\.(vue|ts|js|css|scss))$/;
const TEST = /^(backend\/src\/test\/.*\.java|frontend\/src\/.*\.(test|spec)\.[jt]s)$/;
const HASH = /^[a-f0-9]{64}$/;
const REVIEW_CHECKS = [
  'CRUD correctness',
  'persistence and transactions',
  'security and validation',
];
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Pure, idempotent quality policy; omission means automatic multiagent lenient quality. */
export function normalizeInitQuality(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { ok: false, errors: ['quality must be an object'] };
  const errors = [];
  for (const key of Reflect.ownKeys(input)) {
    if (!['mode', 'generateOnly'].includes(key))
      errors.push('Unknown quality option: ' + String(key));
    else if (key === 'mode' && !['lenient', 'strict'].includes(input[key]))
      errors.push('mode must be lenient or strict');
    else if (key === 'generateOnly' && typeof input[key] !== 'boolean')
      errors.push('generateOnly must be boolean');
  }
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        quality: {
          mode: Object.hasOwn(input, 'mode') ? input.mode : 'lenient',
          generateOnly: Object.hasOwn(input, 'generateOnly') ? input.generateOnly : false,
        },
      };
}

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60000,
  });
  if (result.error || result.status !== 0)
    throw new Error('git ' + args[0] + ': ' + (result.error?.message || result.stderr));
  return result.stdout.trimEnd();
}
function relativeFile(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\\') &&
    !path.posix.isAbsolute(value) &&
    !value.split('/').some((part) => part === '..' || part === '.' || !part) &&
    !value.includes(':')
  );
}
function safeFile(root, relative) {
  if (!relativeFile(relative)) throw new Error('Unsafe report path: ' + String(relative));
  const file = path.join(root, ...relative.split('/'));
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error('Symlink forbidden: ' + relative);
  }
  return file;
}
function checkAbort(signal) {
  if (signal?.aborted) throw new Error('Java init quality aborted');
}
function head(root) {
  return git(root, 'rev-parse', 'HEAD');
}
function dirtySource(root) {
  return git(root, 'status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .filter(
      (line) =>
        !(
          line.startsWith('?? ') &&
          /^(?:docs\/initialization\/pending\/[a-f0-9]+\/(?:test|lint|format|review)\.json$|\.specgate\/(?:init-(?:report|pending)\.json$|init-worktrees\/|java-init-(?:quality|execution|pending)\.json$|verify-db-))/.test(
            line.slice(3).replaceAll('"', ''),
          )
        ),
    );
}
function baselineRoot(root) {
  if (typeof root !== 'string' || !root || !fs.statSync(root).isDirectory())
    throw new Error('root must be an existing directory');
  root = fs.realpathSync(root);
  if (fs.realpathSync(git(root, 'rev-parse', '--show-toplevel')) !== root)
    throw new Error('root must be the Git repository root');
  if (dirtySource(root).length)
    throw new Error('Generated source must have a clean committed Git baseline');
  return root;
}

/** Reports are untrusted structured evidence, never agent reply text or executable instructions. */
export function validateInitAgentReport(report, { stage, baseline, root }) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (!report || typeof report !== 'object' || Array.isArray(report))
    return { ok: false, errors: ['Report must be a JSON object'] };
  if (report.schemaVersion !== 1 || report.stage !== stage || report.baseline !== baseline)
    fail('Report schema/stage/baseline mismatch');
  if (!['verified', 'unverified', 'failed'].includes(report.status)) fail('Invalid report status');
  if (typeof report.summary !== 'string' || !report.summary.trim())
    fail('Report requires substantive summary');
  if (!Array.isArray(report.findings)) fail('findings must be an array');
  else
    for (const finding of report.findings) {
      if (
        !finding ||
        !SEVERITIES.includes(finding.severity) ||
        !relativeFile(finding.path) ||
        !Number.isInteger(finding.line) ||
        finding.line < 1 ||
        typeof finding.message !== 'string' ||
        !finding.message.trim() ||
        typeof finding.resolved !== 'boolean'
      )
        fail('Invalid finding');
    }
  if (!Array.isArray(report.commands)) fail('commands must be an array');
  else
    for (const command of report.commands) {
      if (
        !command ||
        typeof command.command !== 'string' ||
        !command.command.trim() ||
        !Array.isArray(command.args) ||
        command.args.some((arg) => typeof arg !== 'string') ||
        !(command.cwd === '.' || relativeFile(command.cwd)) ||
        !(command.exitCode === null || Number.isInteger(command.exitCode)) ||
        typeof command.stdout !== 'string' ||
        typeof command.stderr !== 'string'
      )
        fail('Invalid command outcome');
      if (report.status === 'verified' && command?.exitCode !== 0)
        fail('Verified report includes unsuccessful command');
    }
  if (stage !== 'review' && stage !== 'repair' && !report.commands?.length)
    fail('Command stage must record actual command attempts');
  if (STAGES.includes(stage) && stage !== 'review' && Array.isArray(report.commands)) {
    for (const side of ['backend', 'frontend'])
      if (fs.existsSync(path.join(root, side)) && !report.commands.some((cmd) => cmd?.cwd === side))
        fail('Applicable ' + side + ' commands must be attempted');
  }
  if (
    report.status === 'unverified' &&
    (!(
      Array.isArray(report.commands) &&
      report.commands.some((cmd) => cmd?.exitCode !== 0 && cmd?.reason === 'environment')
    ) ||
      (Array.isArray(report.commands) &&
        report.commands.some((cmd) => cmd?.exitCode !== 0 && cmd?.reason !== 'environment')))
  )
    fail('Unverified status requires explicit environmental command failure');
  if (
    report.status === 'verified' &&
    Array.isArray(report.findings) &&
    report.findings.some(
      (item) => item && ['high', 'critical'].includes(item.severity) && !item.resolved,
    )
  )
    fail('Verified report has unresolved high/critical findings');
  if (stage === 'review') {
    const review = report.review;
    if (
      !review ||
      !['pass', 'fail'].includes(review.verdict) ||
      !Array.isArray(review.files) ||
      !review.files.length ||
      !Array.isArray(review.checks) ||
      review.checks.length < 3
    )
      fail('Review requires source files and at least three substantive semantic checks');
    else {
      const names = new Set();
      for (const check of review.checks) {
        if (
          !check ||
          typeof check.name !== 'string' ||
          !check.name.trim() ||
          typeof check.evidence !== 'string' ||
          check.evidence.trim().length < 20
        )
          fail('Review check lacks substantive evidence');
        else names.add(check.name);
      }
      if (names.size < 3 || REVIEW_CHECKS.some((name) => !names.has(name)))
        fail(
          'Review must cover CRUD correctness, persistence and transactions, security and validation',
        );
      const reviewed = new Set(review.files.map((file) => file?.path));
      for (const file of snapshot(root).keys())
        if (SOURCE.test(file) && !TEST.test(file) && !reviewed.has(file))
          fail('Review omitted production source: ' + file);
      for (const file of review.files) {
        try {
          if (
            !SOURCE.test(file.path) ||
            TEST.test(file.path) ||
            !HASH.test(file.sha256) ||
            sha(safeFile(root, file.path)) !== file.sha256
          )
            fail('Review file evidence must hash actual current source');
        } catch (error) {
          fail(error.message);
        }
      }
      if (report.status === 'verified' && review.verdict !== 'pass')
        fail('Verified review must pass');
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, report };
}
function readReport(root, file, stage, baseline) {
  const full = safeFile(root, file);
  if (!fs.statSync(full).isFile() || fs.statSync(full).size > 1024 * 1024)
    throw new Error('Invalid or oversized report file');
  const report = JSON.parse(fs.readFileSync(full, 'utf8'));
  const result = validateInitAgentReport(report, { stage, baseline, root });
  if (!result.ok) throw new Error(stage + ': ' + result.errors.join('; '));
  return report;
}
function schema(stage, baseline) {
  return JSON.stringify({
    schemaVersion: 1,
    stage,
    baseline,
    status: 'verified|unverified|failed',
    summary: 'what actually happened',
    findings: [
      {
        severity: 'low|medium|high|critical',
        path: 'backend/src/main/java/Example.java',
        line: 1,
        message: 'concrete finding',
        resolved: false,
      },
    ],
    commands: [
      {
        command: 'mvn',
        args: ['test'],
        cwd: 'backend',
        exitCode: 0,
        stdout: 'actual captured output',
        stderr: '',
        reason: 'environment ONLY for missing tools/network',
      },
    ],
    ...(stage === 'review'
      ? {
          review: {
            verdict: 'pass|fail',
            files: [{ path: 'actual source path', sha256: 'actual SHA256' }],
            checks: [
              { name: 'CRUD correctness', evidence: 'file/line-based semantic analysis' },
              {
                name: 'persistence and transactions',
                evidence: 'file/line-based semantic analysis',
              },
              { name: 'security and validation', evidence: 'file/line-based semantic analysis' },
            ],
          },
        }
      : {}),
  });
}
function prompt(stage, baseline, reportPath, repairs = []) {
  return [
    'Java init quality stage: ' + stage + '. Git baseline: ' + baseline + '.',
    'Inspect actual generated code; run applicable backend and frontend commands. Dependency setup must use npm install --package-lock=false --no-audit --no-fund (never create or edit package-lock.json); do not change manifests/configuration/source during checks. Format is READ-ONLY spotless:check and npm run format:check; report formatting findings for the repair agent, never apply formatting here. Never infer success from agent text, TODO scans, or missing tools. Record command outputs honestly; environment failures are unverified, code failures failed.',
    'Write ONLY your stage-owned JSON report at ' +
      reportPath +
      '. Schema: ' +
      schema(stage, baseline),
    stage === 'repair'
      ? 'Assigned controlled repair: only backend/src/main Java/resources and frontend/src production source. Resolve findings: ' +
        JSON.stringify(repairs)
      : 'Read-only inspection: do not edit source, tests, configuration, baseline, approval state, or any other .specgate files.',
    'Review must hash ALL production source files (backend/src/main and frontend/src, excluding tests), and provide detailed semantic checks named CRUD correctness, persistence and transactions, security and validation; high/critical findings cannot be unresolved on pass. Do not auto approve any gate. Do not commit; orchestrator owns validated source commits.',
  ].join('\n');
}
function fallback(root, quality, baseline) {
  const token = { version: 1, root, baseline, quality, stages: [...STAGES] };
  const reports = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      'docs/initialization/pending/' + baseline + '/' + stage + '.json',
    ]),
  );
  const mainAgentPrompt = [
    'Subagents unavailable. Main agent must perform this workflow SERIAL in the existing session; no archive or approval is authorized yet.',
    'Root: ' + root + '. Completion token: ' + JSON.stringify(token),
    ...STAGES.map((stage) => prompt(stage, baseline, reports[stage])),
    'After real review and command attempts, invoke sg_init_finalize with path/root, token above, and reports=' +
      JSON.stringify(reports) +
      '. Reports are file paths, never textual success. If repairs are needed, modify only assigned production source, then ask parent sg_init_resume to create a new baseline; stale evidence is rejected. Strict completion also runs real build/test/static/format/live CRUD persistence verification.',
  ].join('\n\n');
  return {
    ok: false,
    accepted: false,
    archiveAllowed: false,
    fallbackRequired: true,
    token,
    reports,
    mainAgentPrompt,
    stages: [],
    warnings: ['Host subagent service unavailable; serial main-agent evidence required'],
    errors: [],
  };
}

function manager(root) {
  const container = path.join(root, '.specgate', 'init-worktrees');
  safeFile(root, '.specgate/init-worktrees');
  fs.mkdirSync(container, { recursive: true });
  const runDir = fs.mkdtempSync(path.join(container, 'run-'));
  const trees = [];
  return {
    add(label, commit) {
      const dir = path.join(runDir, label + '-' + randomUUID());
      git(root, 'worktree', 'add', '--detach', dir, commit);
      trees.push(dir);
      return dir;
    },
    cleanup(errors) {
      for (const dir of trees.reverse()) {
        try {
          // Delete only a registered, exact owned child of the verified run directory.
          if (path.dirname(dir) !== runDir || fs.lstatSync(dir).isSymbolicLink())
            throw new Error('Unsafe cleanup target');
          git(root, 'worktree', 'remove', '--force', dir);
        } catch (error) {
          errors.push('Worktree cleanup failed: ' + error.message);
        }
      }
      if (
        path.dirname(runDir) === container &&
        !fs.lstatSync(runDir).isSymbolicLink() &&
        fs.readdirSync(runDir).length === 0
      )
        fs.rmdirSync(runDir);
    },
  };
}
function snapshot(tree) {
  const entries = new Map();
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        ['.git', 'node_modules', 'target', 'dist'].includes(entry.name) ||
        prefix + entry.name === '.specgate/init-worktrees'
      )
        continue;
      const relative = prefix + entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) entries.set(relative, 'symlink:' + fs.readlinkSync(full));
      else if (entry.isDirectory()) walk(full, relative + '/');
      else entries.set(relative, sha(full));
    }
  };
  walk(tree);
  return entries;
}
function changedFiles(tree, baseline) {
  const tracked = git(tree, 'diff', '--name-only', '--no-renames', baseline)
    .split('\n')
    .filter(Boolean);
  const untracked = git(tree, 'ls-files', '--others', '--exclude-standard')
    .split('\n')
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])];
}
function validateDiff(tree, baseline, stage, before) {
  if (head(tree) !== baseline) throw new Error('Agent must not alter Git baseline or commit');
  const after = snapshot(tree);
  const observed = [...new Set([...before.keys(), ...after.keys()])].filter(
    (file) => before.get(file) !== after.get(file),
  );
  const files = [...new Set([...changedFiles(tree, baseline), ...observed])];
  for (const file of files) {
    if (file === reportFile(stage)) {
      safeFile(tree, file);
      continue;
    }
    if (stage !== 'repair' || !SOURCE.test(file) || TEST.test(file))
      throw new Error('Unauthorized ' + stage + ' edit: ' + file);
    safeFile(tree, file);
    const mode = git(tree, 'ls-files', '--stage', '--', file);
    if (mode.startsWith('120000') || mode.startsWith('160000'))
      throw new Error('Symlink/submodule edit forbidden');
  }
  return files.filter((file) => file !== reportFile(stage));
}
async function strictVerification(root, quality, strictRunner, signal, env) {
  if (quality.mode !== 'strict') return undefined;
  const commit = head(root);
  const tracked = new Set(git(root, 'ls-files').split('\n').filter(Boolean));
  const before = snapshot(root);
  const report = await executeJavaInit({
    root,
    formatCheck: true,
    runner: strictRunner,
    signal,
    env,
    execution: {
      test: true,
      lint: true,
      format: true,
      review: true,
      verify: true,
      installToolchain: false,
    },
  });
  const after = snapshot(root);
  const altered = [...new Set([...before.keys(), ...after.keys()])].some(
    (file) => (tracked.has(file) || SOURCE.test(file)) && before.get(file) !== after.get(file),
  );
  if (head(root) !== commit || altered)
    throw new Error(
      'Strict verification changed reviewed source/configuration; resume on a new baseline and re-review',
    );
  return report;
}
function acceptance(stages, quality, verification) {
  const review = stages.find((item) => item.stage === 'review');
  const high = stages
    .flatMap((item) => item.findings)
    .filter((item) => ['high', 'critical'].includes(item.severity) && !item.resolved);
  const warnings = stages
    .filter((item) => item.status !== 'verified')
    .map((item) => item.stage + ' ' + item.status + ': ' + item.summary);
  const reviewPass = review?.status === 'verified' && review.review?.verdict === 'pass';
  const environmentalOnly = stages.every(
    (item) => item.status === 'verified' || item.status === 'unverified',
  );
  const strictPass =
    quality.mode !== 'strict' ||
    (stages.every((item) => item.status === 'verified') &&
      verification?.ok === true &&
      ['test', 'lint', 'format', 'review', 'verify'].every((name) =>
        verification.stages?.some((item) => item.name === name && item.status === 'passed'),
      ));
  const accepted = reviewPass && high.length === 0 && environmentalOnly && strictPass;
  return {
    accepted,
    archiveAllowed: accepted,
    warnings,
    errors: accepted
      ? []
      : [
          'Quality acceptance failed: substantive review, unresolved findings, or actual verification missing',
        ],
  };
}

/** Caller establishes generated-project Git baseline. This function never alters approval states. */
export async function runJavaInitAgents({
  root,
  quality,
  runtime,
  parent,
  signal,
  dispatch,
  strictRunner,
  env,
} = {}) {
  const normalized = normalizeInitQuality(quality);
  if (!normalized.ok)
    return {
      ...normalized,
      accepted: false,
      archiveAllowed: false,
      fallbackRequired: false,
      stages: [],
      warnings: [],
    };
  quality = normalized.quality;
  if (quality.generateOnly)
    return {
      ok: true,
      accepted: false,
      archiveAllowed: false,
      fallbackRequired: false,
      generatedOnly: true,
      stages: [],
      warnings: ['Generation only: quality checks and archive bypassed'],
      errors: [],
    };
  const result = {
    ok: false,
    accepted: false,
    archiveAllowed: false,
    fallbackRequired: false,
    stages: [],
    warnings: [],
    errors: [],
    mergedCommits: [],
  };
  let managed;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const activations = new Set();
  const disposalTasks = new Set();
  const dispose = (activation) => {
    if (!activations.delete(activation)) return Promise.resolve();
    const pending = Promise.resolve().then(() => activation.dispose?.());
    disposalTasks.add(pending);
    pending.catch((error) => result.errors.push('Agent cleanup failed: ' + error.message));
    return pending;
  };
  controller.signal.addEventListener(
    'abort',
    () => {
      for (const activation of [...activations]) void dispose(activation);
    },
    { once: true },
  );
  try {
    checkAbort(controller.signal);
    root = baselineRoot(root);
    const baseline = head(root);
    result.baseline = baseline;
    const rootBefore = snapshot(root);
    const service = runtime?.service?.('subagents');
    const providers = service?.list?.() || [];
    if (!dispatch && (!service?.startActivation || !providers.length))
      return fallback(root, quality, baseline);
    const invoke =
      dispatch ||
      (async (request) => {
        const activation = await service.startActivation({
          provider: providers[0],
          label: 'specgate-java-init-' + request.stage,
          request: {
            cwd: request.worktree,
            prompt: [{ type: 'text', text: request.prompt }],
            parent,
            signal: controller.signal,
            agentOptions: { ...(parent?.options || {}) },
          },
          delivery: 'caller',
          signal: controller.signal,
        });
        activations.add(activation);
        if (controller.signal.aborted) await dispose(activation);
        try {
          return await activation.result;
        } finally {
          await dispose(activation);
        }
      });
    managed = manager(root);
    const runStage = async (stage, commit, repairs) => {
      checkAbort(controller.signal);
      const tree = managed.add(stage, commit);
      const before = snapshot(tree);
      const request = {
        root,
        role: stage === 'review' ? 'reviewer' : stage === 'repair' ? 'implementer' : 'tester',
        stage,
        task: { id: 'java-init-' + stage },
        worktree: tree,
        reportPath: path.join(tree, reportFile(stage)),
        baseline: commit,
        parent,
        signal: controller.signal,
        prompt: prompt(stage, commit, reportFile(stage), repairs),
      };
      try {
        const response = await invoke(request);
        checkAbort(controller.signal);
        if (
          response?.ok === false ||
          response?.stopReason === 'error' ||
          response?.stopReason === 'aborted'
        )
          throw new Error(stage + ' agent failed');
        const report = readReport(tree, reportFile(stage), stage, commit);
        const files = validateDiff(tree, commit, stage, before);
        return { tree, report, files };
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    };
    // All stages start before any results are awaited. Settling all prevents orphaned work.
    const batch = await Promise.allSettled(STAGES.map((stage) => runStage(stage, baseline)));
    for (const entry of batch)
      if (entry.status === 'rejected') result.errors.push(entry.reason.message);
    if (result.errors.length) return result;
    result.stages = batch.map((entry) => entry.value.report);
    const repairs = result.stages.flatMap((item) => item.findings).filter((item) => !item.resolved);
    let candidate = baseline;
    if (repairs.length) {
      const repair = await runStage('repair', baseline, repairs);
      if (repair.files.length) {
        git(repair.tree, 'add', '--', ...repair.files);
        git(
          repair.tree,
          '-c',
          'user.name=SpecGate',
          '-c',
          'user.email=specgate@local',
          '-c',
          'core.hooksPath=',
          'commit',
          '-m',
          'fix: controlled Java initialization repairs',
        );
        candidate = head(repair.tree);
        const rebatch = await Promise.allSettled(STAGES.map((stage) => runStage(stage, candidate)));
        for (const entry of rebatch)
          if (entry.status === 'rejected') result.errors.push(entry.reason.message);
        if (result.errors.length) return result;
        result.stages = rebatch.map((entry) => entry.value.report);
      }
    }
    const rootAfter = snapshot(root);
    const externalEdits = [...new Set([...rootBefore.keys(), ...rootAfter.keys()])].some(
      (file) => rootBefore.get(file) !== rootAfter.get(file),
    );
    if (head(root) !== baseline || dirtySource(root).length || externalEdits)
      throw new Error(
        'Root baseline changed during agents; refusing merge conflict or external edits',
      );
    // Only independently reviewed, validated candidate source can reach the root.
    const preaccept = acceptance(result.stages, { mode: 'lenient' });
    if (!preaccept.accepted) {
      Object.assign(result, preaccept);
      return result;
    }
    if (candidate !== baseline) {
      git(root, '-c', 'core.hooksPath=', 'merge', '--ff-only', candidate);
      result.mergedCommits.push(candidate);
    }
    result.strictVerification = await strictVerification(
      root,
      quality,
      strictRunner,
      controller.signal,
      env,
    );
    for (const stage of result.stages) {
      const validated = validateInitAgentReport(stage, {
        stage: stage.stage,
        baseline: stage.baseline,
        root,
      });
      if (!validated.ok)
        throw new Error('Final artifact evidence invalid: ' + validated.errors.join('; '));
    }
    Object.assign(result, acceptance(result.stages, quality, result.strictVerification));
    result.ok = result.accepted;
    return result;
  } catch (error) {
    result.errors.push(error.message || String(error));
    return result;
  } finally {
    controller.abort();
    await Promise.allSettled([...activations].map(dispose));
    await Promise.allSettled([...disposalTasks]);
    try {
      managed?.cleanup(result.errors);
    } catch (error) {
      result.errors.push('Worktree cleanup failed: ' + error.message);
    }
    signal?.removeEventListener('abort', abort);
    if (result.errors.length) {
      result.ok = false;
      result.accepted = false;
      result.archiveAllowed = false;
    }
  }
}

/** Serial host continuation: evidence is bound to exact root, HEAD and source hashes. */
export async function finalizeJavaInitAgents({
  root,
  token,
  reports,
  quality,
  strictRunner,
  signal,
  env,
} = {}) {
  const result = {
    ok: false,
    accepted: false,
    archiveAllowed: false,
    fallbackRequired: false,
    stages: [],
    warnings: [],
    errors: [],
  };
  try {
    root = baselineRoot(root);
    checkAbort(signal);
    const normalized = normalizeInitQuality(quality ?? token?.quality);
    if (!normalized.ok) throw new Error(normalized.errors.join('; '));
    quality = normalized.quality;
    if (
      !token ||
      token.version !== 1 ||
      token.root !== root ||
      token.baseline !== head(root) ||
      JSON.stringify(token.quality) !== JSON.stringify(quality) ||
      JSON.stringify(token.stages) !== JSON.stringify(STAGES) ||
      quality.generateOnly
    )
      throw new Error('Stale or invalid serial completion token; resume quality on a new baseline');
    for (const stage of STAGES) {
      const expected = 'docs/initialization/pending/' + token.baseline + '/' + stage + '.json';
      if (reports?.[stage] !== expected)
        throw new Error('Report must be stage-owned serial file: ' + expected);
      result.stages.push(readReport(root, expected, stage, token.baseline));
    }
    result.strictVerification = await strictVerification(root, quality, strictRunner, signal, env);
    for (const stage of result.stages) {
      const validated = validateInitAgentReport(stage, {
        stage: stage.stage,
        baseline: stage.baseline,
        root,
      });
      if (!validated.ok)
        throw new Error('Final artifact evidence invalid: ' + validated.errors.join('; '));
    }
    Object.assign(result, acceptance(result.stages, quality, result.strictVerification));
    result.ok = result.accepted;
  } catch (error) {
    result.errors.push(error.message || String(error));
  }
  return result;
}
