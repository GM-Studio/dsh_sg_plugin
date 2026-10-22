import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson, hashValue, verifyEventChain } from './events.js';
import { cleanupArchivedWorkspaces } from './cleanup.js';
import { createDeliveryRecord, persistDelivery } from './delivery.js';
import { loadProjectReadiness, PROJECT_PROFILE_PATH } from './project-state.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value) => 'sha256:' + hashValue(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'SpecGate Codex',
  GIT_AUTHOR_EMAIL: 'specgate-codex@localhost',
  GIT_COMMITTER_NAME: 'SpecGate Codex',
  GIT_COMMITTER_EMAIL: 'specgate-codex@localhost',
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

function git(root, args, environment) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...(environment || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 120000,
  }).trim();
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
    remote,
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
  if (!chain.ok || chain.events.at(-1)?.state.version !== state.version)
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
    !/^[a-f0-9]{64}$/.test(approval.nonce || '')
  )
    return failure('H3_EVIDENCE_INVALID', 'A consumed H3 approval is required');
  return { ok: true, transition, approval };
}

function mergeIntegration(root, integration) {
  const present = gitMaybe(root, ['merge-base', '--is-ancestor', integration.commit, 'HEAD']);
  if (present !== null)
    return { ok: true, skipped: true, commit: git(root, ['rev-parse', 'HEAD']) };
  const status = cleanStatus(root);
  if (!status.clean) return failure('MAIN_DIRTY', 'The target worktree must be clean before merge');
  try {
    git(root, [
      'merge',
      '--no-ff',
      '--no-commit',
      '-m',
      `merge ${integration.branch}`,
      integration.branch,
    ]);
  } catch (error) {
    const conflicts = gitMaybe(root, ['diff', '--name-only', '--diff-filter=U']) || '';
    try {
      git(root, ['merge', '--abort']);
    } catch {
      // Preserve the original merge failure.
    }
    return failure('ARCHIVE_MERGE_CONFLICT', error.stderr || error.message, {
      conflicts: conflicts.split('\n').filter(Boolean),
    });
  }
  try {
    git(root, ['commit', '-m', `merge ${integration.branch}`], GIT_ENV);
  } catch (error) {
    try {
      git(root, ['merge', '--abort']);
    } catch {
      // Preserve the original commit failure.
    }
    return failure('ARCHIVE_COMMIT_FAILED', error.stderr || error.message);
  }
  return { ok: true, skipped: false, commit: git(root, ['rev-parse', 'HEAD']) };
}

function pushTarget(root, remote, branch) {
  const startedAt = new Date().toISOString();
  const result = spawnSync('git', ['push', '--porcelain', remote, `HEAD:${branch}`], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 120000,
  });
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
      const loaded = await store.inspect();
      if (!loaded.ok) return loaded;
      if (loaded.state.version !== args.expectedVersion)
        return {
          ...failure('VERSION_CONFLICT', 'Read the current state before retrying'),
          actualVersion: loaded.state.version,
        };
      if (loaded.state.phase !== 'ARCHIVING')
        return failure('H3_REQUIRED', 'Archive requires a consumed H3 approval in ARCHIVING');
      const checked = await planService.inspect();
      if (!checked.ok) return checked;
      const h3 = verifyH3Event(root, loaded.state);
      if (!h3.ok) return h3;
      const computed = previewBody(root, loaded.state);
      if (!computed.ok) return computed;
      if (loaded.state.context?.archivePreview?.hash !== computed.hash)
        return failure(
          'ARCHIVE_PREVIEW_CHANGED',
          'Archive preview changed after H3 approval; request new approval',
        );
      if (!computed.preview.clean)
        return failure('MAIN_DIRTY', 'The target branch worktree is not clean');
      const development = loaded.state.context.development;
      const integration = development.worktrees.integration;
      const merge = mergeIntegration(root, {
        branch: integration.branch,
        commit: computed.preview.integrationCommit,
      });
      if (!merge.ok) return merge;
      const recordDelivery = (pushState) => {
        if (!computed.preview.project) return { ok: true, delivery: null };
        const readiness = loadProjectReadiness({ projectRoot: root });
        if (!readiness.ok) return readiness;
        const contract = loaded.state.context.changeAdd?.changeContract;
        const acceptance =
          contract?.acceptance || (checked.plan?.graph?.acs || []).map((entry) => entry.id);
        const evidence = [
          loaded.state.context.quality?.runId,
          loaded.state.context.quality?.hash,
          loaded.state.context.artifacts?.review?.hash,
        ].filter((entry) => typeof entry === 'string' && entry.length > 0);
        const selectedReviewMode =
          loaded.state.context.review?.report?.mode ||
          loaded.state.context.review?.mode ||
          'evidence';
        const reviewMode =
          selectedReviewMode === 'strict'
            ? 'full-code-review'
            : selectedReviewMode === 'standard'
              ? 'evidence-and-diff'
              : 'evidence';
        const created = createDeliveryRecord({
          projectId: readiness.profile.projectId,
          changeId: loaded.state.changeId,
          parentDeliveryId: contract?.parentDeliveryId ?? null,
          baselineCommit: development.freezeCommit,
          deliveryCommit: merge.commit,
          environmentFingerprint: readiness.baseline.environmentFingerprint,
          reviewMode,
          acceptance,
          evidence,
          knownIssues: [],
          rollback: {
            code: `git revert ${merge.commit}`,
            data: 'No automatic production data rollback was performed.',
            forwardFix: 'Apply a new delivery from the accepted base.',
          },
          push: pushState,
          state: pushState.status === 'passed' ? 'pushed' : 'delivery-accepted',
        });
        if (!created.ok) return created;
        return persistDelivery({
          projectRoot: root,
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
            knownIssues: [],
            upgrade: `Deploy commit ${merge.commit}.`,
            rollback: created.delivery.rollback,
          },
        });
      };
      const archiveRelative = `.specgate/codex/archive/${computed.preview.changeId}`;
      const source = path.resolve(root, `.specgate/codex/changes/${computed.preview.changeId}`);
      const destination = path.resolve(root, archiveRelative);
      if (fs.existsSync(source)) {
        ensureDirectory(root, path.dirname(destination));
        if (!fs.existsSync(destination)) fs.cpSync(source, destination, { recursive: true });
      }
      const report = {
        schemaVersion: 1,
        changeId: computed.preview.changeId,
        status: 'merged',
        h3: {
          artifactHash: loaded.state.context.artifacts.h3.hash,
          reviewHash: computed.preview.review.hash,
          previewHash: computed.hash,
          approval: h3.approval,
        },
        preview: computed.preview,
        merge,
        archivePath: archiveRelative,
        createdAt: new Date().toISOString(),
      };
      const pushRequested = args.push === true;
      const remote = computed.preview.remoteUrl || computed.preview.remote;
      if (!pushRequested) {
        const delivery = recordDelivery({
          requested: false,
          remoteUrl: null,
          status: 'not-requested',
        });
        if (!delivery.ok) return delivery;
        if (delivery.delivery) report.delivery = delivery.delivery;
        report.cleanup = cleanupArchivedWorkspaces({
          projectRoot: root,
          changeId: computed.preview.changeId,
        });
        report.status = 'archived-not-pushed';
        report.message = '本地归档完成；目标分支未推送';
        const reportPath = `${archiveRelative}/archive-report.json`;
        writeEvidence(root, reportPath, canonicalJson(report) + '\n');
        const saved = await store.update({
          expectedVersion: loaded.state.version,
          patch: { context: { archive: { ...report, reportPath } } },
        });
        if (!saved.ok) return saved;
        const moved = await store.transition({
          expectedVersion: saved.state.version,
          to: 'ARCHIVED_NOT_PUSHED',
        });
        return moved.ok ? { ...moved, pushed: false, message: '未推送', report } : moved;
      }
      if (!remote) {
        report.status = 'push-remote-required';
        report.message = '显式 push 请求缺少远程仓库 URL';
        const reportPath = `${archiveRelative}/archive-report.json`;
        writeEvidence(root, reportPath, canonicalJson(report) + '\n');
        const saved = await store.update({
          expectedVersion: loaded.state.version,
          patch: { context: { archive: { ...report, reportPath } } },
        });
        if (!saved.ok) return saved;
        const failed = await store.transition({
          expectedVersion: saved.state.version,
          to: 'PUSH_FAILED',
        });
        return failed.ok
          ? {
              ...failed,
              pushed: false,
              code: 'PUSH_REMOTE_REQUIRED',
              message: report.message,
              report,
            }
          : failed;
      }
      const pushed = pushTarget(root, remote, computed.preview.targetBranch);
      report.push = pushed;
      if (pushed.status !== 0) {
        const delivery = recordDelivery({
          requested: true,
          remoteUrl: remote,
          status: 'failed',
        });
        if (!delivery.ok) return delivery;
        if (delivery.delivery) report.delivery = delivery.delivery;
        report.status = 'push_failed';
        report.message = '推送失败；未自动重试或回滚';
        const reportPath = `${archiveRelative}/archive-report.json`;
        writeEvidence(root, reportPath, canonicalJson(report) + '\n');
        const saved = await store.update({
          expectedVersion: loaded.state.version,
          patch: { context: { archive: { ...report, reportPath } } },
        });
        if (!saved.ok) return saved;
        const failed = await store.transition({
          expectedVersion: saved.state.version,
          to: 'PUSH_FAILED',
        });
        return failed.ok ? { ...failed, pushed: false, report } : failed;
      }
      const delivery = recordDelivery({
        requested: true,
        remoteUrl: remote,
        status: 'passed',
      });
      if (!delivery.ok) return delivery;
      if (delivery.delivery) report.delivery = delivery.delivery;
      report.cleanup = cleanupArchivedWorkspaces({
        projectRoot: root,
        changeId: computed.preview.changeId,
      });
      report.status = 'archived';
      const reportPath = `${archiveRelative}/archive-report.json`;
      writeEvidence(root, reportPath, canonicalJson(report) + '\n');
      const saved = await store.update({
        expectedVersion: loaded.state.version,
        patch: { context: { archive: { ...report, reportPath } } },
      });
      if (!saved.ok) return saved;
      const archived = await store.transition({
        expectedVersion: saved.state.version,
        to: 'ARCHIVED',
      });
      return archived.ok ? { ...archived, pushed: true, report } : archived;
    });
  }

  return Object.freeze({
    preview,
    run,
    compute: () => computeArchivePreview({ projectRoot: root }),
  });
}
