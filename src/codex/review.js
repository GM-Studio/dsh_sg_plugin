import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson, hashValue } from './events.js';
import { loadProjectReadiness, PROJECT_PROFILE_PATH } from './project-state.js';
import { computeArchivePreview } from './release.js';
import { assessVerification } from './verification.js';
import { commitPolicyViolations } from './core/task-policy.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MODES = Object.freeze(['lenient', 'standard', 'strict']);
const BLOCKING = Object.freeze({
  lenient: new Set(['P0', 'P1']),
  standard: new Set(['P0', 'P1', 'P2']),
  strict: new Set(['P0', 'P1', 'P2', 'P3']),
});
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
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

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 60000,
  }).trim();
}

function status(root) {
  return git(root, ['status', '--porcelain', '--untracked-files=all']);
}

function ensureDirectory(root, target) {
  if (!inside(root, target)) fail('UNSAFE_PATH', 'Review evidence escaped the project');
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
      fail('UNSAFE_PATH', 'Review evidence contains an unsafe directory');
  }
}

function readJson(root, relative, maximum = 16 * 1024 * 1024) {
  if (!safeRelative(relative)) fail('UNSAFE_PATH', 'Review artifact path is unsafe');
  const target = path.resolve(root, relative);
  if (!inside(root, target)) fail('UNSAFE_PATH', 'Review artifact escaped the project');
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail('UNSAFE_PATH', 'Review artifact is a symlink');
    if (current === target) {
      if (!stat.isFile() || stat.nlink > 1 || stat.size > maximum)
        fail('UNSAFE_PATH', 'Review artifact is unsafe or oversized');
    } else if (!stat.isDirectory()) {
      fail('UNSAFE_PATH', 'Review artifact parent is unsafe');
    }
  }
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function writeImmutable(root, relative, value) {
  if (!safeRelative(relative)) fail('UNSAFE_PATH', 'Review evidence path is unsafe');
  const content = canonicalJson(value) + '\n';
  const target = path.resolve(root, relative);
  ensureDirectory(root, path.dirname(target));
  let fd;
  let created = false;
  let failure = null;
  try {
    fd = fs.openSync(target, 'wx', 0o600);
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
        fs.rmSync(target, { force: true, maxRetries: 20, retryDelay: 100 });
      } catch {
        // preserve the original write failure; the partial file is never treated as evidence
      }
    }
    if (failure.code !== 'EEXIST') throw failure;
    if (fs.readFileSync(target, 'utf8') !== content)
      fail('REVIEW_ARTIFACT_CONFLICT', 'Review artifact already exists with different content');
  }
}

function parseDiff(root, base, head) {
  const range = `${base}..${head}`;
  const textDiff = git(root, ['diff', '--no-color', '--no-ext-diff', '-U3', range]);
  const names = git(root, ['diff', '--name-status', '--no-renames', range]);
  const files = names
    ? names.split('\n').map((line) => {
        const [change, ...parts] = line.split('\t');
        return { change, path: parts.at(-1).replace(/\\/g, '/') };
      })
    : [];
  const ranges = new Map();
  let current = null;
  for (const line of textDiff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice(6);
      if (!ranges.has(current)) ranges.set(current, []);
      continue;
    }
    if (!current) continue;
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))?\s+@@/);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    ranges.get(current).push({ start, end: start + Math.max(count, 1) - 1 });
  }
  return {
    range,
    files,
    filePaths: files.map((entry) => entry.path),
    ranges,
    text: textDiff,
    bytes: Buffer.byteLength(textDiff, 'utf8'),
  };
}

function riskSignals(diff, quality) {
  const paths = diff.filePaths;
  const low = diff.text.toLowerCase();
  const signal = (id, label, hit, evidence) => ({
    id,
    label,
    triggered: Boolean(hit),
    evidence,
  });
  const topLevels = new Set(paths.map((file) => file.split('/')[0]));
  const added = diff.text
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
  const deleted = diff.text
    .split('\n')
    .filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
  const changedLines = added + deleted;
  const changedCoverage = quality?.coverage?.changed?.rate;
  return [
    signal(
      'authentication-authorization',
      '认证或授权',
      paths.some((file) => /(?:auth|security|permission|role)/i.test(file)) ||
        /\b(?:authorize|authentication|permission|role)\b/.test(low),
      paths.filter((file) => /(?:auth|security|permission|role)/i.test(file)),
    ),
    signal(
      'data-delete-migration',
      '数据删除或迁移',
      paths.some((file) => /(?:migration|schema)/i.test(file)) ||
        /\b(?:drop\s+table|delete\s+from|migration)\b/.test(low),
      paths.filter((file) => /(?:migration|schema)/i.test(file)),
    ),
    signal(
      'external-network',
      '外部网络',
      /\b(?:fetch\s*\(|axios\.|resttemplate|webclient|httpclient)\b/.test(low),
      [],
    ),
    signal(
      'file-upload',
      '文件上传',
      paths.some((file) => /(?:upload|multipart|file)/i.test(file)) || /\bmultipart\b/.test(low),
      paths.filter((file) => /(?:upload|multipart|file)/i.test(file)),
    ),
    signal(
      'sensitive-data',
      '支付或敏感数据',
      /\b(?:password|secret|token|payment|creditcard|ssn)\b/.test(low),
      [],
    ),
    signal(
      'public-contract',
      '公共契约变更',
      paths.some((file) => /openapi|controller|dto|api\/|types\.ts$|\.proto$|graphql/i.test(file)),
      paths.filter((file) =>
        /openapi|controller|dto|api\/|types\.ts$|\.proto$|graphql/i.test(file),
      ),
    ),
    signal(
      'new-dependency',
      '新增依赖',
      paths.some((file) =>
        /(?:package\.json|package-lock\.json|pom\.xml|build\.gradle)/.test(file),
      ),
      paths.filter((file) =>
        /(?:package\.json|package-lock\.json|pom\.xml|build\.gradle)/.test(file),
      ),
    ),
    signal('cross-module', '跨模块变更', topLevels.size > 1, [...topLevels]),
    signal('large-change', '变更规模', changedLines > 150, { added, deleted, changedLines }),
    signal('low-coverage', '覆盖不足', !Number.isFinite(changedCoverage) || changedCoverage < 0.9, {
      changedCoverage: changedCoverage ?? null,
    }),
  ];
}

export function selectReviewMode(signals, diff) {
  const byId = new Map((signals || []).map((entry) => [entry.id, entry.triggered]));
  const high = [
    'authentication-authorization',
    'data-delete-migration',
    'external-network',
    'file-upload',
    'sensitive-data',
    'public-contract',
    'low-coverage',
  ];
  if (high.some((id) => byId.get(id))) return 'strict';
  const changedLines =
    (signals?.find((entry) => entry.id === 'large-change')?.evidence?.changedLines ?? 0) ||
    (diff?.text
      ? diff.text
          .split('\n')
          .filter(
            (line) =>
              (line.startsWith('+') && !line.startsWith('+++')) ||
              (line.startsWith('-') && !line.startsWith('---')),
          ).length
      : 0);
  if (byId.get('new-dependency') || byId.get('cross-module') || changedLines > 50)
    return 'standard';
  return 'lenient';
}

function validAcIds(plan) {
  return new Set(plan?.graph?.acs?.map((entry) => entry.id) || []);
}

function normalize(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateReviewReport(report, { mode, diff, plan, integrity, quality }) {
  const errors = [];
  if (!object(report)) return { ok: false, errors: ['Review report must be an object'] };
  if (report.mode !== mode) errors.push('Review report mode differs from the selected mode');
  if (report.reviewedCommit !== integrity.integrationCommit)
    errors.push('Review report reviewedCommit is not the integration commit');
  if (report.qualityHash !== quality.hash)
    errors.push('Review report qualityHash is not the current quality report');
  if (!text(report.summary)) errors.push('Review summary is required');
  if (!['pass', 'fail'].includes(report.verdict)) errors.push('verdict must be pass or fail');
  if (!Array.isArray(report.findings)) errors.push('findings must be an array');
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const allowedAcs = validAcIds(plan);
  const evidenceText = normalize(`${diff.text}\n${JSON.stringify(quality)}`);
  const ids = new Set();
  for (const [index, finding] of findings.entries()) {
    const label = `findings[${index}]`;
    if (
      !object(finding) ||
      !text(finding.id) ||
      ids.has(finding.id) ||
      !['P0', 'P1', 'P2', 'P3'].includes(finding.severity) ||
      !text(finding.file) ||
      !Number.isSafeInteger(finding.line) ||
      finding.line < 1 ||
      !Array.isArray(finding.acIds) ||
      !finding.acIds.length ||
      !finding.acIds.every((id) => allowedAcs.has(id)) ||
      !text(finding.evidence) ||
      !text(finding.recommendation)
    ) {
      errors.push(`${label} is missing id, severity, file, line, AC mapping, evidence or fix`);
      continue;
    }
    ids.add(finding.id);
    if (!diff.ranges.has(finding.file)) errors.push(`${label}.file is not in the diff`);
    else if (
      !diff.ranges
        .get(finding.file)
        .some((range) => finding.line >= range.start && finding.line <= range.end)
    )
      errors.push(`${label}.line is outside a changed hunk`);
    if (!evidenceText.includes(normalize(finding.evidence)))
      errors.push(`${label}.evidence does not match diff or quality evidence`);
  }
  const blocking = findings.filter((finding) => BLOCKING[mode]?.has(finding.severity));
  if (report.verdict === 'pass' && blocking.length)
    errors.push('verdict=pass contains blocking findings');
  if (report.verdict === 'fail' && !blocking.length)
    errors.push('verdict=fail requires at least one blocking finding for the selected mode');
  return {
    ok: errors.length === 0,
    errors,
    findings,
    blocking,
    nonBlocking: findings.filter((finding) => !blocking.includes(finding)),
  };
}

export function createReviewService({
  projectRoot,
  store,
  planService,
  roleProvider,
  approvalAuthority,
} = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot)
    throw new TypeError('projectRoot is required');
  if (!store || typeof store.inspect !== 'function')
    throw new TypeError('A server state store is required');
  if (!planService || typeof planService.inspect !== 'function')
    throw new TypeError('A server plan service is required');
  const root = fs.realpathSync(projectRoot);
  const safeRoot = !inside(SOURCE_ROOT, root) && !inside(root, SOURCE_ROOT);
  const protect = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      return failure(error.code || 'REVIEW_FAILED', error.message);
    }
  };

  async function current(args, phases) {
    if (!safeRoot)
      return failure(
        'SOURCE_REPOSITORY_FORBIDDEN',
        'The plugin repository cannot host product review worktrees',
      );
    if (
      !object(args) ||
      Object.keys(args).some((key) => !['expectedVersion', 'mode', 'report'].includes(key)) ||
      !Number.isSafeInteger(args.expectedVersion) ||
      args.expectedVersion < 0
    )
      return failure(
        'INVALID_ARGUMENT',
        'Only expectedVersion, mode and a structured Review report are accepted',
      );
    if (args.mode !== undefined && !MODES.includes(args.mode))
      return failure('INVALID_ARGUMENT', 'mode must be lenient, standard or strict');
    const loaded = await store.inspect();
    if (!loaded.ok) return loaded;
    if (loaded.state.version !== args.expectedVersion)
      return {
        ...failure('VERSION_CONFLICT', 'Read the current state before retrying'),
        actualVersion: loaded.state.version,
      };
    if (!phases.includes(loaded.state.phase))
      return failure('INVALID_TRANSITION', 'This phase cannot perform the requested review action');
    return loaded;
  }

  function currentQuality(state) {
    const quality = state.context?.quality;
    if (!object(quality) || !safeRelative(quality.reportPath))
      fail('QUALITY_REQUIRED', 'A passed P7 quality report is required');
    const body = readJson(root, quality.reportPath);
    if (body.status !== 'passed' || digest(body) !== quality.hash)
      fail('QUALITY_EVIDENCE_CHANGED', 'Quality evidence is not current');
    return { ...quality, body };
  }

  function validateCommitPolicy(checked, integration, head, diff) {
    if (checked.readOnly)
      return failure('LEGACY_PLAN_READ_ONLY', 'Historical plans cannot authorize Review');
    const violations = commitPolicyViolations({
      graph: checked.plan.graph,
      role: null,
      entries: diff.files.map((entry) => ({ path: entry.path, status: entry.change })),
      readContent: (file) =>
        execFileSync('git', ['show', `${head}:${file}`], {
          cwd: integration.path,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 8 * 1024 * 1024,
        }),
    });
    return violations.length
      ? failure(
          violations.some((entry) => entry.code === 'DEPENDENCY_APPROVAL_REQUIRED')
            ? 'DEPENDENCY_APPROVAL_REQUIRED'
            : 'ROLE_POLICY_VIOLATION',
          'The reviewed commit violates its frozen file or dependency policy',
          { violations },
        )
      : { ok: true };
  }

  function buildVerificationAssessment({ plan, quality, integrationCommit, mode }) {
    let environmentFingerprint = digest({
      qualityHash: quality.hash,
      integrationCommit,
    }).slice(7);
    if (fs.existsSync(path.join(root, PROJECT_PROFILE_PATH))) {
      const readiness = loadProjectReadiness({ projectRoot: root });
      if (!readiness.ok) return readiness;
      environmentFingerprint = readiness.baseline.environmentFingerprint;
    }
    const acs = plan.graph.acs;
    const evidence = [
      {
        schemaVersion: 2,
        evidenceId: `quality-${quality.hash.replace(/^sha256:/, '').slice(0, 16)}`,
        type: 'automated-test',
        acIds: acs.map((entry) => entry.id),
        executor: 'specgate_tester',
        command: ['sg_quality_run'],
        cwd: '.',
        commit: integrationCommit,
        startedAt: quality.body.startedAt || new Date().toISOString(),
        finishedAt: quality.body.finishedAt || new Date().toISOString(),
        status: 'passed',
        exitCode: 0,
        artifacts: [],
        summary: 'Frozen acceptance cases passed with current quality evidence.',
        environmentFingerprint,
      },
    ];
    return assessVerification({
      risk: mode === 'strict' ? 'red' : mode === 'standard' ? 'yellow' : 'green',
      independenceLevel: mode === 'strict' ? 'strict-review' : 'fresh-context',
      reviewMode:
        mode === 'strict'
          ? 'full-code-review'
          : mode === 'standard'
            ? 'evidence-and-diff'
            : 'evidence',
      commit: integrationCommit,
      environmentFingerprint,
      acceptanceCriteria: acs,
      evidenceRequirements: acs.map((entry) => ({
        acId: entry.id,
        allowedTypes: ['automated-test'],
      })),
      evidence,
    });
  }

  function alignReviewWorktree(development, integrationCommit) {
    const review = development?.worktrees?.review;
    const integration = development?.worktrees?.integration;
    if (!object(review) || !object(integration) || !fs.existsSync(review.path))
      fail('REVIEW_WORKTREE_MISSING', 'The fixed review worktree is unavailable');
    if (git(integration.path, ['rev-parse', 'HEAD']) !== integrationCommit)
      fail('INTEGRATION_EVIDENCE_INVALID', 'Integration HEAD changed');
    const head = git(review.path, ['rev-parse', 'HEAD']);
    if (head !== integrationCommit) {
      if (status(review.path)) fail('REVIEW_WORKTREE_DIRTY', 'Review worktree is dirty');
      git(review.path, ['checkout', '--detach', integrationCommit]);
    }
    return review;
  }

  async function prepareReview(args = {}) {
    const loaded = await current(args, ['REVIEWING']);
    if (!loaded.ok) return loaded;
    const checked = await planService.inspect();
    if (!checked.ok) return checked;
    const quality = currentQuality(loaded.state);
    const development = loaded.state.context?.development;
    const integration = development?.worktrees?.integration;
    if (!object(integration) || !fs.existsSync(integration.path))
      return failure('INTEGRATION_WORKTREE_MISSING', 'Integration worktree is unavailable');
    const integrationCommit = git(integration.path, ['rev-parse', 'HEAD']);
    const review = alignReviewWorktree(development, integrationCommit);
    const diff = parseDiff(integration.path, development.freezeCommit, integrationCommit);
    const policy = validateCommitPolicy(checked, integration, integrationCommit, diff);
    if (!policy.ok) return policy;
    const signals = riskSignals(diff, quality.body);
    const recommended = selectReviewMode(signals, diff);
    const mode = args.mode || recommended;
    const verification = buildVerificationAssessment({
      plan: checked.plan,
      quality,
      integrationCommit,
      mode,
    });
    if (!verification.ok) return verification;
    return {
      ok: true,
      state: loaded.state,
      challenge: {
        operation: 'review',
        changeId: loaded.state.changeId,
        mode,
        recommendedMode: recommended,
        risks: signals,
        worktree: review.path,
        integrationCommit,
        freezeCommit: development.freezeCommit,
        quality: quality.body,
        qualityHash: quality.hash,
        plan: checked.plan,
        contract: checked.ref.contract,
        model: checked.ref.model,
        diff,
        requirements: checked.plan.graph.acs,
        verification: verification.assessment,
      },
    };
  }

  async function run(args = {}, { signal } = {}) {
    return protect(async () => {
      const loaded = await current(args, ['REVIEWING']);
      if (!loaded.ok) return loaded;
      const suppliedReport = args.report;
      if (typeof roleProvider !== 'function' && !object(suppliedReport))
        return failure('REVIEW_PROVIDER_UNAVAILABLE', 'A server-owned Review Agent is required');
      const checked = await planService.inspect();
      if (!checked.ok) return checked;
      const quality = currentQuality(loaded.state);
      const development = loaded.state.context?.development;
      const integration = development?.worktrees?.integration;
      const integrationCommit = git(integration.path, ['rev-parse', 'HEAD']);
      const review = alignReviewWorktree(development, integrationCommit);
      const diff = parseDiff(integration.path, development.freezeCommit, integrationCommit);
      const policy = validateCommitPolicy(checked, integration, integrationCommit, diff);
      if (!policy.ok) return policy;
      const signals = riskSignals(diff, quality.body);
      const recommended = selectReviewMode(signals, diff);
      const mode = args.mode || recommended;
      const integrity = {
        integrationCommit,
        freezeCommit: development.freezeCommit,
        qualityHash: quality.hash,
      };
      const beforeReview = status(review.path);
      const beforeMain = status(root);
      let report;
      try {
        report =
          suppliedReport ||
          (await roleProvider('review', {
            operation: 'review',
            changeId: loaded.state.changeId,
            mode,
            recommendedMode: recommended,
            risks: signals,
            worktree: review.path,
            integrationCommit,
            freezeCommit: development.freezeCommit,
            quality: quality.body,
            qualityHash: quality.hash,
            plan: checked.plan,
            contract: checked.ref.contract,
            model: checked.ref.model,
            diff,
            requirements: checked.plan.graph.acs,
            signal,
          }));
      } catch (error) {
        return failure(error.code || 'REVIEW_PROVIDER_FAILED', error.message);
      }
      if (signal?.aborted) return failure('CANCELLED', 'Review was cancelled');
      if (status(review.path) !== beforeReview || status(root) !== beforeMain)
        return failure('REVIEW_NOT_READ_ONLY', 'Review Agent modified a worktree');
      if (git(integration.path, ['rev-parse', 'HEAD']) !== integrationCommit)
        return failure('REVIEW_NOT_READ_ONLY', 'Review Agent moved the integration commit');
      const checkedReport = validateReviewReport(report, {
        mode,
        diff,
        plan: checked.plan,
        integrity,
        quality,
      });
      const reportBody = {
        schemaVersion: 1,
        changeId: loaded.state.changeId,
        mode,
        recommendedMode: recommended,
        riskSignals: signals,
        reviewedCommit: integrationCommit,
        qualityHash: quality.hash,
        createdAt: new Date().toISOString(),
        report,
        valid: checkedReport.ok,
        errors: checkedReport.errors,
        blocking: checkedReport.blocking || [],
      };
      const reportHash = digest(reportBody);
      const relative = `.specgate/codex/changes/${loaded.state.changeId}/review/review-${reportHash.slice(7)}.json`;
      writeImmutable(root, relative, reportBody);
      const reviewState = {
        status: checkedReport.ok && report.verdict === 'pass' ? 'passed' : 'failed',
        mode,
        recommendedMode: recommended,
        riskSignals: signals,
        reportPath: relative,
        hash: reportHash,
        reviewedCommit: integrationCommit,
        blocking: checkedReport.blocking || [],
        errors: checkedReport.errors,
      };
      const verification = buildVerificationAssessment({
        plan: checked.plan,
        quality,
        integrationCommit,
        mode,
      });
      if (!verification.ok) return verification;
      reviewState.verification = verification.assessment;
      const saved = await store.update({
        expectedVersion: loaded.state.version,
        patch: {
          context: {
            review: reviewState,
            verification: verification.assessment,
          },
        },
      });
      if (!saved.ok) return saved;
      if (!checkedReport.ok || report.verdict !== 'pass') {
        const retried = await store.retry({
          expectedVersion: saved.state.version,
          taskId: 'review',
          category: 'review',
          error: checkedReport.errors.join('; ') || 'Review verdict was fail',
        });
        if (!retried.ok) return retried;
        if (!retried.retryAllowed)
          return failure('WORKFLOW_BLOCKED', 'Review failures exceeded the retry ceiling', {
            state: retried.state,
            review: reviewState,
            retryAllowed: false,
          });
        return failure('REVIEW_BLOCKED', 'Review Agent found blocking issues', {
          state: retried.state,
          review: reviewState,
          retryAllowed: true,
        });
      }
      const artifacts = {
        ...(saved.state.context.artifacts || {}),
        review: { hash: reportHash, path: relative, revision: 1 },
      };
      const stored = await store.update({
        expectedVersion: saved.state.version,
        patch: { context: { artifacts, review: reviewState } },
      });
      if (!stored.ok) return stored;
      const waiting = await store.transition({
        expectedVersion: stored.state.version,
        to: 'H3_PENDING',
      });
      return waiting.ok ? { ...waiting, review: reviewState } : waiting;
    });
  }

  async function requestH3(args = {}, { signal } = {}) {
    return protect(async () => {
      const loaded = await current(args, ['H3_PENDING']);
      if (!loaded.ok) return loaded;
      if (!approvalAuthority || typeof approvalAuthority.requestApproval !== 'function')
        return failure(
          'H3_APPROVAL_UNAVAILABLE',
          'A trusted native H3 approval source is required',
        );
      const review = loaded.state.context?.artifacts?.review;
      if (!object(review) || !safeRelative(review.path))
        return failure('REVIEW_REQUIRED', 'A passed Review report is required');
      const reviewBody = readJson(root, review.path);
      if (digest(reviewBody) !== review.hash)
        return failure('REVIEW_EVIDENCE_CHANGED', 'Review report hash changed');
      const checked = await planService.inspect();
      if (!checked.ok) return checked;
      const computed = computeArchivePreview({
        projectRoot: root,
        state: loaded.state,
      });
      if (!computed.ok) return computed;
      const compositeBody = { reviewHash: review.hash, previewHash: computed.hash };
      const compositeHash = digest(compositeBody);
      const artifacts = {
        ...(loaded.state.context.artifacts || {}),
        h3: { hash: compositeHash, ...compositeBody, revision: 1 },
      };
      const saved = await store.update({
        expectedVersion: loaded.state.version,
        patch: {
          context: {
            artifacts,
            archivePreview: { ...computed.preview, hash: computed.hash },
          },
        },
      });
      if (!saved.ok) return saved;
      const summary = [
        `# H3 ${loaded.state.changeId}`,
        `Review: ${reviewBody.report?.verdict || 'unknown'} (${reviewBody.mode})`,
        `Integration: ${computed.preview.integrationCommit}`,
        `Target: ${computed.preview.targetBranch}`,
        `Remote: ${computed.preview.remote || 'none (local archive only)'}`,
        `Files: ${computed.preview.fileCount}`,
        `Quality: ${computed.preview.quality.status} ${computed.preview.quality.hash}`,
        `Preview: ${computed.hash}`,
        'Approve to commit/merge and push when a remote exists.',
      ].join('\n');
      let issued;
      try {
        issued = await approvalAuthority.requestApproval({
          gate: 'H3',
          scope: loaded.state.changeId,
          artifactHash: compositeHash,
          readArtifactHash: async () => {
            const current = await store.inspect();
            if (!current.ok || current.state.changeId !== loaded.state.changeId)
              throw new Error('State changed');
            const currentReview = readJson(root, current.state.context.artifacts.review.path);
            if (digest(currentReview) !== current.state.context.artifacts.review.hash)
              throw new Error('Review changed');
            const currentPreview = computeArchivePreview({
              projectRoot: root,
              state: current.state,
            });
            if (!currentPreview.ok) throw new Error(currentPreview.message);
            return digest({
              reviewHash: current.state.context.artifacts.review.hash,
              previewHash: currentPreview.hash,
            });
          },
          summary,
          signal,
        });
      } catch (error) {
        return failure(error.code || 'H3_APPROVAL_FAILED', error.message);
      }
      if (!issued.ok) return { ...issued, state: saved.state, archivePreview: computed.preview };
      if (signal?.aborted)
        return failure('CANCELLED', 'H3 approval was cancelled', { state: saved.state });
      const beforeTransition = await store.inspect();
      if (!beforeTransition.ok) return beforeTransition;
      if (
        beforeTransition.state.phase !== 'H3_PENDING' ||
        beforeTransition.state.context?.artifacts?.h3?.hash !== compositeHash
      )
        return failure(
          'H3_EVIDENCE_CHANGED',
          'H3 artifact changed after approval; request new approval',
        );
      const moved = await store.transition({
        expectedVersion: beforeTransition.state.version,
        to: 'ARCHIVING',
        approval: issued.approval,
      });
      return moved.ok
        ? { ...moved, archivePreview: computed.preview, approval: issued.record }
        : moved;
    });
  }

  async function inspect() {
    return protect(async () => {
      if (!safeRoot)
        return failure(
          'SOURCE_REPOSITORY_FORBIDDEN',
          'The plugin repository cannot host product review worktrees',
        );
      const loaded = await store.inspect();
      if (!loaded.ok) return loaded;
      const checked = await planService.inspect();
      if (!checked.ok) return checked;
      const review = loaded.state.context?.review;
      if (!object(review) || !safeRelative(review.reportPath))
        return failure('REVIEW_REQUIRED', 'No Review report exists');
      const body = readJson(root, review.reportPath);
      if (digest(body) !== review.hash)
        return failure('REVIEW_EVIDENCE_CHANGED', 'Review report was modified');
      return { ok: true, state: loaded.state, review: body, summary: review };
    });
  }

  async function prepare(args = {}) {
    return protect(() => prepareReview(args));
  }

  return Object.freeze({ prepare, run, requestH3, inspect });
}
