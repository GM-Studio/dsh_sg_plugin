import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, exists, readText, writeText } from './util/fsx.js';
import { init as initState, load as loadState, save as saveState, patchState } from './state.js';

export const CONFIG_FILE = 'config.yaml';
export const CHANGE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const IGNORE_ENTRIES = [
  '.specgate/state.json',
  '.specgate/run.lock',
  '.specgate/worktrees/',
  '.specgate/evidence/',
  '.specgate/backups/',
];

const CONFIG_TEMPLATE = `# SpecGate v3 项目配置
workflowVersion: 3
schemaVersion: 3
language: zh
# 测试命令（argv 数组）。留空时回退到 package.json 的 scripts["test:json"]。
testing:
  command: []
  cwd: "."
# 同一波内并行任务上限（1-4）
maxParallel: 2
coverage:
  blocking: false
`;

function parseScalar(raw) {
  const text = String(raw || '').trim();
  if (text === '') return '';
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

/** Minimal YAML reader: flat keys plus one nested section. */
export function parseConfig(text) {
  const result = {};
  let section = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^\s*/)[0].length;
    const match = line.trim().match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (indent === 0) {
      if (value === '') {
        section = key;
        result[key] = result[key] && typeof result[key] === 'object' ? result[key] : {};
      } else {
        section = null;
        result[key] = parseScalar(value);
      }
    } else if (section) {
      result[section][key] = parseScalar(value);
    }
  }
  return result;
}

export function configPath(root) {
  return path.join(root, '.specgate', CONFIG_FILE);
}

export function readConfig(root) {
  const file = configPath(root);
  if (!exists(file)) return null;
  return parseConfig(readText(file));
}

export function ensureGitignore(root) {
  const file = path.join(root, '.gitignore');
  const current = exists(file) ? readText(file) : '';
  const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = IGNORE_ENTRIES.filter((entry) => !lines.has(entry));
  if (missing.length === 0) return { ok: true, added: [] };
  const prefix = current && !current.endsWith('\n') ? `${current}\n` : current;
  writeText(file, `${prefix}${missing.join('\n')}\n`);
  return { ok: true, added: missing };
}

export function initProject(root, options = {}) {
  const specgateDir = path.join(root, '.specgate');
  const configFile = configPath(root);

  if (exists(configFile)) {
    const config = parseConfig(readText(configFile));
    const version = Number(config.workflowVersion);
    if (!options.force && Number.isFinite(version) && version < 3) {
      return {
        ok: false,
        code: 'WORKFLOW_VERSION_MISMATCH',
        message: `项目 workflowVersion=${version}，v3 不能直接接管`,
        fix: '先执行 /sg-migrate-v3（MVP 未提供），或在一个干净目录初始化',
      };
    }
  }

  const created = [];
  for (const dir of [
    specgateDir,
    path.join(specgateDir, 'worktrees'),
    path.join(specgateDir, 'evidence'),
    path.join(specgateDir, 'backups'),
    path.join(root, 'openspec', 'specs'),
    path.join(root, 'openspec', 'changes'),
  ]) {
    if (!exists(dir)) {
      ensureDir(dir);
      created.push(path.relative(root, dir));
    }
  }

  if (!exists(configFile)) {
    writeText(configFile, CONFIG_TEMPLATE);
    created.push('.specgate/config.yaml');
  }

  for (const keep of [
    path.join(root, 'openspec', 'specs', '.gitkeep'),
    path.join(root, 'openspec', 'changes', '.gitkeep'),
  ]) {
    if (!exists(keep)) {
      writeText(keep, '');
      created.push(path.relative(root, keep));
    }
  }

  const ignore = ensureGitignore(root);
  const state = initState(root);
  if (!state.ok) return state;

  return {
    ok: true,
    root,
    created,
    ignored: ignore.added,
    state: state.state,
    reused: state.reused,
  };
}

export function createChange(root, { name, type = 'feature', baseCommit = null } = {}) {
  if (!CHANGE_NAME_PATTERN.test(String(name || ''))) {
    return {
      ok: false,
      code: 'INVALID_CHANGE_NAME',
      message: `change 名不合法：${String(name)}`,
      fix: '使用 kebab-case，例如 add-login',
    };
  }
  if (!['feature', 'modify', 'fix', 'remove'].includes(type)) {
    return {
      ok: false,
      code: 'INVALID_CHANGE_TYPE',
      message: `变更类型不合法：${String(type)}`,
      fix: 'type 只能是 feature / modify / fix / remove',
    };
  }

  const loaded = loadState(root);
  if (!loaded.ok) return loaded;
  const { state } = loaded;
  if (state.change && !['DONE', 'ABORTED', 'IDLE'].includes(state.phase)) {
    return {
      ok: false,
      code: 'CHANGE_ACTIVE',
      message: `已有进行中的 change：${state.change}（${state.phase}）`,
      fix: '先 /sg-abort 或完成当前 change',
    };
  }

  const changeDir = path.join(root, 'openspec', 'changes', name);
  if (exists(changeDir)) {
    return {
      ok: false,
      code: 'CHANGE_EXISTS',
      message: `change 已存在：${name}`,
      fix: '换一个名字，或删除已有目录',
    };
  }

  ensureDir(changeDir);
  const files = {
    'proposal.md': proposalTemplate(name, type),
    'design.md': designTemplate(name, type),
    'tasks.md': tasksTemplate(name),
    'tests/cases.md': casesTemplate(),
    'tests/mapping.json': `${JSON.stringify({ schemaVersion: 1, change: name, requirements: [], automation: [] }, null, 2)}\n`,
    'tests/touched.json': `${JSON.stringify({ schemaVersion: 1, modify: [], delete: [], bootstrap: [] }, null, 2)}\n`,
  };
  for (const [relative, content] of Object.entries(files)) {
    writeText(path.join(changeDir, relative), content);
  }
  ensureDir(path.join(changeDir, 'tests', 'automation'));
  ensureDir(path.join(changeDir, 'specs'));

  const saved = patchState(root, (draft) => {
    draft.change = name;
    draft.type = type;
    draft.baseCommit = baseCommit;
    draft.phase = 'H1_PENDING';
    draft.tasks = {};
    draft.waves = [];
    draft.touched = { modify: [], delete: [], bootstrap: [] };
    draft.integration = null;
    draft.blockedReason = null;
    draft.baseline = { specsBase: null, artifactHash: null, approvedAt: null };
    draft.plan = {
      designHash: null,
      casesHash: null,
      mappingHash: null,
      touchedHash: null,
      planHash: null,
      cmdHash: null,
      argv: [],
      cwd: '.',
      approvedAt: null,
    };
    draft.approvals = {
      H1: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
      H2: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
      H3: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
    };
    draft.evidence = { headSeq: 0, headHash: null };
  });
  if (!saved.ok) return saved;

  return { ok: true, root, name, type, changeDir, state: saved.state };
}

function proposalTemplate(name, type) {
  return `# 变更提案：${name}

- 类型：${type}
- 状态：Draft

## 问题

<!-- 当前存在什么问题？请具体到行为，不要写解决方案。 -->

## 目标

<!-- 完成后系统应该表现出的行为。 -->

## 非目标

<!-- 本次明确不做的内容。 -->

## 影响面

<!-- 涉及的 capability、模块、可能的回归面。 -->
`;
}

function designTemplate(name, type) {
  return `# 方案：${name}

- 类型：${type}

## 目标与非目标

## 任务图

<!-- 说明任务如何切分、哪些可并行；任务细节写进 tasks.md。 -->

## AC 到用例

<!-- 每个 AC 至少一个用例，用例写进 tests/cases.md 与 mapping.json。 -->

## 风险
`;
}

function tasksTemplate(name) {
  return `# 任务：${name}

<!-- 每个任务一个标题，紧跟一行 sg:task 元数据；勾选状态由编排器维护。 -->

## T-001 第一个任务
<!-- sg:task {"id":"T-001","title":"第一个任务","ac":["AC-001"],"deps":[],"parallel":false} -->
- [ ] 待填写
`;
}

function casesTemplate() {
  return `# 测试用例

| 用例 | AC | 层次 | 描述 |
|---|---|---|---|
| TC-001 | AC-001 | unit | 待填写 |
`;
}
