import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createArtifactStore } from './core/artifact-store.js';
import { hashValue } from './events.js';
import { gitSafeDirectory } from './git-path.js';
import { SPECGATE_GITIGNORE } from './init.js';
import { resolveGitIdentity } from './core/git-identity.js';
import { insideSpecGateSource } from './core/project-path.js';
import {
  canStartChange,
  validateProjectBaseline,
  validateProjectProfile,
} from './project-model.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const PROJECT_PROFILE_PATH = '.specgate/codex/project.json';
export const CURRENT_BASELINE_PATH = '.specgate/codex/baselines/current.json';

const failure = (code, message) => ({ ok: false, code, message });

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
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
        ),
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}

function gitRetry(root, args, attempts = 20) {
  let result;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    result = git(root, args);
    if (
      result.status === 0 ||
      !/index\.lock|another git process|file exists/i.test(`${result.stderr}${result.stdout}`)
    )
      return result;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return result;
}

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export function checkedProjectRoot(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input))
    throw Object.assign(new Error('项目根目录必须是绝对路径'), {
      code: 'UNSAFE_PROJECT_PATH',
    });
  if (!fs.existsSync(input) || !fs.lstatSync(input).isDirectory())
    throw Object.assign(new Error('项目根目录必须是已存在的普通目录'), {
      code: 'PROJECT_ROOT_MISSING',
    });
  const root = fs.realpathSync(input);
  if (inside(SOURCE_ROOT, root) || inside(root, SOURCE_ROOT) || insideSpecGateSource(root))
    throw Object.assign(
      new Error(
        'SpecGate 插件源码或缓存目录不能作为业务项目；请用 sg_project_bind 绑定业务项目的绝对路径',
      ),
      {
        code: 'PROJECT_SOURCE_FORBIDDEN',
      },
    );
  return root;
}

export function projectIdForRoot(root) {
  return `project-${hashValue({ root }).slice(0, 16)}`;
}

export function persistProjectReadiness({ root, profile, baseline } = {}) {
  try {
    const checkedRoot = checkedProjectRoot(root);
    const profileCheck = validateProjectProfile(profile);
    if (!profileCheck.ok) return profileCheck;
    const baselineCheck = validateProjectBaseline(baseline);
    if (!baselineCheck.ok) return baselineCheck;
    if (profile.projectId !== baseline.projectId)
      return failure('BASELINE_PROJECT_MISMATCH', 'Profile and Baseline project IDs differ');
    const identity = resolveGitIdentity({ root: checkedRoot });
    if (!identity.ok) return identity;
    const store = createArtifactStore({ projectRoot: checkedRoot });
    if (store.readJson(PROJECT_PROFILE_PATH).ok)
      return failure('PROJECT_ALREADY_READY', 'ProjectProfile already exists');
    const ignoreWrite = store.writeText('.specgate/.gitignore', SPECGATE_GITIGNORE);
    if (!ignoreWrite.ok) return ignoreWrite;
    const baselinePath = `.specgate/codex/baselines/${baseline.baselineId}.json`;
    const baselineWrite = store.writeJson(baselinePath, baseline);
    if (!baselineWrite.ok) return baselineWrite;
    const pointer = {
      schemaVersion: 2,
      baselineId: baseline.baselineId,
      path: baselinePath,
      hash: baselineWrite.hash,
    };
    const pointerWrite = store.writeJson(CURRENT_BASELINE_PATH, pointer);
    if (!pointerWrite.ok) return pointerWrite;
    const profileWrite = store.writeJson(PROJECT_PROFILE_PATH, profile);
    if (!profileWrite.ok) return profileWrite;
    const metadataPaths = [
      '.specgate/.gitignore',
      baselinePath,
      CURRENT_BASELINE_PATH,
      PROJECT_PROFILE_PATH,
    ];
    const staged = gitRetry(checkedRoot, ['add', '-f', '--', ...metadataPaths]);
    if (staged.status !== 0)
      return failure(
        'PROJECT_METADATA_STAGE_FAILED',
        staged.stderr || 'Project metadata could not be staged',
      );
    const committed = gitRetry(checkedRoot, [
      '-c',
      'user.name=' + identity.name,
      '-c',
      'user.email=' + identity.email,
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--no-gpg-sign',
      '-m',
      'chore: record SpecGate project baseline',
    ]);
    if (committed.status !== 0)
      return failure(
        'PROJECT_METADATA_COMMIT_FAILED',
        committed.stderr || 'Project metadata could not be committed',
      );
    const metadataCommit = git(checkedRoot, ['rev-parse', 'HEAD']);
    return {
      ok: true,
      projectReady: true,
      nextAction: 'WAIT_FOR_USER_REQUIREMENTS',
      message:
        '项目基线已就绪。等待用户提出业务需求，再澄清、反述、批判分析并提交 H1 人工审批；不得自动编造需求或开始开发。',
      profile,
      baseline,
      baselinePath,
      projectHash: profileWrite.hash,
      baselineHash: baselineWrite.hash,
      metadataCommit: metadataCommit.status === 0 ? metadataCommit.stdout.trim() : null,
    };
  } catch (error) {
    return failure(error.code || 'PROJECT_STATE_WRITE_FAILED', error.message);
  }
}

export function loadProjectReadiness({ projectRoot: inputRoot } = {}) {
  try {
    const root = checkedProjectRoot(inputRoot);
    const store = createArtifactStore({ projectRoot: root });
    const profileRead = store.readJson(PROJECT_PROFILE_PATH);
    if (!profileRead.ok)
      return failure(profileRead.code || 'PROJECT_NOT_READY', 'ProjectProfile is unavailable');
    const pointerRead = store.readJson(CURRENT_BASELINE_PATH);
    if (!pointerRead.ok)
      return failure(
        pointerRead.code || 'BASELINE_MISSING',
        'Current Baseline pointer is unavailable',
      );
    const pointer = pointerRead.value;
    if (
      pointer?.schemaVersion !== 2 ||
      typeof pointer.path !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(pointer.hash || '')
    )
      return failure('BASELINE_INVALID', 'Current Baseline pointer is invalid');
    const baselineRead = store.readJson(pointer.path);
    if (!baselineRead.ok) return baselineRead;
    if (baselineRead.hash !== pointer.hash)
      return failure('BASELINE_EVIDENCE_CHANGED', 'Current Baseline content hash does not match');
    const profileCheck = validateProjectProfile(profileRead.value);
    if (!profileCheck.ok) return profileCheck;
    const baselineCheck = validateProjectBaseline(baselineRead.value);
    if (!baselineCheck.ok) return baselineCheck;
    const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch.status !== 0)
      return failure('GIT_STATUS_UNAVAILABLE', 'Cannot inspect the project Git branch');
    if (branch.stdout.trim() !== profileRead.value.targetBranch)
      return failure(
        'TARGET_BRANCH_INVALID',
        'The project must be on the ProjectProfile target branch',
      );
    const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
    if (status.status !== 0)
      return failure('GIT_STATUS_UNAVAILABLE', 'Cannot inspect the project Git state');
    if (status.stdout.trim())
      return failure(
        'GIT_NOT_CLEAN',
        'Tracked changes and untracked files must be resolved before starting a change',
      );
    const ready = canStartChange({ profile: profileRead.value, baseline: baselineRead.value });
    return {
      ok: ready.ok,
      ...(ready.ok ? {} : ready),
      profile: profileRead.value,
      baseline: baselineRead.value,
      baselinePath: pointer.path,
      canStartChange: ready.ok,
      fingerprint: baselineRead.value.environmentFingerprint,
    };
  } catch (error) {
    return failure(error.code || 'PROJECT_READINESS_FAILED', error.message);
  }
}
