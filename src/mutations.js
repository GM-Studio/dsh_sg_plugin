import path from 'node:path';
import { countMaterializedSkills } from './assets.js';
import { duplicateMessage, withIdempotency } from './idempotency.js';
import {
  isRequirementsProject,
  requirementChangeDir,
  requirementsChangesDir,
  requirementsPath,
} from './requirements.js';
import { exists, listDir } from './util.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Run one mutating operation under its lock and state/dedupe policy.
 * The callback returns a command-shaped result (`{ kind, text, data? }`).
 */
export async function runMutation(root, meta, execute) {
  const outcome = await withIdempotency(root, meta, execute);
  if (outcome.status === 'busy') {
    return { kind: 'error', text: outcome.text, busy: true };
  }
  if (outcome.status === 'duplicate') {
    return { kind: 'success', text: duplicateMessage(outcome.record), duplicate: true };
  }
  return outcome.result;
}

export function projectComplete(root, options = {}) {
  const target = path.resolve(root);
  if (!exists(path.join(target, '.specgate', 'config.yaml'))) return false;
  if (!exists(path.join(target, 'openspec', 'changes'))) return false;
  if (!exists(path.join(target, 'openspec', 'specs'))) return false;
  if (isRequirementsProject(target) && !exists(requirementsPath(target))) return false;
  if (!exists(path.join(target, 'AGENTS.md'))) return false;
  if (countMaterializedSkills(target) < 30) return false;

  if (!options.minimal) {
    const agents = listDir(path.join(target, '.specgate', 'agents')).filter(
      (entry) => entry.isFile() && entry.name.endsWith('.md'),
    );
    if (agents.length < (isRequirementsProject(target) ? 10 : 9)) return false;
  }

  if (options.git !== false && !exists(path.join(target, '.git'))) return false;
  return true;
}

export function changeExists(root, name) {
  return exists(
    isRequirementsProject(root)
      ? requirementChangeDir(root, name)
      : path.join(path.resolve(root), 'openspec', 'changes', name),
  );
}

export function archivedPath(root, name) {
  const archiveDir = isRequirementsProject(root)
    ? path.join(requirementsChangesDir(root), 'archive')
    : path.join(path.resolve(root), 'openspec', 'changes', 'archive');
  const match = listDir(archiveDir)
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}-/.test(entry.name))
    .find((entry) => entry.name.endsWith(`-${name}`));
  return match ? path.join(archiveDir, match.name) : null;
}
