import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitSafeDirectory } from '../git-path.js';
import { ensureDir, exists, readText, writeText } from './util/fsx.js';
import { load as loadState } from './state.js';
import { init as initState, patchState } from './project-facts.js';
import { REQ_VERSION, isRequirementsFrozen } from './requirements.js';
import { loadTemplateStyle } from './template-style.js';
import { CHANGE_TYPES, CHANGE_TYPE_HINT } from './change-types.js';

export const CONFIG_FILE = 'config.yaml';
export const CHANGE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CHANGE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

const IGNORE_ENTRIES = [
  '.specgate/state.json',
  '.specgate/run.lock',
  '.specgate/init-result.json',
  '.specgate/worktrees/',
  '.specgate/evidence/',
  '.specgate/backups/',
  '.specgate/gates/',
  '.specgate/runs/',
];

const CONFIG_TEMPLATE = `# SpecGate Codex 项目配置
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
# 需求基线（REQ.md）。enabled: true 时 sg-change/M1 会校验需求基线与 REQ 引用；
# /sg-init 完成需求确认后会自动置为 true，老项目保持 false 不受影响。
requirements:
  enabled: false
  version: v1.0
  doc: openspec/REQ.md
  history: openspec/history
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

/** Minimal YAML reader: flat keys, one nested section, and a `suites:` list of flat maps. */
export function parseConfig(text) {
  const result = {};
  let section = null;
  let suite = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^\s*/)[0].length;
    const trimmed = line.trim();

    if (section === 'suites' && indent > 0) {
      if (trimmed.startsWith('- ')) {
        suite = {};
        result.suites.push(suite);
        const rest = trimmed.slice(2).trim();
        if (rest) {
          const match = rest.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
          if (match) suite[match[1]] = parseScalar(match[2]);
        }
        continue;
      }
      if (suite) {
        const match = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
        if (match) suite[match[1]] = parseScalar(match[2]);
      }
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (indent === 0) {
      suite = null;
      if (value === '') {
        section = key;
        if (key === 'suites') {
          result.suites = [];
        } else {
          result[key] =
            result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
              ? result[key]
              : {};
        }
      } else {
        section = null;
        result[key] = parseScalar(value);
      }
    } else if (section && result[section] && typeof result[section] === 'object') {
      result[section][key] = parseScalar(value);
    }
  }
  return result;
}

export const SUITE_KINDS = ['node-test', 'pytest', 'command', 'maven'];
export const JAVA_JDK_VERSIONS = ['8', '11', '17', '21'];
export const JAVA_BUILD_TOOLS = ['maven'];

/** Normalize configured suites; fall back to the legacy single-suite shape. */
export function readSuites(config) {
  const raw = Array.isArray(config?.suites) ? config.suites : [];
  const installDefault = config?.install === undefined ? null : config.install !== false;
  if (raw.length === 0) {
    const command = Array.isArray(config?.testing?.command) ? config.testing.command : [];
    return [
      {
        id: 'default',
        kind: 'node-test',
        command: command.map(String),
        cwd: config?.testing?.cwd || '.',
        install: installDefault,
        timeoutMinutes: 20,
        pytestArgs: [],
        python: null,
        packageManager: null,
        node: config?.node ? String(config.node) : null,
        jdk: null,
        buildTool: null,
        goals: [],
        reportGlob: null,
        jacocoGlob: null,
        legacy: true,
      },
    ];
  }
  return raw.map((item, index) => ({
    id: String(item.id || `suite-${index + 1}`),
    kind: String(item.kind || 'node-test'),
    command: Array.isArray(item.command) ? item.command.map(String) : [],
    cwd: String(item.cwd || '.'),
    install: item.install === undefined ? installDefault : item.install !== false,
    timeoutMinutes: Number(item.timeoutMinutes) > 0 ? Number(item.timeoutMinutes) : 20,
    pytestArgs: Array.isArray(item.pytestArgs) ? item.pytestArgs.map(String) : [],
    python: item.python ? String(item.python) : null,
    packageManager: item.packageManager ? String(item.packageManager) : null,
    node: item.node ? String(item.node) : config?.node ? String(config.node) : null,
    jdk: item.jdk ? String(item.jdk) : null,
    buildTool: item.buildTool ? String(item.buildTool) : null,
    goals: Array.isArray(item.goals) ? item.goals.map(String) : [],
    reportGlob: item.reportGlob ? String(item.reportGlob) : null,
    jacocoGlob: item.jacocoGlob ? String(item.jacocoGlob) : null,
    legacy: false,
  }));
}

export function validateSuites(root, suites) {
  const errors = [];
  const ids = new Set();
  for (const suite of suites) {
    if (!CHANGE_NAME_PATTERN.test(suite.id)) {
      errors.push(`suite id 不合法：${suite.id}`);
    }
    if (ids.has(suite.id)) errors.push(`suite id 重复：${suite.id}`);
    ids.add(suite.id);
    if (!SUITE_KINDS.includes(suite.kind)) {
      errors.push(`suite ${suite.id} 的 kind 不合法：${suite.kind}`);
    }
    if (
      !suite.legacy &&
      suite.kind !== 'pytest' &&
      suite.kind !== 'maven' &&
      suite.command.length === 0
    ) {
      errors.push(`suite ${suite.id} 缺少 command`);
    }
    if (suite.jdk && !JAVA_JDK_VERSIONS.includes(String(suite.jdk))) {
      errors.push(`suite ${suite.id} 的 jdk 不合法：${suite.jdk}`);
    }
    if (suite.kind === 'maven') {
      const buildTool = suite.buildTool || 'maven';
      if (!JAVA_BUILD_TOOLS.includes(buildTool)) {
        errors.push(`suite ${suite.id} 的 buildTool 不合法：${buildTool}`);
      }
      if (!Array.isArray(suite.goals)) {
        errors.push(`suite ${suite.id} 的 goals 必须是数组`);
      }
    }
    if (
      suite.reportGlob !== null &&
      suite.reportGlob !== undefined &&
      typeof suite.reportGlob !== 'string'
    ) {
      errors.push(`suite ${suite.id} 的 reportGlob 必须是字符串`);
    }
    if (
      suite.jacocoGlob !== null &&
      suite.jacocoGlob !== undefined &&
      typeof suite.jacocoGlob !== 'string'
    ) {
      errors.push(`suite ${suite.id} 的 jacocoGlob 必须是字符串`);
    }
    const absolute = path.resolve(root, suite.cwd || '.');
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      errors.push(`suite ${suite.id} 的 cwd 逃逸仓库：${suite.cwd}`);
      continue;
    }
    if (suite.kind === 'maven' && !exists(path.join(absolute, 'pom.xml'))) {
      errors.push(`suite ${suite.id} 的 cwd 缺少 pom.xml：${suite.cwd || '.'}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * REQ-008: requirements enforcement is opt-in. Projects without the
 * `requirements` config block (all legacy projects) behave exactly as before.
 */
export function requirementsConfig(root) {
  const config = readConfig(root);
  const block = config?.requirements;
  if (!block || typeof block !== 'object') return { enabled: false, version: REQ_VERSION };
  return {
    enabled: block.enabled !== false,
    version: block.version ? String(block.version) : REQ_VERSION,
    doc: block.doc ? String(block.doc) : 'openspec/REQ.md',
  };
}

/** Rewrite `enabled`/`version` inside the requirements block, creating it when absent. */
export function patchConfigRequirements(root, { enabled, version } = {}) {
  const file = configPath(root);
  if (!exists(file)) return { ok: false, code: 'NO_CONFIG', message: '缺少 .specgate/config.yaml' };
  const text = readText(file);
  // configureSuites 会整体重写配置，这里在缺失时补回 requirements 块，避免静默关闭需求校验。
  if (!/^requirements:\s*$/m.test(text)) {
    const block = [
      'requirements:',
      `  enabled: ${enabled === undefined ? 'false' : enabled ? 'true' : 'false'}`,
      `  version: ${version || REQ_VERSION}`,
    ].join('\n');
    const prefix = text === '' || text.endsWith('\n') ? text : `${text}\n`;
    writeText(file, `${prefix}${block}\n`);
    return { ok: true, touched: 1, inserted: true };
  }
  const lines = text.split('\n');
  let inBlock = false;
  let touched = 0;
  const next = lines.map((line) => {
    if (/^requirements:\s*$/.test(line)) {
      inBlock = true;
      return line;
    }
    if (inBlock && /^\S/.test(line) && line.trim() !== '') {
      inBlock = false;
      return line;
    }
    if (!inBlock) return line;
    if (enabled !== undefined && /^\s+enabled:\s*/.test(line)) {
      touched += 1;
      return `  enabled: ${enabled ? 'true' : 'false'}`;
    }
    if (version !== undefined && /^\s+version:\s*/.test(line)) {
      touched += 1;
      return `  version: ${version}`;
    }
    return line;
  });
  writeText(file, next.join('\n'));
  return { ok: true, touched };
}

export function configPath(root) {
  return path.join(root, '.specgate', CONFIG_FILE);
}

export function readConfig(root) {
  const file = configPath(root);
  if (!exists(file)) return null;
  return parseConfig(readText(file));
}

export function ensureGitignore(root, { keepStateTracked = false } = {}) {
  const file = path.join(root, '.gitignore');
  const current = exists(file) ? readText(file) : '';
  const currentLines = current.split(/\r?\n/);
  const lines = new Set(currentLines.map((line) => line.trim()));
  const entries = IGNORE_ENTRIES.filter(
    (entry) => !(keepStateTracked && entry === '.specgate/state.json'),
  );
  const missing = entries.filter((entry) => !lines.has(entry));
  const keptLines = keepStateTracked
    ? currentLines.filter((line) => line.trim() !== '.specgate/state.json')
    : currentLines;
  const removedState = keepStateTracked && lines.has('.specgate/state.json');
  if (missing.length === 0 && !removedState) return { ok: true, added: [] };
  const prefix = keptLines.join('\n');
  const normalizedPrefix = prefix && !prefix.endsWith('\n') ? `${prefix}\n` : prefix;
  writeText(file, `${normalizedPrefix}${missing.join('\n')}\n`);
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
        message: `项目 workflowVersion=${version}，Codex 不能直接接管`,
        fix: '请在一个干净目录执行 Codex 初始化',
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

  const ignore = ensureGitignore(root, options);
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

export function createChange(
  root,
  { name, type = 'feature', baseCommit = null, changeKey = null, requirements = null } = {},
) {
  const style = loadTemplateStyle(root, {
    required: readConfig(root)?.templateStyle?.required === true,
  });
  if (!style.ok) return style;
  if (!CHANGE_NAME_PATTERN.test(String(name || ''))) {
    return {
      ok: false,
      code: 'INVALID_CHANGE_NAME',
      message: `change 名不合法：${String(name)}`,
      fix: '使用 kebab-case，例如 add-login',
    };
  }
  if (!CHANGE_TYPES.includes(type)) {
    return {
      ok: false,
      code: 'INVALID_CHANGE_TYPE',
      message: `变更类型不合法：${String(type)}`,
      fix: `type 只能是 ${CHANGE_TYPE_HINT}`,
    };
  }

  const initReportFile = path.join(root, '.specgate', 'init-report.json');
  const javaMarker = path.join(root, '.specgate', 'monorepo.json');
  let javaInit = false;
  if (exists(javaMarker)) {
    try {
      javaInit = JSON.parse(readText(javaMarker)).stack === 'java-vue';
    } catch {
      return { ok: false, code: 'INIT_REPORT_INVALID', message: '初始化元数据损坏' };
    }
  }
  if (javaInit && !exists(initReportFile))
    return { ok: false, code: 'INIT_QUALITY_PENDING', message: 'Java初始化缺少质量报告' };
  if (exists(initReportFile)) {
    let initReport;
    try {
      initReport = JSON.parse(readText(initReportFile));
    } catch {
      return {
        ok: false,
        code: 'INIT_REPORT_INVALID',
        message: '初始化报告损坏，不能提前发起变更',
      };
    }
    let templateVerified = false;
    if (javaInit && exists(path.join(root, '.specgate', 'golden.json'))) {
      try {
        templateVerified =
          JSON.parse(readText(path.join(root, '.specgate', 'golden.json'))).verified === true;
      } catch {
        templateVerified = false;
      }
    }
    if (javaInit && initReport.phase === 'GENERATED_ONLY' && !templateVerified)
      return {
        ok: false,
        code: 'INIT_TEMPLATE_UNVERIFIED',
        message:
          '该 Java 版本档的 Golden 模板尚未通过发版验收；先执行 /sg-verify 或完成模板验收后再创建 change',
      };
    if (
      javaInit &&
      (!initReport ||
        initReport.schemaVersion !== 2 ||
        !(
          (['SMOKE_PASSED', 'VERIFIED'].includes(initReport.phase) &&
            initReport.verification?.ok === true &&
            initReport.verification?.kind === 'local-sg-verify') ||
          (initReport.phase === 'GENERATED_ONLY' &&
            initReport.quality?.generateOnly === true &&
            JSON.parse(readText(javaMarker)).quality?.generateOnly === true) ||
          (initReport.phase === 'IDLE' &&
            initReport.initializationComplete === true &&
            /^[a-f0-9]{40,64}$/.test(initReport.archiveCommit || '') &&
            /^docs\/initialization\/archive\/[a-f0-9]{40,64}-(lenient|strict)\.json$/.test(
              initReport.archive || '',
            ) &&
            (() => {
              const committed = spawnSync(
                'git',
                [
                  '-c',
                  `safe.directory=${gitSafeDirectory(root)}`,
                  'show',
                  initReport.archiveCommit + ':' + initReport.archive,
                ],
                { cwd: root, encoding: 'utf8', timeout: 10000 },
              );
              if (committed.status !== 0 || !exists(path.join(root, initReport.archive)))
                return false;
              try {
                const archived = JSON.parse(committed.stdout);
                return (
                  archived.phase === 'QUALITY_ACCEPTED' &&
                  archived.verification?.archiveAllowed === true &&
                  JSON.stringify(archived) ===
                    JSON.stringify(JSON.parse(readText(path.join(root, initReport.archive)))) &&
                  archived.gitBaseline?.commit === initReport.gitBaseline?.commit &&
                  JSON.stringify(archived.quality) === JSON.stringify(initReport.quality)
                );
              } catch {
                return false;
              }
            })())
        ))
    )
      return {
        ok: false,
        code: 'INIT_QUALITY_PENDING',
        message: '初始化质量流程尚未完成，请先完成/修复初始化审查',
      };
  }
  const loaded = loadState(root);
  if (!loaded.ok) return loaded;
  const { state } = loaded;
  const config = readConfig(root);
  const requirementRules = requirementsConfig(root);
  if (requirementRules.enabled) {
    const frozen = isRequirementsFrozen(root, requirementRules.version);
    if (!frozen.ok) return frozen;
  }
  const effectiveKey = changeKey || (config?.changeKey ? String(config.changeKey) : null);
  if (effectiveKey !== null && !CHANGE_KEY_PATTERN.test(effectiveKey)) {
    return {
      ok: false,
      code: 'INVALID_CHANGE_KEY',
      message: `changeKey 不合法：${effectiveKey}`,
      fix: '使用 3-64 位小写字母/数字/连字符，例如 checkout-2026-10',
    };
  }
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
  const linkedReqs = Array.isArray(requirements)
    ? requirements.filter((id) => /^REQ-\d{3,}$/.test(String(id)))
    : [];
  const files = {
    'proposal.md': proposalTemplate(name, type, linkedReqs),
    'design.md': designTemplate(name, type),
    'tasks.md': tasksTemplate(name),
    'tests/cases.md': casesTemplate(),
    'tests/mapping.json': `${JSON.stringify({ schemaVersion: 1, change: name, requirements: [], automation: [] }, null, 2)}\n`,
    'tests/touched.json': `${JSON.stringify({ schemaVersion: 1, modify: [], delete: [], bootstrap: [] }, null, 2)}\n`,
  };
  if (!style.skipped) {
    files['template-context.md'] = '# 项目固定规范与实际样例\n\n' + style.prompt + '\n';
    files['template-references.json'] =
      JSON.stringify(
        { version: style.version, manifestHash: style.manifestHash, references: style.references },
        null,
        2,
      ) + '\n';
    files['design.md'] +=
      '\n## 模板参照\n\n实现与测试规划必须阅读 template-context.md 和 template-references.json，并参照项目固定样例。\n';
  }
  for (const [relative, content] of Object.entries(files)) {
    writeText(path.join(changeDir, relative), content);
  }
  ensureDir(path.join(changeDir, 'tests', 'automation'));
  ensureDir(path.join(changeDir, 'specs'));

  const saved = patchState(root, (draft) => {
    draft.change = name;
    draft.type = type;
    draft.changeKey = effectiveKey;
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
    draft.acceptanceHash = null;
  });
  if (!saved.ok) return saved;

  return { ok: true, root, name, type, changeKey: effectiveKey, changeDir, state: saved.state };
}

function proposalTemplate(name, type, requirements = []) {
  const linkedDraft = requirements.length
    ? requirements.map((id) => `- 关联需求：${id}`).join('\n')
    : '- 关联需求：（必填）引用需求基线 openspec/REQ.md 中的 REQ-xxx';
  return `# 变更提案：${name}

- 类型：${type}
- 状态：Draft
${linkedDraft}

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
