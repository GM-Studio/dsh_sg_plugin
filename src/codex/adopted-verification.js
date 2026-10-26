import { hashValue } from './events.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  commandFailureSignature,
  commandsFor,
  legacyCommandFailureSignature,
  projectEnvironmentFingerprint,
  runBaselineCommand,
} from './baseline.js';
import { validateProjectBaseline, validateProjectProfile } from './project-model.js';

const COMMIT = /^[a-f0-9]{40,64}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const RESULT_STATES = new Set(['passed', 'failed', 'skipped', 'not-run', 'timeout', 'cancelled']);
const FAILURE_STATES = new Set(['failed', 'timeout', 'skipped', 'not-run']);

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function knownFailureIndex(profile, baseline) {
  const index = new Map(
    baseline.knownFailures.map((entry) => [`${entry.commandId}:${entry.signature}`, entry]),
  );
  const directory = path.join(profile.root, '.specgate', 'codex', 'baseline-runs');
  let runs;
  try {
    runs = fs.readdirSync(directory, { withFileTypes: true }).slice(0, 32);
  } catch {
    return index;
  }
  for (const run of runs) {
    if (!run.isDirectory() || !/^baseline-run-[a-f0-9]{16}$/.test(run.name)) continue;
    let summary;
    try {
      summary = JSON.parse(fs.readFileSync(path.join(directory, run.name, 'summary.json'), 'utf8'));
    } catch {
      continue;
    }
    if (summary?.baseline?.baselineId !== baseline.baselineId) continue;
    for (const command of summary.commands || []) {
      if (!['failed', 'timeout'].includes(command.status)) continue;
      const known = baseline.knownFailures.find((entry) => entry.commandId === command.id);
      if (!known) continue;
      const stable = commandFailureSignature(command, command);
      index.set(`${command.id}:${stable}`, known);
      index.set(`${command.id}:${legacyCommandFailureSignature(command, command)}`, known);
    }
  }
  return index;
}

function commandResult(value) {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    RESULT_STATES.has(value.status) &&
    (value.exitCode === null || Number.isSafeInteger(value.exitCode)) &&
    Number.isSafeInteger(value.durationMs) &&
    typeof value.evidence === 'string' &&
    value.evidence.length > 0
  );
}

export function validateAdoptedVerification(value) {
  const report = value?.report;
  if (
    value?.ok !== true ||
    !object(report) ||
    report.schemaVersion !== 1 ||
    report.kind !== 'adopted-project-verification' ||
    !['passed', 'passed-with-known-failures'].includes(report.status) ||
    !COMMIT.test(report.commit || '') ||
    !HASH.test(report.environmentFingerprint || '') ||
    !Array.isArray(report.commands) ||
    report.commands.length === 0 ||
    !report.commands.every(commandResult) ||
    !Array.isArray(report.knownFailures) ||
    !Array.isArray(report.newFailures) ||
    report.newFailures.length !== 0 ||
    (report.status === 'passed' && report.knownFailures.length !== 0) ||
    (report.status === 'passed-with-known-failures' && report.knownFailures.length === 0)
  )
    return failure(
      'ADOPTED_VERIFICATION_INVALID',
      'Adopted verification report is incomplete or claims an invalid pass state',
    );
  return { ok: true, report };
}

export async function verifyAdoptedProject({
  profile,
  baseline,
  worktree,
  commit,
  runner = runBaselineCommand,
  signal,
  startedAt = new Date().toISOString(),
} = {}) {
  const profileCheck = validateProjectProfile(profile);
  if (!profileCheck.ok) return profileCheck;
  const baselineCheck = validateProjectBaseline(baseline);
  if (!baselineCheck.ok) return baselineCheck;
  if (profile.mode !== 'adopted')
    return failure('ADOPTED_PROFILE_REQUIRED', 'Adopted verification requires an adopted profile');
  if (profile.projectId !== baseline.projectId)
    return failure(
      'BASELINE_PROJECT_MISMATCH',
      'Profile and baseline belong to different projects',
    );
  if (typeof worktree !== 'string' || !worktree)
    return failure('WORKTREE_REQUIRED', 'A fixed verification worktree is required');
  if (!COMMIT.test(commit || ''))
    return failure('COMMIT_REQUIRED', 'Adopted verification requires a fixed commit');
  const environmentFingerprint = projectEnvironmentFingerprint(profile);
  if (environmentFingerprint !== baseline.environmentFingerprint)
    return failure(
      'BASELINE_ENVIRONMENT_MISMATCH',
      'The verification environment differs from the accepted ProjectBaseline',
    );
  const configured = commandsFor(profile);
  if (configured.length === 0)
    return failure(
      'BASELINE_COMMANDS_MISSING',
      'The adopted project has no executable verification commands',
    );

  const knownBySignature = knownFailureIndex(profile, baseline);
  const results = [];
  for (const command of configured) {
    if (signal?.aborted) return failure('BASELINE_CANCELLED', 'Adopted verification was cancelled');
    let raw;
    try {
      raw = await runner({
        command,
        cwd: path.join(worktree, command.cwd),
        timeoutMs: command.timeoutMs,
        signal,
      });
    } catch (error) {
      return failure(
        error?.code || 'ADOPTED_VERIFICATION_FAILED',
        error?.message || 'Adopted verification command failed',
      );
    }
    if (
      !object(raw) ||
      raw.commandId !== command.id ||
      !RESULT_STATES.has(raw.status) ||
      (raw.exitCode !== null && !Number.isSafeInteger(raw.exitCode))
    )
      return failure('BASELINE_RESULT_INVALID', 'Adopted verification returned an invalid result');
    if (raw.status === 'cancelled')
      return failure('BASELINE_CANCELLED', 'Adopted verification was cancelled');
    const evidence = `adopted-${hashValue({
      commandId: command.id,
      commit,
      status: raw.status,
      exitCode: raw.exitCode,
    }).slice(0, 16)}`;
    results.push({
      id: command.id,
      kind: command.kind,
      cwd: command.cwd,
      argv: command.argv,
      status: raw.status,
      exitCode: raw.exitCode,
      durationMs: raw.durationMs || 0,
      startedAt: raw.startedAt || null,
      finishedAt: raw.finishedAt || null,
      stdout: String(raw.stdout || '').slice(-4000),
      stderr: String(raw.stderr || '').slice(-4000),
      evidence,
    });
  }

  const knownFailures = [];
  const newFailures = [];
  for (const result of results) {
    if (!FAILURE_STATES.has(result.status)) continue;
    const signature = commandFailureSignature(result, result);
    const legacySignature = legacyCommandFailureSignature(result, result);
    const key = `${result.id}:${signature}`;
    const legacyKey = `${result.id}:${legacySignature}`;
    const known = knownBySignature.get(key) || knownBySignature.get(legacyKey);
    const record = {
      commandId: result.id,
      signature,
      status: result.status,
      exitCode: result.exitCode,
      evidence: known?.evidence || 'baseline-does-not-cover',
    };
    if (known) knownFailures.push(record);
    else newFailures.push(record);
  }
  const report = {
    schemaVersion: 1,
    kind: 'adopted-project-verification',
    projectId: profile.projectId,
    baselineId: baseline.baselineId,
    commit,
    status: newFailures.length
      ? 'blocked'
      : knownFailures.length
        ? 'passed-with-known-failures'
        : 'passed',
    commands: results,
    knownFailures,
    newFailures,
    environmentFingerprint,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  if (newFailures.length)
    return failure('BASELINE_NEW_FAILURE', 'Adopted verification introduced new failures', {
      report,
      newFailures,
    });
  return { ok: true, report };
}
