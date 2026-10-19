import fs from 'node:fs';
import path from 'node:path';
import { git, headOf } from './worktrees.js';
import { currentBranch, isClean } from './util/git.js';
import { applyDeltaToText } from './openspec/apply.js';
import { collectDelta } from './phase.js';
import { ensureDir, exists, readText, writeText } from './util/fsx.js';

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function copyDir(src, dest) {
  if (exists(src)) fs.cpSync(src, dest, { recursive: true });
}

function removeDir(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

export function nextTag(root) {
  let tags = [];
  try {
    tags = git(root, ['tag', '-l', 'sg-v0.*']).split('\n').filter(Boolean);
  } catch {
    tags = [];
  }
  const numbers = tags
    .map((tag) => Number(String(tag).replace('sg-v0.', '')))
    .filter((value) => Number.isFinite(value));
  return `sg-v0.${numbers.length ? Math.max(...numbers) + 1 : 1}`;
}

export function archiveChange({ root, change, integrationBranch, backupDir, tag, evidenceHead }) {
  const mainBefore = headOf(root, 'HEAD');
  if (!integrationBranch) {
    return { ok: false, code: 'NO_INTEGRATION', message: '没有 integration 分支' };
  }
  if (!isClean(root)) {
    return { ok: false, code: 'MAIN_DIRTY', message: '主工作树不干净，不能归档' };
  }
  const branch = currentBranch(root);
  if (!['main', 'master'].includes(branch)) {
    return { ok: false, code: 'NOT_MAIN', message: `当前分支是 ${branch}，请在 main/master 上归档` };
  }

  const day = stamp();
  const backup = backupDir || path.join(root, '.specgate', 'backups', day);
  removeDir(backup);
  ensureDir(backup);
  copyDir(path.join(root, 'openspec', 'specs'), path.join(backup, 'specs'));
  copyDir(path.join(root, 'openspec', 'changes', change), path.join(backup, 'change'));

  let createdTag = null;
  try {
    git(root, ['merge', '--no-ff', '-m', `merge ${change}`, integrationBranch]);

    for (const file of collectDelta(root, change)) {
      const specsPath = path.join(root, 'openspec', 'specs', file.capability, 'spec.md');
      const current = exists(specsPath) ? readText(specsPath) : '';
      const applied = applyDeltaToText(current, file.text);
      if (!applied.ok) {
        throw new Error(`应用 ${file.capability} delta 失败：${applied.errors.join('; ')}`);
      }
      writeText(specsPath, applied.text);
    }
    git(root, ['add', 'openspec/specs']);
    git(root, ['commit', '-q', '-m', `specs(${change}): 归档需求变更`]);

    git(root, [
      'tag',
      '-a',
      tag,
      '-m',
      `SpecGate ${tag}${evidenceHead ? `\nevidence: ${evidenceHead}` : ''}`,
    ]);
    createdTag = tag;

    const from = path.join(root, 'openspec', 'changes', change);
    const to = path.join(root, 'openspec', 'changes', 'archive', `${day.slice(0, 10)}-${change}`);
    ensureDir(path.dirname(to));
    fs.renameSync(from, to);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', `chore(${change}): 归档 change`]);

    return { ok: true, tag, mainBefore, backup, archivedPath: to };
  } catch (error) {
    try {
      if (createdTag) git(root, ['tag', '-d', createdTag]);
    } catch {
      // ignore
    }
    try {
      git(root, ['reset', '--hard', mainBefore]);
    } catch {
      // ignore
    }
    try {
      removeDir(path.join(root, 'openspec', 'specs'));
      copyDir(path.join(backup, 'specs'), path.join(root, 'openspec', 'specs'));
      removeDir(path.join(root, 'openspec', 'changes', change));
      copyDir(path.join(backup, 'change'), path.join(root, 'openspec', 'changes', change));
    } catch {
      // ignore restore failure
    }
    return {
      ok: false,
      code: 'ARCHIVE_FAILED',
      message: error instanceof Error ? error.message : String(error),
      rolledBack: true,
      backup,
      mainBefore,
    };
  }
}
