import { gitExecutable } from './core/git-runtime.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson, hashValue, verifyEventChain } from './events.js';
import { cleanupArchivedWorkspaces } from './cleanup.js';
import { persistDelivery } from './delivery.js';
import { gitSafeDirectory } from './git-path.js';
import { loadProjectReadiness, PROJECT_PROFILE_PATH } from './project-state.js';
import { createDeliveryRecordV3 } from './core/delivery-record.js';
import { acquireBaselineLease, releaseBaselineLease } from './core/baseline-lease.js';
import { archiveEvidence, copyArchiveEvidence } from './core/archive-evidence.js';
import { resolveGitIdentity } from './core/git-identity.js';
import { createArtifactStore } from './core/artifact-store.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
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
    relative.length > 0 &&
    relative.length <= 1024 &&
    !path.isAbsolute(relative) &&
    !/[<>:"\\|?*]/.test(relative) &&
    ![...relative].some((character) => character.charCodeAt(0) < 32) &&
    relative
      .split('/')
      .every(
        (part) =>
          part &&
          !['.', '..'].includes(part) &&
          !/[. ]$/.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}

function git(root, args, environment) {
  return execFileSync(
    gitExecutable(),
    ['-c', `safe.directory=${gitSafeDirectory(root)}`, ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...(environment || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 120000,
    },
  ).trim();
}

function gitMaybe(root, args) {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

function ensureDirectory(root, target) {
  if (!inside(root, target)) fail('UNSAFE_PATH', 'Archive path escaped the product');
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
      fail('UNSAFE_PATH', 'Archive path contains an unsafe directory');
  }
}

function writeEvidence(root, relative, content) {
  if (!safeRelative(relative)) fail('UNSAFE_PATH', 'Archive evidence path is unsafe');
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
  if (!failure) return;
  if (created) {
    try {
      fs.rmSync(target, { force: true, maxRetries: 20, retryDelay: 100 });
    } catch {
      // preserve the original write failure; the partial file is never treated as evidence
    }
  }
  if (failure.code !== 'EEXIST') throw failure;
  const stat = fs.lstatSync(target);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    !fs.readFileSync(target).equals(Buffer.from(content))
  )
    fail(
      'ARCHIVE_EVIDENCE_CONFLICT',
      'Existing archive evidence differs; preserved without overwrite',
    );
}

function cleanStatus(root) {
  const status = git(root, ['status', '--porcelain', '--untracked-files=all']);
  return {
    clean: status.length === 0,
    entries: status
      ? status.split('\n').map((line) => ({
          status: line.slice(0, 2),
          path: line.slice(3).replace(/\\/g, '/'),
        }))
      : [],
  };
}

function diffFiles(root, base, head) {
  const output = git(root, ['diff', '--numstat', `${base}..${head}`]);
  if (!output) return [];
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, ...rest] = line.split('\t');
      return {
        path: rest.join('\t').replace(/\\/g, '/'),
        added: added === '-' ? null : Number(added),
        deleted: deleted === '-' ? null : Number(deleted),
      };
    });
}

function remoteNames(root) {
  return git(root, ['remote']).split('\n').filter(Boolean);
}

function currentBranch(root) {
  return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function upstream(root) {
  return gitMaybe(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
}

function previewBody(root, state) {
  const development = state.context?.development;
  const review = state.context?.artifacts?.review;
  const quality = state.context?.quality;
  const integration = development?.worktrees?.integration;
  if (!object(integration))
    return failure('ARCHIVE_PREREQUISITE_MISSING', 'Integration worktree is not registered');
  const integrationCommit = gitMaybe(integration.path, ['rev-parse', 'HEAD']);
  if (!integrationCommit)
    return failure('INTEGRATION_MISSING', 'Integration worktree has no commit');
  const expected = development?.merged?.at(-1)?.integrationCommit;
  if (expected !== integrationCommit)
    return failure(
      'INTEGRATION_EVIDENCE_INVALID',
      'Integration HEAD differs from the last recorded merge',
    );
  if (!object(review) || !object(quality))
    return failure('ARCHIVE_PREREQUISITE_MISSING', 'Review and quality evidence are required');
  if (
    quality.status !== 'passed' ||
    quality.integrationCommit !== integrationCommit ||
    state.context?.review?.reviewedCommit !== integrationCommit ||
    state.context?.review?.status !== 'passed'
  )
    return failure(
      'ARCHIVE_EVIDENCE_STALE',
      'Review and quality must cover the current integration commit',
    );
  const targetBranch = currentBranch(root);
  let project = null;
  let remoteUrl = null;
  if (fs.existsSync(path.join(root, PROJECT_PROFILE_PATH))) {
    const readiness = loadProjectReadiness({ projectRoot: root });
    if (!readiness.ok) return readiness;
    project = {
      projectId: readiness.profile.projectId,
      mode: readiness.profile.mode,
      targetBranch: readiness.profile.targetBranch,
    };
    remoteUrl = readiness.profile.remoteUrl;
    if (targetBranch !== project.targetBranch)
      return failure(
        'TARGET_BRANCH_INVALID',
        'Archive must run on the ProjectProfile target branch',
      );
  } else if (!['main', 'master'].includes(targetBranch)) {
    return failure(
      'TARGET_BRANCH_INVALID',
      'Legacy archive must run on the main or master worktree',
    );
  }
  const remotes = remoteNames(root);
  const remote = remotes.includes('origin') ? 'origin' : remotes[0] || null;
  const tracking = upstream(root);
  const pendingCommits = tracking
    ? Number(git(root, ['rev-list', '--count', `${tracking}..HEAD`]))
    : null;
  const status = cleanStatus(root);
  const files = diffFiles(integration.path, development.freezeCommit, integrationCommit);
  const preview = {
    schemaVersion: 1,
    changeId: state.changeId,
    project,
    targetBranch,
    targetCommit: git(root, ['rev-parse', 'HEAD']),
    remote,
    remoteConfigurationHash: remote ? digest(git(root, ['remote', 'get-url', remote])) : null,
    trackingCommit: tracking ? gitMaybe(root, ['rev-parse', tracking]) : null,
    remoteUrl,
    tracking,
    integrationBranch: integration.branch,
    integrationCommit,
    freezeCommit: development.freezeCommit,
    files,
    fileCount: files.length,
    pendingCommits,
    clean: status.clean,
    untrackedFiles: status.entries
      .filter((entry) => entry.status === '??')
      .map((entry) => entry.path),
    quality: {
      hash: quality.hash,
      status: quality.status,
      runId: quality.runId,
      tests: quality.cases,
      p0: quality.p0,
      p1: quality.p1,
    },
    review: {
      hash: review.hash,
      path: review.path,
    },
  };
  return { ok: true, preview, hash: digest(preview) };
}

export function computeArchivePreview({ projectRoot, state } = {}) {
  try {
    const root = fs.realpathSync(projectRoot);
    return previewBody(root, state);
  } catch (error) {
    return failure(error.code || 'ARCHIVE_PREVIEW_FAILED', error.message);
  }
}

function verifyH3Event(root, state) {
  const relative = '.specgate/codex/events.jsonl';
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) return failure('H3_EVIDENCE_MISSING', 'Audit history is missing');
  const chain = verifyEventChain(fs.readFileSync(target, 'utf8'));
  if (
    !chain.ok ||
    chain.events.at(-1)?.state.version !== state.version ||
    digest(chain.events.at(-1)?.state) !== digest(state)
  )
    return failure('H3_EVIDENCE_INVALID', 'State and H3 audit history disagree');
  const transition = chain.events.findLast(
    (event) =>
      event.changeId === state.changeId &&
      event.type === 'state.transitioned' &&
      event.state.phase === 'ARCHIVING' &&
      event.payload?.from === 'H3_PENDING' &&
      event.payload?.to === 'ARCHIVING' &&
      event.payload?.gate === 'H3',
  );
  const approval = transition?.payload?.approval;
  if (
    !object(approval) ||
    approval.gate !== 'H3' ||
    approval.scope !== state.changeId ||
    approval.decision !== 'approve' ||
    !approval.consumedAt ||
    !/^[a-f0-9]{64}$/.test(approval.nonce || '') ||
    approval.artifactHash !== state.context?.artifacts?.h3?.hash
  )
    return failure('H3_EVIDENCE_INVALID', 'A consumed H3 approval is required');
  return { ok: true, transition, approval };
}

function mergeIntegration(root, integration) {
  const currentCommit = git(root, ['rev-parse', 'HEAD']);
  if (currentCommit === integration.commit)
    return { ok: true, skipped: true, commit: currentCommit };
  const status = cleanStatus(root);
  if (!status.clean) return failure('MAIN_DIRTY', 'The target worktree must be clean before merge');
  if (gitMaybe(root, ['merge-base', '--is-ancestor', currentCommit, integration.commit]) === null)
    return failure(
      'ARCHIVE_TARGET_DIVERGED',
      'The target cannot fast-forward to the reviewed commit; preserve both branches and revalidate the integration.',
    );
  try {
    git(root, ['merge', '--ff-only', integration.commit]);
  } catch (error) {
    return failure('ARCHIVE_MERGE_CONFLICT', error.stderr || error.message);
  }
  return { ok: true, skipped: false, commit: git(root, ['rev-parse', 'HEAD']) };
}

function pushTarget(root, remote, branch) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(
    gitExecutable(),
    [
      '-c',
      `safe.directory=${gitSafeDirectory(root)}`,
      'push',
      '--porcelain',
      remote,
      `HEAD:${branch}`,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 120000,
    },
  );
  return {
    remote,
    branch,
    command: ['git', 'push', '--porcelain', remote, `HEAD:${branch}`],
    status: result.status ?? 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    stdout: String(result.stdout || '').slice(-20000),
    stderr: String(result.stderr || result.error?.message || '').slice(-20000),
  };
}

function observeRemoteTarget(root, remote, branch, commit) {
  const startedAt = new Date().toISOString();
  const output = gitMaybe(root, ['ls-remote', remote, 'refs/heads/' + branch]);
  if (!output || output.split(/\s+/)[0] !== commit) return null;
  return {
    remote,
    branch,
    command: ['git', 'ls-remote', remote, 'refs/heads/' + branch],
    status: 0,
    observed: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    stdout: output,
    stderr: '',
  };
}

export function createReleaseService({ projectRoot, store, planService } = {}) {
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
      return failure(error.code || 'ARCHIVE_FAILED', error.message);
    }
  };

  async function preview() {
    return protect(async () => {
      if (!safeRoot)
        return failure(
          'SOURCE_REPOSITORY_FORBIDDEN',
          'The plugin repository cannot host an archive operation',
        );
      const loaded = await store.inspect();
      if (!loaded.ok) return loaded;
      const checked = await planService.inspect();
      if (!checked.ok) return checked;
      const computed = previewBody(root, loaded.state);
      if (!computed.ok) return computed;
      return { ...computed, state: loaded.state };
    });
  }

  async function run(args = {}) {
    return protect(async () => {
      if (!safeRoot)
        return failure(
          'SOURCE_REPOSITORY_FORBIDDEN',
          'The plugin repository cannot host an archive operation',
        );
      if (
        !object(args) ||
        Object.keys(args).some((key) => !['expectedVersion', 'push'].includes(key)) ||
        !Number.isSafeInteger(args.expectedVersion) ||
        args.expectedVersion < 0 ||
        (args.push !== undefined && typeof args.push !== 'boolean')
      )
        return failure(
          'INVALID_ARGUMENT',
          'Only expectedVersion and an optional push boolean are accepted',
        );
      const directory = path.resolve(
        root,
        git(root, ['rev-parse', '--git-common-dir']),
        'specgate-release.lease',
      );
      const acquired = acquireBaselineLease(directory, { operation: 'release' }, () => {});
      if (!acquired.ok)
        return failure('ARCHIVE_BUSY', 'Another release operation owns this Git repository');
      try {
        return await runLocked(args);
      } finally {
        releaseBaselineLease(acquired.lease);
      }
    });
  }

  async function runLocked(args) {
    let loaded = await store.inspect();
    if (!loaded.ok) return loaded;
    if (loaded.state.version !== args.expectedVersion)
      return failure('VERSION_CONFLICT', 'Read the current state before retrying', {
        actualVersion: loaded.state.version,
      });
    const pushRequested = args.push === true;
    let intent = loaded.state.context?.archiveOperation;
    const resuming = !!intent;
    let observedPush;
    if (intent && ['ARCHIVED', 'ARCHIVED_NOT_PUSHED', 'PUSH_FAILED'].includes(loaded.state.phase)) {
      if (intent.pushRequested !== pushRequested)
        return failure(
          'ARCHIVE_OPTION_CHANGED',
          'A completed local archive cannot acquire push authorization from a retry',
        );
      const report = loaded.state.context.archive;
      const h3 = verifyH3Event(root, loaded.state);
      if (!h3.ok) return h3;
      if (
        !report ||
        report.h3?.previewHash !== intent.hash ||
        git(root, ['rev-parse', 'HEAD']) !== intent.preview.integrationCommit ||
        currentBranch(root) !== intent.preview.targetBranch
      )
        return failure(
          'ARCHIVE_RECOVERY_CONFLICT',
          'Completed archive or target changed; preserved',
        );
      const artifacts = createArtifactStore({ projectRoot: root });
      const savedReport = artifacts.readText(report.reportPath);
      const { reportPath: _path, ...savedBody } = report;
      if (
        !savedReport.ok ||
        savedReport.value !== canonicalJson(savedBody) + '\n' ||
        archiveEvidence(root, loaded.state.changeId, true).hash !== intent.evidenceHash
      )
        return failure(
          'ARCHIVE_EVIDENCE_CONFLICT',
          'Completed archive evidence changed; preserved',
        );
      if (report.delivery) {
        const base = '.specgate/codex/deliveries/' + report.delivery.deliveryId;
        const record = artifacts.readJson(base + '/record.json'),
          internal = artifacts.readText(base + '/internal.md'),
          customer = artifacts.readText(base + '/customer.md');
        if (
          !record.ok ||
          digest(record.value) !== digest(report.delivery) ||
          !internal.ok ||
          !customer.ok ||
          hashValue(internal.value) !== report.delivery.packs.internalHash ||
          hashValue(customer.value) !== report.delivery.packs.customerHash ||
          gitMaybe(root, [
            'rev-parse',
            '--verify',
            '--quiet',
            'refs/tags/' + report.delivery.tag + '^{commit}',
          ]) !== report.delivery.deliveryCommit
        )
          return failure(
            'ARCHIVE_EVIDENCE_CONFLICT',
            'Completed delivery record, packs or tag changed; preserved',
          );
      }
      let cleanup;
      if (loaded.state.phase !== 'PUSH_FAILED') {
        const cleanupPath = report.archivePath + '/cleanup-report.json';
        const existing = artifacts.readJson(cleanupPath);
        if (existing.ok) cleanup = existing.value;
        else if (existing.code === 'ARTIFACT_MISSING') {
          cleanup = cleanupArchivedWorkspaces({
            projectRoot: root,
            changeId: loaded.state.changeId,
          });
          writeEvidence(root, cleanupPath, canonicalJson(cleanup) + '\n');
        } else return existing;
      }
      return {
        ok: true,
        state: loaded.state,
        pushed: loaded.state.phase === 'ARCHIVED',
        report: { ...report, ...(cleanup ? { cleanup } : {}) },
        reused: true,
        message: loaded.state.phase === 'ARCHIVED_NOT_PUSHED' ? '未推送' : report.message,
      };
    }
    if (loaded.state.phase !== 'ARCHIVING')
      return failure('H3_REQUIRED', 'Archive requires a consumed H3 approval in ARCHIVING');
    const checked = await planService.inspect();
    if (!checked.ok) return checked;
    const h3 = verifyH3Event(root, loaded.state);
    if (!h3.ok) return h3;
    const fresh = previewBody(root, loaded.state);
    if (!fresh.ok) return fresh;
    const evidence = archiveEvidence(root, loaded.state.changeId);
    const { archive: _archive, archiveOperation: _operation, ...context } = loaded.state.context;
    const {
      archive: _approvedArchive,
      archiveOperation: _approvedOperation,
      ...approvedContext
    } = h3.transition.state.context;
    if (digest(context) !== digest(approvedContext))
      return failure(
        'ARCHIVE_EVIDENCE_STALE',
        'Workflow facts changed after the consumed H3 approval',
      );
    const readiness = fresh.preview.project ? loadProjectReadiness({ projectRoot: root }) : null;
    if (readiness && !readiness.ok) return readiness;
    const binding = digest({
      context,
      plan: checked.ref,
      evidence: evidence.hash,
      project: readiness ? { profile: readiness.profile, baseline: readiness.baseline } : null,
    });
    let computed = fresh;
    const target = git(root, ['rev-parse', 'HEAD']);
    if (intent) {
      if (
        intent.schemaVersion !== 1 ||
        intent.binding !== binding ||
        intent.approvalHash !== digest(h3.approval) ||
        intent.hash !== loaded.state.context.archivePreview?.hash ||
        intent.pushRequested !== pushRequested ||
        ![intent.targetBefore, intent.preview.integrationCommit].includes(target)
      )
        return failure(
          'ARCHIVE_RECOVERY_CONFLICT',
          'Release intent, evidence, approval, options or target changed; preserved',
        );
      const normalized = {
        ...fresh.preview,
        targetCommit: intent.preview.targetCommit,
        pendingCommits: intent.preview.pendingCommits,
      };
      if (
        fresh.preview.trackingCommit === intent.preview.integrationCommit &&
        intent.pushRequested &&
        (intent.pushReceipt?.status === 0 ||
          (observedPush = observeRemoteTarget(
            root,
            intent.preview.remoteUrl || intent.preview.remote,
            intent.preview.targetBranch,
            intent.preview.integrationCommit,
          )))
      )
        normalized.trackingCommit = intent.preview.trackingCommit;
      if (digest(normalized) !== intent.hash)
        return failure(
          'ARCHIVE_RECOVERY_CONFLICT',
          'Release sources changed outside the recorded fast-forward',
        );
      computed = { ok: true, preview: intent.preview, hash: intent.hash };
    } else if (loaded.state.context.archivePreview?.hash !== fresh.hash)
      return failure(
        'ARCHIVE_PREVIEW_CHANGED',
        'Archive preview changed after H3 approval; request new approval',
      );
    if (!fresh.preview.clean) return failure('MAIN_DIRTY', 'The target worktree is not clean');
    // State storage canonicalizes object keys; pack rendering must use identical order on retry.
    computed = { ...computed, preview: JSON.parse(canonicalJson(computed.preview)) };
    const development = loaded.state.context.development;
    const recordDelivery = (pushState, write = true) => {
      if (!computed.preview.project) return { ok: true, delivery: null };
      const readiness = loadProjectReadiness({ projectRoot: root });
      if (!readiness.ok) return readiness;
      const reviewRef = loaded.state.context.artifacts?.review;
      const reviewRead = createArtifactStore({ projectRoot: root }).readJson(reviewRef?.path);
      if (!reviewRead.ok) return reviewRead;
      const approvedReview = reviewRead.value;
      if (
        digest(approvedReview) !== reviewRef.hash ||
        loaded.state.context.artifacts.h3.reviewHash !== reviewRef.hash
      )
        return failure('REVIEW_EVIDENCE_CHANGED', 'Approved Review evidence changed; preserved');
      if (
        approvedReview.valid !== true ||
        approvedReview.report?.verdict !== 'pass' ||
        !Array.isArray(approvedReview.blocking) ||
        approvedReview.blocking.length ||
        !Array.isArray(approvedReview.report.findings)
      )
        return failure('REVIEW_REQUIRED', 'Only a valid passed Review may enter a delivery');
      // Use the immutable H3-bound report, never a mutable summary in state.
      // Source evidence stays in the referenced report; customer packs keep actionable issues.
      const reviewIssues = [
        ...new Map(approvedReview.report.findings.map((finding) => [finding.id, finding])).values(),
      ]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(
          (finding) =>
            `[${finding.id}] ${finding.severity} ${finding.file}:${finding.line}: ` +
            (finding.message ? `${finding.message}; ` : '') +
            finding.recommendation,
        );
      const assessment =
        loaded.state.context?.verification || loaded.state.context?.review?.verification;
      if (!object(assessment))
        return failure(
          'VERIFICATION_ASSESSMENT_MISSING',
          'A current VerificationAssessment is required for DeliveryRecord',
        );
      const contract = loaded.state.context.changeAdd?.changeContract;
      const acceptance =
        contract?.acceptance || (checked.plan?.graph?.acs || []).map((entry) => entry.id);
      const evidence = [
        loaded.state.context.quality?.runId,
        loaded.state.context.quality?.hash,
        loaded.state.context.artifacts?.review?.hash,
      ].filter((entry) => typeof entry === 'string' && entry.length > 0);
      const selectedReviewMode = approvedReview.mode;
      const reviewMode =
        assessment.reviewMode ||
        (selectedReviewMode === 'strict'
          ? 'full-code-review'
          : selectedReviewMode === 'standard'
            ? 'evidence-and-diff'
            : 'evidence');
      const knownIssues = [
        ...reviewIssues,
        ...(assessment.openRisks || []).map((entry) => entry.text),
        ...(assessment.acCoverage || [])
          .filter((entry) => entry.sufficiency !== 'sufficient')
          .map((entry) => `Unverified ${entry.acId}: ${entry.summary}`),
        ...(readiness.baseline.knownFailures || []).map(
          (entry) => `${entry.commandId}: ${entry.signature}`,
        ),
        ...(readiness.baseline.unverifiedAreas || []).map(
          (entry) => `Unverified baseline ${entry.id}: ${entry.description} (${entry.risk})`,
        ),
      ].filter((entry, index, values) => values.indexOf(entry) === index);
      const assessmentHash = hashValue(assessment);
      const contractHash = String(checked.ref.contract.hash || '').replace(/^sha256:/, '');
      const h3ArtifactHash = String(loaded.state.context.artifacts.h3.hash || '').replace(
        /^sha256:/,
        '',
      );
      const approvalHash = hashValue(h3.approval);
      const created = createDeliveryRecordV3({
        projectId: readiness.profile.projectId,
        changeId: loaded.state.changeId,
        parentDeliveryId: contract?.parentDeliveryId ?? null,
        baselineCommit: development.freezeCommit,
        deliveryCommit: computed.preview.integrationCommit,
        environmentFingerprint:
          assessment.environmentFingerprint || readiness.baseline.environmentFingerprint,
        reviewMode,
        acceptance,
        evidence,
        knownIssues,
        risks: (assessment.openRisks || []).map((entry) => entry.id),
        rollback: {
          code: `From a clean worktree, create a rollback branch, run git restore --source=${development.freezeCommit} --staged --worktree -- . , review the staged diff and commit the rollback. Preserve local delivery evidence.`,
          data: 'No automatic production data rollback was performed.',
          forwardFix: 'Apply a new delivery from the accepted base.',
        },
        push: pushState,
        contract: {
          artifactId: `${loaded.state.changeId}-contract`,
          hash: contractHash,
        },
        verification: {
          verificationId: assessment.verificationId,
          assessmentHash,
          decision: assessment.decision,
        },
        h3: {
          artifactHash: h3ArtifactHash,
          approvalHash,
          approvedAt: h3.approval.consumedAt || h3.approval.issuedAt,
        },
        customerAcceptance: null,
        releaseState: pushState.status === 'passed' ? 'pushed' : 'release-approved',
        approvedAt: h3.approval.consumedAt || h3.approval.issuedAt,
        packs: null,
      });
      if (!created.ok) return created;
      return persistDelivery({
        projectRoot: root,
        write,
        delivery: created.delivery,
        internal: {
          archive: computed.preview,
          quality: loaded.state.context.quality,
          review: loaded.state.context.artifacts?.review,
        },
        customer: {
          title: contract?.request || loaded.state.changeId,
          summary: `Accepted delivery ${created.delivery.deliveryId}.`,
          verification: evidence,
          knownIssues: created.delivery.knownIssues,
          upgrade: `Deploy commit ${computed.preview.integrationCommit}.`,
          rollback: created.delivery.rollback,
        },
      });
    };

    // Validate every possible DeliveryRecord and render its immutable packs before Git mutation.
    const remote = computed.preview.remoteUrl || computed.preview.remote;
    const outcomes = pushRequested && remote ? ['passed', 'failed'] : ['not-requested'];
    const prepared = [];
    for (const status of outcomes) {
      const preflight = recordDelivery(
        {
          requested: pushRequested && !!remote,
          remoteUrl: pushRequested && remote ? remote : null,
          status,
        },
        false,
      );
      if (!preflight.ok) return preflight;
      prepared.push(preflight);
      if (preflight.delivery) {
        const identity = resolveGitIdentity({ root });
        if (!identity.ok) return identity;
        const tag = gitMaybe(root, [
          'rev-parse',
          '--verify',
          '--quiet',
          'refs/tags/' + preflight.delivery.tag + '^{commit}',
        ]);
        if (tag && tag !== computed.preview.integrationCommit)
          return failure(
            'DELIVERY_TAG_CONFLICT',
            'Existing delivery tag points elsewhere; preserved',
          );
      }
    }
    const artifacts = createArtifactStore({ projectRoot: root });
    const compatible = prepared.some(
      (plan) =>
        !plan.delivery ||
        [
          ['record.json', JSON.stringify(plan.delivery, null, 2) + '\n'],
          ['internal.md', plan.internal],
          ['customer.md', plan.customer],
        ].every(([name, expected]) => {
          const existing = artifacts.readText(
            '.specgate/codex/deliveries/' + plan.delivery.deliveryId + '/' + name,
          );
          return existing.ok ? existing.value === expected : existing.code === 'ARTIFACT_MISSING';
        }),
    );
    if (!compatible)
      return failure(
        'ARCHIVE_EVIDENCE_CONFLICT',
        'Existing immutable delivery content conflicts with the reviewed delivery; preserved',
      );
    if (!intent) {
      intent = {
        schemaVersion: 1,
        hash: computed.hash,
        preview: computed.preview,
        targetBefore: target,
        binding,
        evidenceHash: evidence.hash,
        approvalHash: digest(h3.approval),
        pushRequested,
        createdAt: new Date().toISOString(),
        merge: {
          ok: true,
          skipped: target === computed.preview.integrationCommit,
          commit: computed.preview.integrationCommit,
        },
      };
      const saved = await store.update({
        expectedVersion: loaded.state.version,
        patch: { context: { archiveOperation: intent } },
      });
      if (!saved.ok) return saved;
      loaded = saved;
    }
    const merge = mergeIntegration(root, { commit: computed.preview.integrationCommit });
    if (!merge.ok) return merge;
    const archiveRelative = '.specgate/codex/archive/' + computed.preview.changeId;
    copyArchiveEvidence(root, archiveRelative, evidence, writeEvidence);
    if (archiveEvidence(root, loaded.state.changeId).hash !== evidence.hash)
      return failure(
        'ARCHIVE_RECOVERY_CONFLICT',
        'Source evidence changed during copy; preserve partial archive',
      );
    let pushed = intent.pushReceipt;
    if (pushRequested && remote && !pushed) {
      pushed =
        observedPush ||
        (resuming
          ? observeRemoteTarget(
              root,
              remote,
              computed.preview.targetBranch,
              computed.preview.integrationCommit,
            )
          : null) ||
        pushTarget(root, remote, computed.preview.targetBranch);
      const saved = await store.update({
        expectedVersion: loaded.state.version,
        patch: { context: { archiveOperation: { ...intent, pushReceipt: pushed } } },
      });
      if (!saved.ok) return saved;
      loaded = saved;
      intent = loaded.state.context.archiveOperation;
    }
    let delivery = { ok: true, delivery: null };
    if (!pushRequested || remote)
      delivery = recordDelivery({
        requested: pushRequested,
        remoteUrl: pushRequested ? remote : null,
        status: pushRequested ? (pushed.status === 0 ? 'passed' : 'failed') : 'not-requested',
      });
    if (!delivery.ok) return delivery;
    const phase = !pushRequested
      ? 'ARCHIVED_NOT_PUSHED'
      : !remote || pushed.status !== 0
        ? 'PUSH_FAILED'
        : 'ARCHIVED';
    const report = {
      schemaVersion: 1,
      changeId: computed.preview.changeId,
      status:
        phase === 'ARCHIVED_NOT_PUSHED'
          ? 'archived-not-pushed'
          : phase === 'ARCHIVED'
            ? 'archived'
            : remote
              ? 'push_failed'
              : 'push-remote-required',
      h3: {
        artifactHash: loaded.state.context.artifacts.h3.hash,
        reviewHash: computed.preview.review.hash,
        previewHash: computed.hash,
        approval: h3.approval,
      },
      preview: computed.preview,
      merge: intent.merge,
      archivePath: archiveRelative,
      createdAt: intent.createdAt,
      cleanup: { status: 'deferred-until-durable-finalization' },
      ...(delivery.delivery ? { delivery: delivery.delivery } : {}),
      ...(pushed ? { push: pushed } : {}),
      message: !pushRequested
        ? '本地归档完成；目标分支未推送'
        : !remote
          ? '显式 push 请求缺少远程仓库 URL'
          : pushed.status !== 0
            ? '推送失败；未自动重试或回滚'
            : '本地归档及显式推送完成',
    };
    const reportPath = archiveRelative + '/archive-report.json';
    writeEvidence(root, reportPath, canonicalJson(report) + '\n');
    const saved = await store.update({
      expectedVersion: loaded.state.version,
      patch: { context: { archive: { ...report, reportPath } } },
    });
    if (!saved.ok) return saved;
    const moved = await store.transition({ expectedVersion: saved.state.version, to: phase });
    if (!moved.ok) return moved;
    // Destructive workspace cleanup happens only after record, evidence and state are durable.
    if (phase !== 'PUSH_FAILED') {
      report.cleanup = cleanupArchivedWorkspaces({
        projectRoot: root,
        changeId: computed.preview.changeId,
      });
      writeEvidence(
        root,
        archiveRelative + '/cleanup-report.json',
        canonicalJson(report.cleanup) + '\n',
      );
    }
    return {
      ...moved,
      pushed: phase === 'ARCHIVED',
      report,
      ...(!remote && pushRequested ? { code: 'PUSH_REMOTE_REQUIRED' } : {}),
      message: !pushRequested ? '未推送' : report.message,
    };
  }

  return Object.freeze({
    preview,
    run,
    compute: () => computeArchivePreview({ projectRoot: root }),
  });
}
