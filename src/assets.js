import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureDir,
  exists,
  parseFrontmatter,
  readIfExists,
  walkFiles,
  writeFile,
} from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const packageRoot = path.resolve(here, '..');
export const assetsRoot = path.join(packageRoot, 'assets');

const REPLACEMENTS = [
  ['.qoder/CONTEXT.md', 'CONTEXT.md'],
  ['templates/qoder/skills/', '.dsh/skills/specgate/'],
  ['templates/qoder/agents/', '.specgate/agents/'],
  ['templates/qoder/rules/', '.specgate/templates/rules/'],
  ['templates/qoder/commands/', '.specgate/templates/commands/'],
  ['templates/qoder/', '.dsh/skills/specgate/'],
  ['.qoder/skills/', '.dsh/skills/specgate/'],
  ['.qoder/agents/', '.specgate/agents/'],
  ['.qoder/rules/', '.specgate/templates/rules/'],
  ['.qoder/hooks/', '.specgate/templates/hooks/'],
  ['.qoder/commands/', '.specgate/templates/commands/'],
  ['.qoder/', '.dsh/'],
  ['Qoder Memory', '.specgate/experiences/'],
  ['TodoWrite', 'todo_write'],
  ['`search_codebase`', '`grep`'],
  ['`grep_code`', '`grep`'],
  ['`search_memory`', '`grep`'],
  ['`Skill`', '`skill`'],
  ['`Read`', '`read`'],
  ['`Write`', '`write`'],
  ['`Edit`', '`edit`'],
  ['Write|Edit|MultiEdit', 'write/edit'],
  ['Write/Edit/MultiEdit', 'write/edit'],
  ['Write, Edit, MultiEdit', 'write, edit'],
  ['Write/Edit', 'write/edit'],
  ['Qoder', 'DSH'],
];

export function normalizeLanguage(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'en' || text.startsWith('en-')) return 'en';
  return 'zh';
}

export function adaptContent(content, language = 'zh') {
  let text = String(content || '');
  for (const [from, to] of REPLACEMENTS) {
    text = text.split(from).join(to);
  }
  const header =
    normalizeLanguage(language) === 'en'
      ? '> SpecGate adaptation: paths and tool names in this file are mapped to DSH equivalents.\n\n'
      : '> SpecGate 适配：本文件中的路径与工具名已替换为 DSH 等价物。\n\n';
  const marker = normalizeLanguage(language) === 'en' ? '> SpecGate adaptation:' : '> SpecGate 适配：';
  if (!text.startsWith(marker)) text = header + text;
  return text;
}

function zhVariant(base) {
  if (/\.zh\.md(\.template)?$/i.test(base)) return base;
  if (/\.md\.template$/i.test(base)) return base.replace(/\.md\.template$/i, '.zh.md.template');
  if (/\.md$/i.test(base)) return base.replace(/\.md$/i, '.zh.md');
  if (/\.template$/i.test(base)) return base.replace(/\.template$/i, '.zh.template');
  return null;
}

function baseOf(file) {
  if (/\.zh\.md\.template$/i.test(file)) return file.replace(/\.zh\.md\.template$/i, '.md.template');
  if (/\.zh\.md$/i.test(file)) return file.replace(/\.zh\.md$/i, '.md');
  if (/\.zh\.template$/i.test(file)) return file.replace(/\.zh\.template$/i, '.template');
  return file;
}

function selectVariant(base, language) {
  if (normalizeLanguage(language) === 'zh') {
    const zh = zhVariant(base);
    if (zh && exists(zh)) return zh;
  }
  if (exists(base)) return base;
  const zh = zhVariant(base);
  return zh && exists(zh) ? zh : base;
}

function isTextAsset(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === '.md' || ext === '.mdx' || ext === '.template';
}

export function listSkillAssets(language = 'zh') {
  const skillsRoot = path.join(assetsRoot, 'skills');
  return walkFiles(skillsRoot)
    .filter((file) => /[\\/]SKILL\.md$/i.test(file) && !/\.zh\.md$/i.test(file))
    .map((base) => {
      const file = selectVariant(base, language);
      const raw = readIfExists(file) || '';
      const { data, body } = parseFrontmatter(raw);
      const dir = path.dirname(base);
      const name = String(data.name || path.basename(dir));
      return {
        name,
        description: String(data.description || ''),
        whenToUse: data.whenToUse ? String(data.whenToUse) : undefined,
        disableModelInvocation: data['disable-model-invocation'] === true,
        userInvocable: data['user-invocable'] !== false,
        dir,
        file,
        body,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listAgentAssets(language = 'zh') {
  const agentsRoot = path.join(assetsRoot, 'agents');
  return walkFiles(agentsRoot)
    .filter((file) => file.endsWith('.md') && !/\.zh\.md$/i.test(file))
    .map((base) => ({
      file: selectVariant(base, language),
      targetName: path.basename(base),
      name: path.basename(base, '.md'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function groupByBase(srcDir) {
  const groups = new Map();
  for (const file of walkFiles(srcDir)) {
    const base = baseOf(file);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(file);
  }
  return groups;
}

function copyDirTransformed(srcDir, destDir, options = {}) {
  const { force = false, language = 'zh' } = options;
  let created = 0;
  let skipped = 0;
  if (!exists(srcDir)) return { created, skipped };

  for (const [base, variants] of groupByBase(srcDir)) {
    const selected = selectVariant(base, language);
    let relative = path.relative(srcDir, base);
    if (!exists(selected)) continue;
    if (!exists(base) && variants.length > 0 && selected === base) continue;
    relative = relative.replace(/\.zh\.md$/i, '.md');
    const target = path.join(destDir, relative);
    if (exists(target) && !force) {
      skipped += 1;
      continue;
    }
    ensureDir(path.dirname(target));
    if (isTextAsset(selected)) {
      writeFile(target, adaptContent(readIfExists(selected) || '', language));
    } else {
      fs.copyFileSync(selected, target);
    }
    created += 1;
  }
  return { created, skipped };
}

function copyOneAsset(baseSrc, dest, options = {}) {
  if (!exists(baseSrc)) return { created: 0, skipped: 0 };
  const selected = selectVariant(baseSrc, options.language || 'zh');
  if (!exists(selected)) return { created: 0, skipped: 0 };
  if (exists(dest) && !options.force) return { created: 0, skipped: 1 };
  writeFile(dest, adaptContent(readIfExists(selected) || '', options.language || 'zh'));
  return { created: 1, skipped: 0 };
}

function copyTemplateTree(srcDir, destDir, options = {}) {
  const { force = false, language = 'zh' } = options;
  let created = 0;
  let skipped = 0;
  if (!exists(srcDir)) return { created, skipped };

  for (const [base, variants] of groupByBase(srcDir)) {
    const selected = selectVariant(base, language);
    if (!exists(selected)) continue;
    if (!exists(base) && variants.length > 0 && selected === base) continue;
    const relative = path.relative(srcDir, base).replace(/\.template$/i, '');
    const target = path.join(destDir, relative);
    if (exists(target) && !force) {
      skipped += 1;
      continue;
    }
    const ext = path.extname(selected).toLowerCase();
    ensureDir(path.dirname(target));
    if (ext === '.template' || ext === '.md') {
      writeFile(target, adaptContent(readIfExists(selected) || '', language));
    } else {
      fs.copyFileSync(selected, target);
    }
    created += 1;
  }
  return { created, skipped };
}

export function copySkillsToProject(root, options = {}) {
  const skills = listSkillAssets(options.language);
  let created = 0;
  let skipped = 0;
  for (const skill of skills) {
    const target = path.join(root, '.dsh', 'skills', 'specgate', skill.name);
    const result = copyDirTransformed(skill.dir, target, options);
    created += result.created;
    skipped += result.skipped;
  }
  return { total: skills.length, created, skipped };
}

export function copyAgentsToProject(root, options = {}) {
  const target = path.join(root, '.specgate', 'agents');
  ensureDir(target);
  let created = 0;
  let skipped = 0;
  for (const agent of listAgentAssets(options.language)) {
    const dest = path.join(target, agent.targetName);
    if (exists(dest) && !options.force) {
      skipped += 1;
      continue;
    }
    writeFile(dest, adaptContent(readIfExists(agent.file) || '', options.language));
    created += 1;
  }
  return { total: listAgentAssets(options.language).length, created, skipped };
}

export function copyTemplatesToProject(root, options = {}) {
  const src = path.join(assetsRoot, 'templates');
  const target = path.join(root, '.specgate', 'templates');
  if (!exists(src)) return { created: 0, skipped: 0 };
  return copyDirTransformed(src, target, options);
}

export function copyReferenceToProject(root, options = {}) {
  const pairs = [
    [path.join(assetsRoot, 'commands'), path.join(root, '.specgate', 'templates', 'commands')],
    [path.join(assetsRoot, 'rules'), path.join(root, '.specgate', 'templates', 'rules')],
  ];
  let created = 0;
  let skipped = 0;
  for (const [src, target] of pairs) {
    if (!exists(src)) continue;
    const result = copyDirTransformed(src, target, options);
    created += result.created;
    skipped += result.skipped;
  }
  return { created, skipped };
}

export function copyKnowledgeToProject(root, options = {}) {
  const force = Boolean(options.force);
  const minimal = Boolean(options.minimal);
  const language = options.language || 'zh';
  let created = 0;
  let skipped = 0;
  const add = (result) => {
    created += result.created;
    skipped += result.skipped;
  };

  add(
    copyOneAsset(
      path.join(assetsRoot, 'experiences', 'index.md'),
      path.join(root, '.specgate', 'experiences', 'index.md'),
      { force, language },
    ),
  );
  add(
    copyOneAsset(
      path.join(assetsRoot, 'experiences', 'trigger-guide.md'),
      path.join(root, '.specgate', 'experiences', 'trigger-guide.md'),
      { force, language },
    ),
  );

  if (!minimal) {
    add(
      copyDirTransformed(
        path.join(assetsRoot, 'experiences', 'rules'),
        path.join(root, '.specgate', 'rules'),
        { force, language },
      ),
    );
    add(
      copyDirTransformed(
        path.join(assetsRoot, 'specgate'),
        path.join(root, '.specgate'),
        { force, language },
      ),
    );
  }
  return { created, skipped };
}

export function copyDocsToProject(root, options = {}) {
  const language = options.language || 'zh';
  let created = 0;
  let skipped = 0;
  const add = (result) => {
    created += result.created;
    skipped += result.skipped;
  };
  add(
    copyTemplateTree(
      path.join(assetsRoot, 'templates', 'prd'),
      path.join(root, 'docs', 'prd'),
      { ...options, language },
    ),
  );
  add(
    copyTemplateTree(
      path.join(assetsRoot, 'templates', 'architecture'),
      path.join(root, 'docs', 'architecture'),
      { ...options, language },
    ),
  );
  add(
    copyOneAsset(
      path.join(assetsRoot, 'templates', 'CONTEXT.md'),
      path.join(root, 'CONTEXT.md'),
      { ...options, language },
    ),
  );
  return { created, skipped };
}

export function copyExampleToProject(root, options = {}) {
  return copyDirTransformed(
    path.join(assetsRoot, 'examples', 'example-change'),
    path.join(root, 'docs', 'specgate', 'examples', 'example-change'),
    options,
  );
}

const MINIMAL_AGENTS_ZH = `## SpecGate 工作流（DSH）

- 任何修改请求先做入口判定（答疑 / 轻量 / 重量）；重量修改先确认需求（G1）与范式（G2）。
- 门控：G1 需求、G2 分类、G3 proposal、G4 design、G5 specs、G6 tasks、G7 实施、G8 审查、G9 提交、G10 验收、G11 分支。
- 写 proposal 前需 G1/G2；写 design 前需 G3；写 specs 前需 G4；写 tasks 前需 G5；写源码前需 G6/G7。
- 跳过门控必须调用 sg_gate 的 waive 动作，并记录到 .specgate/deviations.log。
- 状态查询：/sg-status；下一步：/sg-next；门控操作：/sg-gate <Gx>。`;

const MINIMAL_AGENTS_EN = `## SpecGate workflow (DSH)

- Classify every change request first (question / light / heavy); heavy changes need G1 (requirements) and G2 (paradigm).
- Gates: G1 requirements, G2 classification, G3 proposal, G4 design, G5 specs, G6 tasks, G7 implementation, G8 review, G9 commit, G10 acceptance, G11 branch.
- proposal needs G1/G2; design needs G3; specs need G4; tasks need G5; source needs G6/G7.
- Skipping a gate requires sg_gate waive and a .specgate/deviations.log entry.
- Status: /sg-status; next: /sg-next; gates: /sg-gate <Gx>.`;

const MARKER_RE = /<!-- specgate:begin -->[\s\S]*?<!-- specgate:end -->/;

function agentsContent(full, language = 'zh') {
  const zh = normalizeLanguage(language) === 'zh';
  if (!full) return zh ? MINIMAL_AGENTS_ZH : MINIMAL_AGENTS_EN;
  const base = path.join(assetsRoot, 'AGENTS.full.md');
  const selected = selectVariant(base, language);
  const fallback = zh ? MINIMAL_AGENTS_ZH : MINIMAL_AGENTS_EN;
  return (readIfExists(selected) || fallback).trim();
}

function wrapAgentsSection(content) {
  return `<!-- specgate:begin -->\n${content.trim()}\n<!-- specgate:end -->`;
}

function backupAgents(root, current) {
  const dir = path.join(root, '.specgate', 'backups');
  ensureDir(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `AGENTS.md.${stamp}`);
  writeFile(target, current);
  return target;
}

export function writeAgentsSection(root, options = {}) {
  const full = options.full !== false;
  const language = options.language || 'zh';
  const section = wrapAgentsSection(agentsContent(full, language));
  const file = path.join(root, 'AGENTS.md');
  const current = readIfExists(file);

  if (current === null) {
    writeFile(file, `${section}\n`);
    return {
      created: true,
      appended: false,
      replaced: false,
      backedUp: false,
      unchanged: false,
      backup: null,
    };
  }

  const match = current.match(MARKER_RE);
  if (match) {
    if (match[0].trim() === section.trim()) {
      return {
        created: false,
        appended: false,
        replaced: false,
        backedUp: false,
        unchanged: true,
        backup: null,
      };
    }
    const backup = backupAgents(root, current);
    writeFile(file, current.replace(MARKER_RE, section));
    return {
      created: false,
      appended: false,
      replaced: true,
      backedUp: true,
      unchanged: false,
      backup,
    };
  }

  const backup = backupAgents(root, current);
  writeFile(file, `${current.trimEnd()}\n\n${section}\n`);
  return {
    created: false,
    appended: true,
    replaced: false,
    backedUp: true,
    unchanged: false,
    backup,
  };
}

export function appendAgentsSection(root) {
  return writeAgentsSection(root, { full: false });
}

export function countMaterializedSkills(root) {
  const dir = path.join(root, '.dsh', 'skills', 'specgate');
  if (!exists(dir)) return 0;
  return walkFiles(dir).filter((file) => /[\\/]SKILL\.md$/i.test(file)).length;
}
