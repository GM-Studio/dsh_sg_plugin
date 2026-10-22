import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createArtifactStore } from './core/artifact-store.js';
import { hashValue } from './events.js';
import { gitSafeDirectory } from './git-path.js';
import { detectProject } from './project-detect.js';
import { validateProjectBaseline, validateProjectProfile } from './project-model.js';
import {
  CURRENT_BASELINE_PATH,
  PROJECT_PROFILE_PATH,
  checkedProjectRoot,
  loadProjectReadiness,
  persistProjectReadiness,
  projectIdForRoot,
} from './project-state.js';

export { CURRENT_BASELINE_PATH, PROJECT_PROFILE_PATH, loadProjectReadiness };

const failure = (code, message) => ({ ok: false, code, message });

function gitHead(root) {
  const environment = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
    ),
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  const result = spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${gitSafeDirectory(root)}`,
      '-c',
      'core.filemode=false',
      '-c',
      'core.autocrlf=true',
      'rev-parse',
      'HEAD',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: environment,
      timeout: 10000,
    },
  );
  return result.status === 0 && /^[a-f0-9]{40,64}$/i.test(result.stdout.trim())
    ? result.stdout.trim()
    : null;
}

function readJson(root, relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  } catch {
    return null;
  }
}

function validVerification(verification) {
  return (
    verification &&
    typeof verification === 'object' &&
    verification.ok === true &&
    typeof verification.runId === 'string' &&
    /^[\w-]+$/.test(verification.runId) &&
    /^[a-f0-9]{64}$/i.test(verification.sourceHash || '') &&
    verification.report?.status === 'verified' &&
    verification.report?.environment &&
    typeof verification.report.environment === 'object'
  );
}

function environmentFingerprint(verification) {
  return hashValue({
    environment: verification.report.environment,
    sourceHash: verification.sourceHash,
  });
}

export function recordNewProjectBaseline({
  projectRoot: inputRoot,
  verification,
  createdAt = new Date().toISOString(),
} = {}) {
  try {
    const root = checkedProjectRoot(inputRoot);
    const store = createArtifactStore({ projectRoot: root });
    if (store.readJson(PROJECT_PROFILE_PATH).ok)
      return failure('PROJECT_ALREADY_READY', 'ProjectProfile already exists');
    const init = readJson(root, '.specgate/init-report.json');
    if (init?.initializationComplete !== true || init?.phase === 'GENERATED_ONLY')
      return failure(
        'INITIALIZATION_NOT_VERIFIED',
        'New-project generation must be followed by complete verification',
      );
    if (!validVerification(verification))
      return failure(
        'VERIFICATION_NOT_CURRENT',
        'Current complete verification evidence is required',
      );
    const detected = detectProject({ root });
    if (!detected.ok) return detected;
    const monorepo = readJson(root, '.specgate/monorepo.json');
    const commit = gitHead(root);
    if (!commit) return failure('GIT_COMMIT_REQUIRED', 'A fixed project commit is required');
    const projectId = projectIdForRoot(root);
    const profile = {
      schemaVersion: 2,
      projectId,
      mode: 'new',
      stack: 'java-vue',
      root,
      targetBranch: detected.git.branch || 'main',
      remoteUrl: detected.git.remoteUrl,
      pushApproved: false,
      ...detected.conventions,
      ...(monorepo?.backendPackage
        ? {
            backendPackage: monorepo.backendPackage,
            frontendDefaultLocale: monorepo.frontendDefaultLocale || 'zh-CN',
            frontendLocales: monorepo.frontendLocales || ['zh-CN', 'en-US'],
            frontendFramework: monorepo.frontendFramework || 'vue',
            ...(monorepo.preset ? { javaPreset: monorepo.preset } : {}),
          }
        : {}),
      commands: detected.commands,
      protectedPaths: detected.protectedPaths,
      createdAt,
      updatedAt: createdAt,
    };
    const profileCheck = validateProjectProfile(profile);
    if (!profileCheck.ok) return profileCheck;
    const fingerprint = environmentFingerprint(verification);
    const baselineId = `baseline-${hashValue({ projectId, commit, runId: verification.runId }).slice(0, 16)}`;
    const commandIds = [
      ...new Set(
        Object.values(profile.commands)
          .flat()
          .map((entry) => entry.id),
      ),
    ];
    const baseline = {
      schemaVersion: 2,
      baselineId,
      projectId,
      commit,
      status: 'green',
      knownFailures: [],
      unverifiedAreas: [],
      commands: commandIds,
      evidence: [verification.runId],
      environmentFingerprint: fingerprint,
      createdAt,
    };
    const baselineCheck = validateProjectBaseline(baseline);
    if (!baselineCheck.ok) return baselineCheck;
    return persistProjectReadiness({ root, profile, baseline });
  } catch (error) {
    return failure(error.code || 'PROJECT_NEW_FAILED', error.message || 'New project setup failed');
  }
}
