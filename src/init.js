import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG } from './constants.js';
import {
  copyAgentsToProject,
  copyDocsToProject,
  copyExampleToProject,
  copyKnowledgeToProject,
  copyReferenceToProject,
  copySkillsToProject,
  copyTemplatesToProject,
  normalizeLanguage,
  writeAgentsSection,
} from './assets.js';
import { gitAddAndCommit, gitInit, gitStatus } from './git.js';
import { ensureRequirementsSkeleton } from './requirements.js';
import { loadProject, setEnabled } from './project.js';
import {
  ensureDir,
  exists,
  isSubPath,
  listDir,
  renderConfig,
  writeIfAbsent,
} from './util.js';

export class InitError extends Error {
  constructor(message, code = 'INIT_ERROR') {
    super(message);
    this.name = 'InitError';
    this.code = code;
  }
}

const SpecGate_README = `# .specgate 目录

本目录由 dsh-plugin-specgate 管理。

- \`config.yaml\`：项目级配置（enabled / enforcement / paradigm / git / minimal）。
- \`gates/\`：门控标记（\`G1.confirmed\`、\`G4.waived\` 等）。
- \`deviations.log\`：跳过门控的偏离记录，append-only。
- \`agents/\`：SpecGate 角色文本。
- \`templates/\`：SpecGate 模板、命令与规则参考。
- \`rules/\`：模块级规则（CLI / core / tests / types / docs）。
- \`briefs/\`：Agent Brief 模板与产物。
- \`out-of-scope/\`：明确不做的范围记录。
- \`experiences/\`：知识沉淀（index / trigger-guide / tool-research / best-practices / pitfall-records / decisions）。
- \`backups/\`：AGENTS.md 等文件的备份。
- \`reviews/\`：审查记录。
`;

export function ensureSpecgateSkeleton(root, options = {}) {
  const minimal = Boolean(options.minimal);
  const specgateDir = path.join(root, '.specgate');
  ensureDir(specgateDir);
  ensureDir(path.join(specgateDir, 'gates'));
  ensureDir(path.join(specgateDir, 'reviews'));
  ensureDir(path.join(specgateDir, 'experiences', 'tool-research'));
  ensureDir(path.join(specgateDir, 'experiences', 'best-practices'));
  ensureDir(path.join(specgateDir, 'experiences', 'pitfall-records'));
  ensureDir(path.join(specgateDir, 'experiences', 'decisions'));

  if (!minimal) {
    ensureDir(path.join(specgateDir, 'agents'));
    ensureDir(path.join(specgateDir, 'templates'));
    ensureDir(path.join(specgateDir, 'rules'));
    ensureDir(path.join(specgateDir, 'briefs'));
    ensureDir(path.join(specgateDir, 'out-of-scope'));
  }

  ensureDir(path.join(root, 'openspec', 'changes'));
  ensureDir(path.join(root, 'openspec', 'specs'));
  ensureDir(path.join(root, 'openspec', 'changes', 'archive'));
}

function resolveTarget(base, options) {
  const basePath = path.resolve(base);
  if (!exists(basePath)) ensureDir(basePath);
  const rawPath =
    options.path === undefined || options.path === null || options.path === ''
      ? null
      : String(options.path);
  const explicitPath = rawPath !== null;
  const target = explicitPath ? path.resolve(basePath, rawPath) : basePath;

  if (target === path.parse(target).root) {
    throw new InitError('不能初始化文件系统根目录', 'TARGET_IS_ROOT');
  }
  if (target !== basePath && isSubPath(target, basePath)) {
    throw new InitError('不能把当前目录的父目录作为初始化目标', 'TARGET_IS_PARENT');
  }

  let createdTarget = false;
  if (exists(target)) {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      throw new InitError(`目标不是目录：${target}`, 'TARGET_NOT_DIRECTORY');
    }
  } else {
    ensureDir(target);
    createdTarget = true;
  }

  const entries = listDir(target);
  if (explicitPath && entries.length > 0 && !options.force) {
    throw new InitError(
      `目标目录非空：${target}。使用 --force 合并，或换一个空目录。`,
      'TARGET_NOT_EMPTY',
    );
  }

  return { base: basePath, target, createdTarget, hadEntries: entries.length > 0 };
}

function prepareGit(target, enabled) {
  if (!enabled) {
    return {
      git: { enabled: false, initialized: false, committed: false, reason: '--no-git' },
      preDirty: 0,
    };
  }

  let pre = { isRepo: false, dirty: 0 };
  let initialized = false;
  try {
    pre = gitStatus(target);
    if (!pre.isRepo) {
      gitInit(target);
      initialized = true;
      pre = gitStatus(target);
    }
  } catch (error) {
    throw new InitError(
      `Git 初始化失败：${error.message}。可使用 --no-git 跳过 Git。`,
      'GIT_INIT_FAILED',
    );
  }

  return {
    git: { enabled: true, initialized, wasDirty: pre.dirty > 0 },
    preDirty: pre.dirty,
  };
}

function finalizeGit(target, git, preDirty) {
  if (!git.enabled) return git;
  if (preDirty > 0) {
    return { ...git, committed: false, skipped: 'working tree dirty before init' };
  }
  try {
    return { ...git, ...gitAddAndCommit(target, 'chore(specgate): 初始化工作流项目') };
  } catch (error) {
    return { ...git, committed: false, error: error.message };
  }
}

export function initProject(root, options = {}) {
  const { target, createdTarget, hadEntries } = resolveTarget(root, options);
  const minimal = Boolean(options.minimal);
  const force = Boolean(options.force);
  const gitEnabled = options.git !== false;
  const language = normalizeLanguage(options.language);
  const requirements = options.requirements === true;
  const materializeSkills = options.materializeSkills !== false;
  const materializeAgents = options.materializeAgents !== false;

  const { git: gitBase, preDirty } = prepareGit(target, gitEnabled);

  ensureSpecgateSkeleton(target, { minimal });
  const created = [];
  const skipped = [];

  const configPath = path.join(target, '.specgate', 'config.yaml');
  const configExisted = exists(configPath);
  if (
    writeIfAbsent(
      configPath,
      renderConfig({
        ...DEFAULT_CONFIG,
        workflowVersion: requirements ? 2 : 1,
        enabled: options.enabled !== false && options.disabled !== true,
        enforcement: options.enforcement || DEFAULT_CONFIG.enforcement,
        language,
        maxConcurrency: Number(options.maxConcurrency) > 0
          ? Number(options.maxConcurrency)
          : DEFAULT_CONFIG.maxConcurrency,
        materializeSkills,
        materializeAgents,
        git: gitEnabled,
        minimal,
      }),
    )
  ) {
    created.push('.specgate/config.yaml');
  } else {
    skipped.push('.specgate/config.yaml');
  }
  if (configExisted && options.disabled === true) setEnabled(target, false);

  if (requirements) ensureRequirementsSkeleton(target, { language });

  const deviationsPath = path.join(target, '.specgate', 'deviations.log');
  if (writeIfAbsent(deviationsPath, '# SpecGate deviations (append-only)\n\n')) {
    created.push('.specgate/deviations.log');
  } else {
    skipped.push('.specgate/deviations.log');
  }

  const statePath = path.join(target, '.specgate', 'workflow-state.yaml');
  if (
    writeIfAbsent(
      statePath,
      '# Computed by dsh-plugin-specgate. Do not hand-edit state fields.\nupdated_at: null\n',
    )
  ) {
    created.push('.specgate/workflow-state.yaml');
  } else {
    skipped.push('.specgate/workflow-state.yaml');
  }

  if (writeIfAbsent(path.join(target, '.specgate', 'README.md'), SpecGate_README)) {
    created.push('.specgate/README.md');
  } else {
    skipped.push('.specgate/README.md');
  }

  const skills = materializeSkills
    ? copySkillsToProject(target, { force, language })
    : { total: 30, created: 0, skipped: 30 };
  let agents = { total: 0, created: 0, skipped: 0 };
  let templates = { created: 0, skipped: 0 };
  let reference = { created: 0, skipped: 0 };
  let knowledge = { created: 0, skipped: 0 };
  let docs = { created: 0, skipped: 0 };
  let example = { created: 0, skipped: 0 };

  let agentsSection;
  if (minimal) {
    knowledge = copyKnowledgeToProject(target, { force, minimal: true, language });
    agentsSection = writeAgentsSection(target, { full: false, language });
  } else {
    if (materializeAgents) {
      agents = copyAgentsToProject(target, { force, language });
    }
    templates = copyTemplatesToProject(target, { force, language });
    reference = copyReferenceToProject(target, { force, language });
    knowledge = copyKnowledgeToProject(target, { force, language });
    if (options.docs !== false) docs = copyDocsToProject(target, { force, language });
    if (options.example !== false) example = copyExampleToProject(target, { force, language });
    try {
      agentsSection = writeAgentsSection(target, { full: true, language });
    } catch (error) {
      agentsSection = { error: error.message };
    }
  }

  const git = finalizeGit(target, gitBase, preDirty);

  return {
    root: target,
    base: path.resolve(root),
    createdTarget,
    hadEntries,
    minimal,
    git,
    created,
    skipped,
    skills,
    agents,
    templates,
    reference,
    knowledge,
    docs,
    example,
    agentsSection,
    project: loadProject(target),
  };
}

export function enableProject(root, options = {}) {
  if (!exists(path.join(root, '.specgate'))) {
    const report = initProject(root, options);
    return { initialized: true, report };
  }
  setEnabled(root, true);
  return { initialized: false, report: null };
}

export function disableProject(root) {
  if (!exists(path.join(root, '.specgate'))) {
    return { changed: false, reason: '项目尚未初始化' };
  }
  setEnabled(root, false);
  return { changed: true };
}

function gitLine(git, language = 'zh') {
  const en = normalizeLanguage(language) === 'en';
  if (!git || git.enabled === false) return en ? 'Git: disabled (--no-git)' : 'Git：未启用（--no-git）';
  if (git.error) return en ? `Git: failed (${git.error})` : `Git：失败（${git.error}）`;
  if (git.committed) {
    return en
      ? `Git: initial commit ${git.hash} (${git.files} files)`
      : `Git：初始提交 ${git.hash}（${git.files} 个文件）`;
  }
  if (git.skipped) return en ? `Git: initial commit skipped (${git.skipped})` : `Git：跳过初始提交（${git.skipped}）`;
  if (git.reason) return en ? `Git: ${git.reason}` : `Git：${git.reason}`;
  return en ? 'Git: initialized, no initial commit' : 'Git：已初始化，无初始提交';
}

function agentsLine(section, minimal = false, language = 'zh') {
  const en = normalizeLanguage(language) === 'en';
  const label = minimal ? (en ? 'minimal' : '精简') : en ? 'full' : '完整';
  if (!section) return en ? 'AGENTS.md: not processed' : 'AGENTS.md：未处理';
  if (section.error) return en ? `AGENTS.md: failed (${section.error})` : `AGENTS.md：失败（${section.error}）`;
  if (section.created) return en ? `AGENTS.md: created ${label} rules` : `AGENTS.md：已创建${label}规则`;
  if (section.replaced) {
    return en
      ? `AGENTS.md: updated the SpecGate ${label} section${section.backup ? ` (backup: ${section.backup})` : ''}`
      : `AGENTS.md：已更新 SpecGate ${label}段落${section.backup ? `（备份：${section.backup}）` : ''}`;
  }
  if (section.appended) {
    return en
      ? `AGENTS.md: appended the SpecGate ${label} section${section.backup ? ` (backup: ${section.backup})` : ''}`
      : `AGENTS.md：已追加 SpecGate ${label}段落${section.backup ? `（备份：${section.backup}）` : ''}`;
  }
  return en ? 'AGENTS.md: already present, unchanged' : 'AGENTS.md：已存在且无变化';
}

export function renderInitReport(report, language = 'zh') {
  const en = normalizeLanguage(language) === 'en';
  const lines = en
    ? ['SpecGate initialization complete', `Project: ${report.root}`, '']
    : ['SpecGate 初始化完成', `项目：${report.root}`, ''];
  if (report.createdTarget) lines.push(en ? 'Created directory: yes' : '新建目录：是');
  lines.push(en ? `Mode: ${report.minimal ? 'minimal' : 'full'}` : `模式：${report.minimal ? 'minimal' : 'full'}`);
  lines.push(gitLine(report.git, language));
  lines.push('');
  if (en) {
    lines.push(`Skills: ${report.skills.total}, ${report.skills.created} files created, ${report.skills.skipped} skipped`);
    lines.push(`Agents: ${report.agents.total}, ${report.agents.created} created, ${report.agents.skipped} skipped`);
    lines.push(`Templates: ${report.templates.created} created, ${report.templates.skipped} skipped`);
    lines.push(`Reference commands/rules: ${report.reference.created} created, ${report.reference.skipped} skipped`);
    lines.push(`Knowledge/module rules: ${report.knowledge.created} created, ${report.knowledge.skipped} skipped`);
    lines.push(`Documentation templates: ${report.docs.created} created, ${report.docs.skipped} skipped`);
    lines.push(`Example change: ${report.example.created} created, ${report.example.skipped} skipped`);
  } else {
    lines.push(`技能：${report.skills.total} 个，新增 ${report.skills.created} 个文件，跳过 ${report.skills.skipped} 个`);
    lines.push(`Agent：${report.agents.total} 个，新增 ${report.agents.created}，跳过 ${report.agents.skipped}`);
    lines.push(`模板：新增 ${report.templates.created}，跳过 ${report.templates.skipped}`);
    lines.push(`参考命令/规则：新增 ${report.reference.created}，跳过 ${report.reference.skipped}`);
    lines.push(`知识资产/模块规则：新增 ${report.knowledge.created}，跳过 ${report.knowledge.skipped}`);
    lines.push(`文档模板：新增 ${report.docs.created}，跳过 ${report.docs.skipped}`);
    lines.push(`示例 Change：新增 ${report.example.created}，跳过 ${report.example.skipped}`);
  }
  lines.push(agentsLine(report.agentsSection, report.minimal, language));
  if (report.created.length > 0) {
    lines.push('');
    lines.push(en ? 'Created:' : '创建：');
    for (const item of report.created) lines.push(`  + ${item}`);
  }
  lines.push('');
  lines.push(
    en
      ? 'Next: /sg-status for status; /sg-gate G1 to start gates; /sg-commit to commit changes.'
      : '下一步：/sg-status 查看状态；/sg-gate G1 开始门控；/sg-commit 提交变更。',
  );
  return lines.join('\n');
}
