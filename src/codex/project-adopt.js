import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createArtifactStore } from './core/artifact-store.js';
import { hashValue } from './events.js';
import { gitSafeDirectory } from './git-path.js';
import { detectProject } from './project-detect.js';
import { validateProjectBaseline, validateProjectProfile } from './project-model.js';
import {
  PROJECT_PROFILE_PATH,
  checkedProjectRoot,
  persistProjectReadiness,
  projectIdForRoot,
} from './project-state.js';

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

function gitEnvironment() {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
    ),
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function git(root, args) {
  return spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${gitSafeDirectory(root)}`,
      '-c',
      'core.filemode=false',
      '-c',
      'core.autocrlf=true',
      ...args,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: gitEnvironment(),
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}

function head(root) {
  const result = git(root, ['rev-parse', 'HEAD']);
  return result.status === 0 ? result.stdout.trim() : null;
}

function sensitiveBaselinePath(relative) {
  const base = path.basename(relative).toLowerCase();
  return (
    base === '.env' ||
    base.startsWith('.env.') ||
    ['.npmrc', 'id_rsa', 'id_ed25519', 'credentials'].includes(base) ||
    /\.(?:pem|key|p12|pfx)$/i.test(base)
  );
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

export function previewAdoption({
  projectRoot: inputRoot,
  createdAt = new Date().toISOString(),
} = {}) {
  try {
    const root = checkedProjectRoot(inputRoot);
    const store = createArtifactStore({ projectRoot: root });
    if (store.readJson(PROJECT_PROFILE_PATH).ok)
      return failure('PROJECT_ALREADY_READY', 'ProjectProfile already exists');
    const detected = detectProject({ root });
    if (!detected.ok) return detected;
    if (!detected.git.repository)
      return failure('GIT_REPOSITORY_REQUIRED', 'Adoption requires a Git repository');
    if (!detected.git.branch)
      return failure('TARGET_BRANCH_REQUIRED', 'Adoption requires an attached Git branch');
    const profile = {
      schemaVersion: 2,
      projectId: projectIdForRoot(root),
      mode: 'adopted',
      stack: 'java-vue',
      root,
      targetBranch: detected.git.branch,
      remoteUrl: detected.git.remoteUrl,
      pushApproved: false,
      ...detected.conventions,
      commands: detected.commands,
      protectedPaths: detected.protectedPaths,
      createdAt,
      updatedAt: createdAt,
    };
    const checked = validateProjectProfile(profile);
    if (!checked.ok) return checked;
    const dirtyFiles = detected.git.dirtyFiles;
    const previewHash = hashValue({
      root,
      head: head(root),
      branch: profile.targetBranch,
      remoteUrl: profile.remoteUrl,
      commands: profile.commands,
      protectedPaths: profile.protectedPaths,
      dirtyFiles,
    });
    return {
      ok: true,
      root,
      stack: 'java-vue',
      profile,
      previewHash,
      git: { ...detected.git, commit: head(root) },
      needsBaselineCommit: dirtyFiles.length > 0,
      dirty: {
        files: dirtyFiles,
        proposal: {
          message: 'chore: establish adopted project baseline',
          paths: dirtyFiles.map((entry) => entry.path),
        },
      },
      risks: detected.risks,
    };
  } catch (error) {
    return failure(error.code || 'ADOPTION_PREVIEW_FAILED', error.message);
  }
}

export async function commitDirtyBaseline(args = {}, { approvalProvider, signal } = {}) {
  if (signal?.aborted) return failure('ADOPTION_CANCELLED', 'Adoption was cancelled');
  const keys = Object.keys(args);
  if (
    !keys.every((key) => ['projectRoot', 'previewHash', 'paths', 'message'].includes(key)) ||
    typeof args.previewHash !== 'string' ||
    !Array.isArray(args.paths) ||
    args.paths.length === 0 ||
    !args.paths.every((entry) => typeof entry === 'string') ||
    typeof args.message !== 'string' ||
    !args.message.trim() ||
    args.message.length > 512
  )
    return failure(
      'INVALID_ARGUMENT',
      'A bounded preview hash, file list and commit message are required',
    );
  const preview = previewAdoption({ projectRoot: args.projectRoot });
  if (!preview.ok) return preview;
  if (preview.previewHash !== args.previewHash)
    return failure('ADOPTION_PREVIEW_STALE', 'The dirty worktree changed; preview it again');
  if (!preview.needsBaselineCommit)
    return failure('WORKTREE_CLEAN', 'No dirty baseline commit is required');
  const expected = sortedUnique(preview.dirty.files.map((entry) => entry.path));
  const approved = sortedUnique(args.paths);
  if (JSON.stringify(approved) !== JSON.stringify(expected))
    return failure('APPROVED_PATHS_INCOMPLETE', 'Every dirty path must be approved explicitly');
  if (approved.some(sensitiveBaselinePath))
    return failure(
      'SENSITIVE_BASELINE_COMMIT',
      'Sensitive files cannot be committed as a baseline without explicit secret removal',
    );
  if (typeof approvalProvider?.requestApproval !== 'function')
    return failure(
      'TRUSTED_APPROVAL_UNAVAILABLE',
      'A trusted native approval provider is required',
    );
  let response;
  try {
    response = await approvalProvider.requestApproval({
      kind: 'dirty-baseline-commit',
      projectRoot: preview.root,
      artifactHash: preview.previewHash,
      paths: approved,
      message: args.message.trim(),
      signal,
    });
  } catch {
    return failure('APPROVAL_REQUEST_FAILED', 'Dirty-baseline approval did not complete');
  }
  if (!response?.ok)
    return failure(
      response?.code || 'APPROVAL_DENIED',
      response?.message || 'Dirty-baseline commit was not approved',
    );
  const record = response.record;
  if (
    record?.decision !== 'approve' ||
    record.artifactHash !== preview.previewHash ||
    !Array.isArray(record.paths) ||
    JSON.stringify(sortedUnique(record.paths)) !== JSON.stringify(approved)
  )
    return failure('APPROVAL_BINDING_MISMATCH', 'Approval does not match the current file set');
  const add = git(preview.root, ['add', '--', ...approved]);
  if (add.status !== 0)
    return failure('BASELINE_STAGE_FAILED', add.stderr || 'Approved files could not be staged');
  const commit = git(preview.root, [
    '-c',
    'user.name=SpecGate',
    '-c',
    'user.email=specgate@local',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--no-gpg-sign',
    '-m',
    args.message.trim(),
  ]);
  if (commit.status !== 0)
    return failure('BASELINE_COMMIT_FAILED', commit.stderr || 'Baseline commit failed');
  const current = previewAdoption({ projectRoot: preview.root });
  if (!current.ok) return current;
  if (current.needsBaselineCommit)
    return failure(
      'DIRTY_WORKTREE_REMAINS',
      'The worktree is still dirty after the baseline commit',
      {
        commit: head(preview.root),
      },
    );
  return { ok: true, commit: head(preview.root), preview: current };
}

export function applyAdoption({ projectRoot: inputRoot, previewHash, baseline } = {}) {
  try {
    if (typeof previewHash !== 'string')
      return failure('INVALID_ARGUMENT', 'An adoption preview hash is required');
    const preview = previewAdoption({ projectRoot: inputRoot });
    if (!preview.ok) return preview;
    if (preview.previewHash !== previewHash)
      return failure('ADOPTION_PREVIEW_STALE', 'The project changed after adoption preview');
    if (preview.needsBaselineCommit)
      return failure('DIRTY_WORKTREE_REQUIRES_COMMIT', 'Commit the approved dirty baseline first');
    const baselineCheck = validateProjectBaseline(baseline);
    if (!baselineCheck.ok) return baselineCheck;
    if (baseline.projectId !== preview.profile.projectId)
      return failure('BASELINE_PROJECT_MISMATCH', 'Baseline belongs to a different project');
    return persistProjectReadiness({
      root: preview.root,
      profile: preview.profile,
      baseline,
    });
  } catch (error) {
    return failure(error.code || 'ADOPTION_FAILED', error.message);
  }
}
