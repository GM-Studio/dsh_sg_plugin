import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, exists, nowIso, readIfExists, walkFiles, writeFile } from './util.js';

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.json',
  '.js',
  '.mjs',
  '.ts',
  '.yml',
  '.yaml',
  '.txt',
  '.svg',
  '.template',
  '.sh',
  '.ps1',
]);

const REWRITES = [
  ['dsh-plugin-ak47', 'dsh-plugin-specgate'],
  ['ak47-skill-', 'sg-skill-'],
  ['ak47-agent-', 'sg-agent-'],
  ['ak47-using-skills', 'sg-using-skills'],
  ['ak47-core', 'sg-core'],
  ['ak47-dsh', 'specgate'],
  ['/ak47-', '/sg-'],
  ['/opsx-', '/sg-'],
  ['opsx-propose', 'sg-propose'],
  ['opsx-apply', 'sg-apply'],
  ['opsx-archive', 'sg-archive'],
  ['opsx-explore', 'sg-explore'],
  ['.ak47/', '.specgate/'],
  ['.ak47', '.specgate'],
  ['ak47_', 'sg_'],
  ['AK47', 'SpecGate'],
  ['ak47', 'specgate'],
];

function rewriteText(text) {
  let value = text;
  for (const [from, to] of REWRITES) value = value.split(from).join(to);
  return value;
}

function renameBottomUp(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) renameBottomUp(full);
    let name = entry.name;
    for (const [from, to] of REWRITES) name = name.split(from).join(to);
    if (name !== entry.name) {
      const target = path.join(dir, name);
      if (!fs.existsSync(target)) fs.renameSync(full, target);
    }
  }
}

export function rewriteProjectReferences(root) {
  const roots = [
    path.join(root, '.specgate'),
    path.join(root, '.dsh', 'skills', 'specgate'),
    path.join(root, 'openspec'),
    path.join(root, 'docs', 'specgate'),
  ];
  const files = [];
  for (const item of roots) {
    if (exists(item)) files.push(...walkFiles(item, { skip: new Set(['.git', 'node_modules']) }));
  }
  for (const name of ['AGENTS.md', 'CONTEXT.md', '.gitignore']) {
    const file = path.join(root, name);
    if (exists(file)) files.push(file);
  }

  const rewritten = [];
  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const original = readIfExists(file);
    if (original === null) continue;
    const text = rewriteText(original);
    if (text !== original) {
      writeFile(file, text);
      rewritten.push(file);
    }
  }

  for (const item of roots) {
    if (exists(item)) renameBottomUp(item);
  }
  return rewritten;
}

function migrateSkillsDir(root) {
  const oldDir = path.join(root, '.dsh', 'skills', 'ak47');
  const newDir = path.join(root, '.dsh', 'skills', 'specgate');
  if (!exists(oldDir)) return null;
  if (!exists(newDir)) {
    ensureDir(path.dirname(newDir));
    fs.renameSync(oldDir, newDir);
    renameBottomUp(newDir);
    return newDir;
  }
  // If both exist, merge missing skill directories without deleting either.
  for (const entry of fs.readdirSync(oldDir, { withFileTypes: true })) {
    const source = path.join(oldDir, entry.name);
    const target = path.join(newDir, entry.name.replace(/^ak47-/, 'sg-'));
    if (!exists(target)) fs.renameSync(source, target);
  }
  renameBottomUp(newDir);
  return newDir;
}

function backupName(root, base) {
  const stamp = nowIso().replace(/[:.]/g, '-');
  return path.join(root, `${base}.${stamp}`);
}

export function migrateProject(root, options = {}) {
  const projectRoot = path.resolve(root);
  const source = path.join(projectRoot, '.ak47');
  const target = path.join(projectRoot, '.specgate');
  const dryRun = options.dryRun === true;
  const force = options.force === true;

  if (!exists(source)) {
    if (exists(target)) {
      return {
        ok: true,
        already: true,
        text: '项目已经迁移到 .specgate/，无需重复迁移。',
        source,
        target,
      };
    }
    return {
      ok: false,
      text: '未找到 .ak47/，没有可迁移的 SpecGate 旧项目。',
      source,
      target,
    };
  }

  if (exists(target) && !force) {
    return {
      ok: false,
      text: '.specgate/ 已存在；如需重新迁移，使用 --force（会先备份现有目标）。',
      source,
      target,
    };
  }

  const backup = backupName(projectRoot, '.ak47');
  const plan = {
    source,
    target,
    backup,
    force,
    files: walkFiles(source, { skip: new Set(['.git', 'node_modules']) }).length,
  };

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      plan,
      text: `将迁移 ${plan.files} 个文件：${source} → ${target}；备份：${backup}`,
    };
  }

  let targetBackup = null;
  if (exists(target)) {
    targetBackup = backupName(projectRoot, '.specgate');
    fs.renameSync(target, targetBackup);
  }

  try {
    fs.renameSync(source, backup);
    fs.cpSync(backup, target, { recursive: true });
    migrateSkillsDir(projectRoot);
    const rewritten = rewriteProjectReferences(projectRoot);
    ensureDir(path.join(target, 'reports'));
    const reportDir = path.join(target, 'reports');
    const ignore = path.join(reportDir, '.gitignore');
    if (!exists(ignore)) writeFile(ignore, '*\n');
    const reportPath = path.join(
      reportDir,
      `migrate-${new Date().toISOString().replace(/[:.]/g, '-')}.md`,
    );
    writeFile(
      reportPath,
      [
        `# SpecGate migration`,
        ``,
        `- source: ${source}`,
        `- backup: ${backup}`,
        `- target: ${target}`,
        `- targetBackup: ${targetBackup || 'none'}`,
        `- files: ${plan.files}`,
        `- rewritten: ${rewritten.length}`,
        `- at: ${nowIso()}`,
        ``,
        `Existing worktrees and branches named ak47/* are not moved automatically.`,
      ].join('\n'),
    );
    return {
      ok: true,
      already: false,
      source,
      backup,
      target,
      targetBackup,
      reportPath,
      rewritten: rewritten.length,
      text: `已迁移到 .specgate/；旧目录备份为 ${backup}；迁移报告：${reportPath}`,
    };
  } catch (error) {
    // Keep the original backup if the copy failed; restore a displaced target.
    if (targetBackup && !exists(target)) {
      try {
        fs.renameSync(targetBackup, target);
      } catch {
        // best effort
      }
    }
    return {
      ok: false,
      text: `迁移失败：${error instanceof Error ? error.message : String(error)}；原 .ak47/ 已保留在备份路径。`,
      source,
      backup,
      target,
    };
  }
}

export function renderMigration(result) {
  return result.text || (result.ok ? '迁移完成。' : '迁移失败。');
}
