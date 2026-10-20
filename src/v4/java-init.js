import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  normalizeInitQuality,
  runJavaInitAgents,
  finalizeJavaInitAgents,
} from './java-init-agents.js';
import { javaFullstackFiles } from './java-fullstack-template.js';
import {
  normalizeInitExecution,
  executeJavaInit,
  preflightJavaInit,
} from './java-init-execution.js';
import { initProject, patchConfigRequirements } from '../v3/change.js';
import { writeRequirementsBaseline, answerOf } from '../v3/requirements.js';
import { goldenStatus, normalizeJavaPreset, templateHash } from './java-versions.js';

export function inspectEmptyTarget(root) {
  try {
    let stat;
    try {
      stat = fs.lstatSync(root);
    } catch (error) {
      if (error.code === 'ENOENT') return { ok: true, missing: true };
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      return { ok: false, code: 'E_PATH_NOT_DIR', message: '目标必须是普通目录（不接受符号链接）' };
    const entries = fs.readdirSync(root);
    if (entries.length)
      return {
        ok: false,
        code: 'E_TARGET_NOT_EMPTY',
        message: '目标必须完全为空，包括 .git、空文件和空子目录均不允许',
        entries,
      };
    return { ok: true, missing: false };
  } catch (error) {
    return { ok: false, code: 'E_PATH_UNREADABLE', message: error.message };
  }
}

export function resolveJavaInitRoot(cwd, input) {
  let raw = String(input || '').trim();
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\'))
    raw = path.join(os.homedir(), raw.slice(1));
  return path.resolve(cwd, raw || '.');
}

export const JAVA_INIT_REQUIREMENTS = {
  functional: [
    '用户通过 Vue 页面新增、查看、编辑、删除任务，调用真实 Java /api/tasks API',
    '任务以 H2 文件库持久化，后端重启后保留数据',
    '提供健康检查和可配置端口，前后端独立构建与启动',
  ],
  nonFunctional: [
    '校验输入并显示错误反馈，页面不直接渲染用户 HTML',
    'Windows、Linux、macOS 通用启动与验证入口',
    '代码文档始终生成；默认宽松并发多 agent 审查，严格模式完整复验，未执行项明确标注未验证',
  ],
  constraints: [
    'Java8 + Spring Boot2.7.18 + Maven；披露旧版本维护风险',
    'Vue3、TypeScript、Vite 锁定稳定兼容版本；Node 受支持 LTS；npm',
    '不含登录认证，不自动发起后续 change；保留 H1/H2/H3 人工审批',
  ],
  acceptance: [
    '页面通过真实 API 完成任务 CRUD，错误输入有反馈',
    '创建任务、重启 Java 后端、查询任务仍存在',
    '健康检查、前后端独立构建及端口配置可用',
  ],
};

function requirementsFor(preset) {
  return {
    ...JAVA_INIT_REQUIREMENTS,
    nonFunctional: [
      JAVA_INIT_REQUIREMENTS.nonFunctional[0],
      JAVA_INIT_REQUIREMENTS.nonFunctional[1],
      '代码文档始终生成；默认仅生成不执行质量命令；可选 /sg-verify 进行本地验证，未执行项明确标注未验证',
    ],
    constraints: [
      preset.label + (preset.legacy ? '；披露旧版本维护风险' : '；使用当前受支持版本线'),
      ...JAVA_INIT_REQUIREMENTS.constraints.slice(1),
    ],
  };
}

function baselineConfig(preset) {
  return `# Single-repository Java/Vue monorepo using the existing SpecGate gate engine
workflowVersion: 3
schemaVersion: 3
language: zh
maxParallel: 2
install: false
coverage:
  blocking: false
requirements:
  enabled: true
  version: v1.0
  doc: openspec/REQ.md
  history: openspec/history
suites:
  - id: backend
    kind: maven
    cwd: backend
    jdk: "${preset.jdk}"
    buildTool: maven
    goals: ["-B","-ntp","verify"]
    install: false
  - id: frontend
    kind: command
    cwd: frontend
    command: ["node","../scripts/frontend-test.mjs"]
    install: false
`;
}

export async function startJavaInit({
  root,
  userQuestions,
  agent,
  signal,
  execution = {},
  quality = {},
  runtime,
  dispatch,
  runner,
  installer,
  env,
  backend,
  frontend,
  preset: stackPreset,
  req,
  description,
  draft,
  version,
}) {
  const empty = inspectEmptyTarget(root);
  if (!empty.ok) return empty;
  if (
    (backend && backend !== 'java') ||
    (frontend && frontend !== 'vue') ||
    (stackPreset && stackPreset !== 'java-vue')
  )
    return {
      ok: false,
      code: 'E_STACK_CONFLICT',
      message: '默认初始化固定 Java + Vue；请使用 java-vue 预设',
    };
  if (req || description || draft)
    return {
      ok: false,
      code: 'E_ARGS_CONFLICT',
      message: '默认初始化生成固定任务示例需求；自定义需求流程请显式使用 v3',
    };
  const versionResult = normalizeJavaPreset(version);
  if (!versionResult.ok) return versionResult;
  const preset = versionResult.preset;
  const requirements = requirementsFor(preset);
  const qualityInput =
    quality === undefined ||
    (quality &&
      typeof quality === 'object' &&
      !Array.isArray(quality) &&
      Object.keys(quality).length === 0)
      ? { generateOnly: true }
      : quality;
  const qualityOptions = normalizeInitQuality(qualityInput);
  if (!qualityOptions.ok)
    return { ok: false, code: 'E_QUALITY_OPTIONS', message: qualityOptions.errors.join('；') };
  const normalized = normalizeInitExecution(execution);
  if (!normalized.ok)
    return { ok: false, code: 'E_EXECUTION_OPTIONS', message: normalized.errors.join('；') };
  if (qualityOptions.quality.generateOnly && Object.values(normalized.execution).some(Boolean))
    return { ok: false, code: 'E_ARGS_CONFLICT', message: '仅生成模式不能同时开启附加执行开关' };
  if (!userQuestions || typeof userQuestions.ask !== 'function')
    return {
      ok: false,
      phase: 'CLARIFY',
      code: 'QUESTIONS_UNAVAILABLE',
      message: '需求澄清（尚未写入任何文件）：必须通过宿主对话框确认初始化',
    };
  let answer;
  try {
    answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-java-init-confirm',
          header: 'Java/Vue 初始化需求确认',
          question: `目标：${root}\n完全空目录；单 Git monorepo，${preset.label} + Vue3/TS/Vite/npm，任务 CRUD + H2 文件持久化，无登录。\n质量模式：${JSON.stringify(qualityOptions.quality)}；默认仅生成，不安装、不执行；可选 --lenient/--strict 启动 agent 质量流程。\n附加执行开关：${JSON.stringify(normalized.execution)}\n仅生成不会归档为验证通过。开启测试/格式化/检查/运行验证可能下载依赖；安装工具链仅显式开启执行。\n代码和文档始终生成；必须执行本地 git init/add/commit 建立单仓基线（不联网）；req v1.0 + 快照基线，后续 sg-change 独立发起并遵守审批。\n${preset.legacy ? '旧 Java/Boot 有维护安全风险，本示例不可直接作为生产安全基线。' : preset.preview ? 'Boot 4.0 为 preview，需在目标环境验证后再用于生产。' : '使用当前受支持版本线；本示例仍非生产安全基线。'}确认后才写入。\n完整需求：${JSON.stringify(requirements, null, 2)}`,
          options: [
            { label: '确认', description: '生成后按所选模式执行；默认仅生成' },
            { label: '取消', description: '不写入任何文件' },
          ],
        },
      ],
      agent,
      signal,
    });
  } catch (error) {
    return { ok: false, code: 'CONFIRM_FAILED', message: error.message };
  }
  if (answerOf(answer) !== '确认' || signal?.aborted)
    return { ok: false, code: 'CANCELLED', message: '用户取消；未写入任何文件' };
  const preflight = await preflightJavaInit({
    root,
    javaVersion: preset.jdk,
    execution: normalized.execution,
    runner,
    env,
    signal,
  });
  if (!preflight.ok)
    return {
      ok: false,
      code: 'E_ENV_PREFLIGHT',
      message: (preflight.errors || []).join('；') || '环境预检查失败',
      preflight,
    };
  const checked = inspectEmptyTarget(root);
  if (!checked.ok) return checked;
  // Build and validate the complete manifest before touching the destination.
  let files;
  try {
    files = javaFullstackFiles({ preset });
    for (const [relative, content] of Object.entries(files)) {
      const target = path.resolve(root, relative);
      if (
        !relative ||
        path.relative(root, target).startsWith('..') ||
        path.isAbsolute(relative) ||
        typeof content !== 'string'
      )
        throw new Error('不安全的模板路径或内容：' + relative);
    }
  } catch (error) {
    return { ok: false, code: 'E_TEMPLATE', message: error.message };
  }
  const hash = templateHash(files);
  const golden = goldenStatus(preset, hash);
  const approval = {
    source: 'host-userQuestions',
    questionId: 'sg-java-init-confirm',
    root,
    execution: normalized.execution,
    mandatoryGitBaseline: true,
    confirmedAt: new Date().toISOString(),
    quality: qualityOptions.quality,
    requirementsHash: createHash('sha256').update(JSON.stringify(requirements)).digest('hex'),
  };
  try {
    fs.mkdirSync(root, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { flag: 'wx' });
    }
    const initialized = initProject(root);
    if (!initialized.ok) throw new Error(initialized.message || initialized.code);
    fs.writeFileSync(path.join(root, '.specgate/config.yaml'), baselineConfig(preset));
    patchConfigRequirements(root, { enabled: true, version: 'v1.0' });
    writeRequirementsBaseline(root, requirements, { version: 'v1.0' });
    fs.writeFileSync(
      path.join(root, '.specgate/monorepo.json'),
      JSON.stringify(
        {
          version: 1,
          topology: 'monorepo',
          repository: 'single',
          backend: 'backend',
          frontend: 'frontend',
          stack: 'java-vue',
          preset: preset.id,
          jdk: preset.jdk,
          bootVersion: preset.bootVersion,
          preview: preset.preview,
          templateHash: hash,
          templateVerified: golden.verified,
          execution: normalized.execution,
          quality: qualityOptions.quality,
        },
        null,
        2,
      ) + '\n',
    );
    fs.writeFileSync(
      path.join(root, '.specgate/golden.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          preset: preset.id,
          label: preset.label,
          jdk: preset.jdk,
          bootVersion: preset.bootVersion,
          preview: preset.preview,
          legacy: preset.legacy,
          templateHash: hash,
          verified: golden.verified,
          reason: golden.reason,
          record: golden.record,
        },
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    return {
      ok: false,
      code: 'E_GENERATION_FAILED',
      message: error.message,
      generated: true,
      root,
    };
  }
  const report = {
    schemaVersion: 2,
    generated: true,
    approval,
    version: {
      id: preset.id,
      jdk: preset.jdk,
      bootVersion: preset.bootVersion,
      preview: preset.preview,
    },
    template: { hash: hash, verified: golden.verified, reason: golden.reason },
    quality: qualityOptions.quality,
    gitBaseline: { mandatory: true, status: 'pending', network: false },
    execution: normalized.execution,
    phase: 'INITIALIZING',
    generatedAt: new Date().toISOString(),
  };
  const git = (args) =>
    spawnSync('git', ['-c', 'user.name=SpecGate', '-c', 'user.email=specgate@local', ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
    });
  for (const args of [
    ['init', '-q'],
    ['add', '-A'],
    ['commit', '--no-gpg-sign', '-q', '-m', 'chore: initialize Java Vue req v1 baseline'],
  ]) {
    const step = git(args);
    if (step.status !== 0) {
      report.gitBaseline.status = 'failed';
      report.gitBaseline.error = step.stderr || step.error?.message || 'git failed';
      fs.writeFileSync(
        path.join(root, '.specgate/init-report.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
      return {
        ok: false,
        code: 'E_BASELINE_GIT',
        message: step.stderr || step.error?.message,
        generated: true,
        root,
        report,
      };
    }
  }
  report.gitBaseline.status = 'passed';
  report.gitBaseline.commit = git(['rev-parse', 'HEAD']).stdout.trim();
  fs.writeFileSync(
    path.join(root, '.specgate/init-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  return continueJavaInit({
    root,
    report,
    runtime,
    parent: agent,
    signal,
    dispatch,
    runner,
    installer,
    env,
  });
}

function writeJson(root, relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
}

export async function continueJavaInit({
  root,
  report,
  runtime,
  parent,
  signal,
  dispatch,
  runner,
  installer,
  env,
}) {
  try {
    root = canonicalRoot(root);
    policy(root, report);
  } catch (error) {
    return failure('E_INIT_CONTINUATION', error, root);
  }
  let executionResult = null;
  if (Object.values(report.execution || {}).some(Boolean)) {
    executionResult = await executeJavaInit({
      root,
      execution: report.execution,
      runner,
      installer,
      signal,
      env,
    });
    if (!executionResult.ok && report.quality.mode === 'strict')
      return completeJavaInit(root, report, {
        ok: false,
        accepted: false,
        archiveAllowed: false,
        stages: executionResult.stages,
        errors: executionResult.errors,
      });
  }
  const result = await runJavaInitAgents({
    root,
    quality: { mode: report.quality.mode, generateOnly: report.quality.generateOnly },
    runtime,
    parent,
    signal,
    dispatch,
    strictRunner: runner,
    env,
  });
  result.additionalExecution = executionResult;
  return completeJavaInit(root, report, result);
}

// Locks cover asynchronous continuation work, not the agent's entire idle session.
const continuationLocks = new Map();
const preparedArchives = new Map();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ownedTransient = (file) =>
  /^(?:\.specgate\/(?:init-(?:report|pending|execution-report|worktrees)(?:\.json|\/)|java-init-(?:quality|execution|pending)\.json|verify-db-)|docs\/initialization\/pending\/[a-f0-9]+\/(?:test|lint|format|review)\.json$)/.test(
    file,
  );
function failure(code, error, root) {
  return { ok: false, code, message: error?.message || String(error), root };
}
function ordinaryPath(root, relative, missing = false) {
  const absolute = path.resolve(root, relative);
  if (path.relative(root, absolute).startsWith('..'))
    throw new Error('Path escapes initialization root');
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error('Symlink/junction path forbidden: ' + current);
    } catch (error) {
      if (missing && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return absolute;
}
function canonicalRoot(root) {
  root = path.resolve(root);
  ordinaryPath(root, '');
  const canonical = fs.realpathSync(root);
  if (fs.realpathSync(gitText(canonical, ['rev-parse', '--show-toplevel'])) !== canonical)
    throw new Error('Initialization root must be exact Git root');
  return canonical;
}
function gitRun(root, args, runner) {
  const result = runner
    ? runner({ root, args })
    : spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 120000 });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || result.stderr || 'git failed');
  return result;
}
function gitText(root, args, runner) {
  return gitRun(root, args, runner).stdout.trim();
}
function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(ordinaryPath(root, relative), 'utf8'));
}
function policy(root, report) {
  const metadata = '.specgate/monorepo.json';
  const approvedText = gitText(root, ['show', 'HEAD:' + metadata]);
  const approved = JSON.parse(approvedText);
  const current = readJson(root, metadata);
  if (!same(current, approved) || approved.stack !== 'java-vue' || approved.repository !== 'single')
    throw new Error('Approved tracked initialization metadata changed');
  if (
    !report ||
    report.schemaVersion !== 2 ||
    report.generated !== true ||
    !report.gitBaseline ||
    !/^[a-f0-9]{40,64}$/.test(report.gitBaseline.commit || '') ||
    !same(report.quality, approved.quality) ||
    !same(report.execution, approved.execution) ||
    !normalizeInitQuality(report.quality).ok ||
    !normalizeInitExecution(report.execution).ok
  )
    throw new Error('Initialization report does not match approved quality/execution policy');
  return approved;
}
function validateFrontendLock(root) {
  const manifest = readJson(root, 'frontend/package.json');
  const lock = readJson(root, 'frontend/package-lock.json');
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages || !lock.packages[''])
    throw new Error('Expected npm v2/v3 package lock with root package');
  const locked = lock.packages[''];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const expected = manifest[field] || {};
    const actual = locked[field] || {};
    const keys = Object.keys(expected).sort();
    if (!same(keys, Object.keys(actual).sort()))
      throw new Error('Lock root dependency keys differ: ' + field);
    for (const name of keys) {
      const version = expected[name];
      if (
        typeof version !== 'string' ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ||
        actual[name] !== version ||
        lock.packages['node_modules/' + name]?.version !== version
      )
        throw new Error('Lock direct dependency must match exact pinned manifest: ' + name);
    }
  }
  if (locked.name && locked.name !== manifest.name) throw new Error('Lock root name differs');
  if (locked.version && locked.version !== manifest.version)
    throw new Error('Lock root version differs');
}
function changed(root) {
  const tracked = gitRun(root, ['diff', '--name-only', '-z', 'HEAD'])
    .stdout.split('\0')
    .filter(Boolean);
  const untracked = gitRun(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    .stdout.split('\0')
    .filter(Boolean);
  return { tracked, untracked };
}
async function locked(root, work) {
  try {
    root = canonicalRoot(root);
  } catch (error) {
    return failure('E_INIT_SCOPE', error, root);
  }
  const prior = continuationLocks.get(root) || Promise.resolve();
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const tail = prior.then(() => barrier);
  continuationLocks.set(root, tail);
  await prior;
  try {
    return await work(root);
  } catch (error) {
    return failure('E_INIT_CONTINUATION', error, root);
  } finally {
    release();
    if (continuationLocks.get(root) === tail) continuationLocks.delete(root);
  }
}
function initialized(root, report) {
  return {
    ok: true,
    code: 'INITIALIZED',
    phase: 'IDLE',
    root,
    generated: true,
    report,
    message: '初始化质量流程已独立归档，下一步 sg-change。',
  };
}
function archiveValid(root, report) {
  if (
    !report ||
    report.phase !== 'IDLE' ||
    !report.initializationComplete ||
    !/^[a-f0-9]{40,64}$/.test(report.archiveCommit || '') ||
    !/^docs\/initialization\/archive\/[a-f0-9]{40,64}-(lenient|strict)\.json$/.test(
      report.archive || '',
    )
  )
    throw new Error('Completed initialization archive identity invalid');
  ordinaryPath(root, report.archive);
  const payload = JSON.parse(gitText(root, ['show', report.archiveCommit + ':' + report.archive]));
  if (
    payload.phase !== 'QUALITY_ACCEPTED' ||
    !payload.verification?.archiveAllowed ||
    !same(payload.quality, report.quality) ||
    payload.gitBaseline.commit !== report.gitBaseline.commit
  )
    throw new Error('Archive commit payload does not match completed report');
  if (gitText(root, ['rev-parse', report.archiveCommit + '^']) !== report.gitBaseline.commit)
    throw new Error('Archive commit is not child of accepted source baseline');
  if (!same(readJson(root, report.archive), payload))
    throw new Error('Committed archive changed in worktree');
}
function finishArchive(root, prepared, gitRunner) {
  const { report, head, hashes } = prepared;
  policy(root, report);
  if (gitText(root, ['rev-parse', 'HEAD']) !== head)
    throw new Error('Accepted source baseline changed before archive');
  for (const [file, hash] of Object.entries(hashes)) {
    const bytes = fs.readFileSync(ordinaryPath(root, file));
    if (createHash('sha256').update(bytes).digest('hex') !== hash)
      throw new Error('Prepared archive artifact changed: ' + file);
  }
  const dirty = changed(root);
  if (
    dirty.tracked.some((file) => !Object.hasOwn(hashes, file)) ||
    dirty.untracked.some((file) => !Object.hasOwn(hashes, file) && !ownedTransient(file))
  )
    throw new Error('Unrelated changes present during archive retry');
  const files = Object.keys(hashes);
  try {
    gitRun(root, ['add', '--', ...files], gitRunner);
    gitRun(
      root,
      [
        '-c',
        'user.name=SpecGate',
        '-c',
        'user.email=specgate@local',
        'commit',
        '--no-gpg-sign',
        '--only',
        '-m',
        'chore: archive initialization quality reports',
        '--',
        ...files,
      ],
      gitRunner,
    );
  } catch (error) {
    report.phase = 'ARCHIVE_FAILED';
    report.initializationComplete = false;
    writeJson(root, '.specgate/init-report.json', report);
    return { ...failure('E_ARCHIVE_GIT', error, root), report };
  }
  report.archiveCommit = gitText(root, ['rev-parse', 'HEAD']);
  report.phase = 'IDLE';
  report.initializationComplete = true;
  report.next = '在生成目录 sg-change <name>；保留 H1/H2/H3 审批';
  archiveValid(root, report);
  writeJson(root, '.specgate/init-report.json', report);
  const pendingFile = path.join(root, '.specgate/init-pending.json');
  if (fs.existsSync(pendingFile)) {
    const pending = readJson(root, '.specgate/init-pending.json');
    writeJson(root, '.specgate/init-pending.json', { ...pending, completed: true, report });
  }
  preparedArchives.delete(root);
  return initialized(root, report);
}
export function completeJavaInit(root, report, result, { gitRunner } = {}) {
  try {
    root = canonicalRoot(root);
    policy(root, report);
    report.verification = result;
    report.phase = result.archiveAllowed
      ? 'ARCHIVING'
      : result.fallbackRequired
        ? 'MAIN_AGENT_PENDING'
        : result.skipped || report.quality.generateOnly
          ? 'GENERATED_ONLY'
          : 'QUALITY_FAILED';
    report.initializationComplete = false;
    report.next = report.quality.generateOnly
      ? '在生成目录 sg-change <name>；保留 H1/H2/H3 审批'
      : '完成初始化检查后再发起 sg-change';
    writeJson(root, '.specgate/init-report.json', report);
    if (result.fallbackRequired)
      writeJson(root, '.specgate/init-pending.json', {
        report,
        token: result.token,
        createdAt: new Date().toISOString(),
      });
    if (result.archiveAllowed) {
      const head = gitText(root, ['rev-parse', 'HEAD']);
      const dirty = changed(root);
      if (dirty.tracked.length || dirty.untracked.some((file) => !ownedTransient(file)))
        throw new Error('Reviewed source baseline must be clean before archive');
      report.gitBaseline.commit = head;
      report.archive = 'docs/initialization/archive/' + head + '-' + report.quality.mode + '.json';
      const files = [report.archive, 'openspec/REQ.md', 'openspec/history/v1.0/REQ.md'];
      files.forEach((file) => ordinaryPath(root, file, file === report.archive));
      writeJson(root, report.archive, {
        ...report,
        phase: 'QUALITY_ACCEPTED',
        initializationComplete: false,
        archiveCommitRequired: true,
      });
      const status =
        '\n## 初始化归档状态\n\n模式：' +
        report.quality.mode +
        '\n\n' +
        (result.stages || []).map((item) => '- ' + item.stage + ': ' + item.status).join('\n') +
        '\n\n宽松通过不代表实际测试或运行通过；未执行项为未验证。后续变更独立人工审批。\n';
      for (const file of files.slice(1)) {
        const target = ordinaryPath(root, file);
        fs.writeFileSync(
          target,
          fs.readFileSync(target, 'utf8').split('\n## 初始化归档状态')[0] + status,
        );
      }
      const hashes = Object.fromEntries(
        files.map((file) => [
          file,
          createHash('sha256')
            .update(fs.readFileSync(ordinaryPath(root, file)))
            .digest('hex'),
        ]),
      );
      const prepared = {
        report: structuredClone(report),
        result: structuredClone(result),
        head,
        hashes,
      };
      preparedArchives.set(root, prepared);
      return finishArchive(root, prepared, gitRunner);
    }
    const generatedOnly = report.quality.generateOnly;
    return {
      ok: Boolean(result.fallbackRequired || generatedOnly),
      code: result.fallbackRequired
        ? 'MAIN_AGENT_PENDING'
        : generatedOnly
          ? 'GENERATED_ONLY'
          : 'E_INIT_QUALITY',
      phase: report.phase,
      root,
      generated: true,
      report,
      mainAgentPrompt: result.mainAgentPrompt || null,
      token: result.token || null,
      message: result.fallbackRequired
        ? '已生成；必须由主 agent 串行实际审查后调用 sg_init_finalize。\n' + result.mainAgentPrompt
        : generatedOnly
          ? '仅生成完成；未验证，未归档质量通过。'
          : '质量检查未通过，保留报告，不归档成功。',
    };
  } catch (error) {
    return { ...failure('E_INIT_CONTINUATION', error, root), report };
  }
}
function retryArchive(root, report, gitRunner) {
  const prepared = preparedArchives.get(root);
  if (!prepared || !same(prepared.report.verification, report.verification))
    return failure(
      'E_ARCHIVE_RETRY_UNTRUSTED',
      'No process-local validated archive snapshot; do not trust unsigned report as AI acceptance',
      root,
    );
  return finishArchive(root, prepared, gitRunner);
}
export async function finalizeJavaInitialization({
  root,
  token,
  reports,
  runner,
  signal,
  env,
  parent,
  gitRunner,
}) {
  return locked(root, async (root) => {
    if (signal?.aborted) return failure('CANCELLED', 'Continuation aborted', root);
    const pending = readJson(root, '.specgate/init-pending.json');
    policy(root, pending.report);
    if (!same(pending.token, token))
      return failure('E_INIT_TOKEN', 'Initialization token mismatch', root);
    if (pending.completed) {
      archiveValid(root, pending.report);
      return initialized(root, pending.report);
    }
    const current = readJson(root, '.specgate/init-report.json');
    policy(root, current);
    if (current.phase === 'ARCHIVE_FAILED') return retryArchive(root, current, gitRunner);
    const result = await finalizeJavaInitAgents({
      root,
      token,
      reports,
      quality: pending.report.quality,
      strictRunner: runner,
      signal,
      env,
    });
    if (signal?.aborted) return failure('CANCELLED', 'Continuation aborted', root);
    const fresh = readJson(root, '.specgate/init-pending.json');
    if (fresh.completed || !same(fresh.token, token))
      return failure('E_INIT_TOKEN', 'Pending changed during review', root);
    result.hostAttestation = {
      kind: 'host-main-agent-attestation',
      agentId: parent?.id || null,
      recordedAt: new Date().toISOString(),
      limitation:
        'Reports and referenced evidence are attested by host AI; this is not human approval or cryptographic proof of execution.',
    };
    return completeJavaInit(root, pending.report, result, { gitRunner });
  });
}
export async function resumeJavaInitialization({
  root,
  runtime,
  parent,
  signal,
  dispatch,
  runner,
  env,
  gitRunner,
}) {
  return locked(root, async (root) => {
    if (signal?.aborted) return failure('CANCELLED', 'Continuation aborted', root);
    const report = readJson(root, '.specgate/init-report.json');
    policy(root, report);
    if (
      report.initializationComplete ||
      report.quality.generateOnly ||
      !['MAIN_AGENT_PENDING', 'QUALITY_FAILED', 'ARCHIVE_FAILED'].includes(report.phase)
    )
      return failure('E_INIT_NOT_PENDING', 'Not a resumable quality flow', root);
    if (report.phase === 'ARCHIVE_FAILED') return retryArchive(root, report, gitRunner);
    const { tracked, untracked } = changed(root);
    if (tracked.some((file) => file.startsWith('.specgate/') || file.startsWith('openspec/')))
      return failure(
        'E_INIT_REPAIR_SCOPE',
        'Approved SpecGate/requirements metadata cannot be repaired',
        root,
      );
    const allowed = new Set(
      Object.keys(javaFullstackFiles()).filter(
        (file) =>
          file.startsWith('backend/') ||
          file.startsWith('frontend/') ||
          file.startsWith('scripts/'),
      ),
    );
    const repairs = [
      ...new Set([...tracked, ...untracked.filter((file) => !ownedTransient(file))]),
    ];
    try {
      for (const file of repairs) {
        if (file === 'frontend/package-lock.json') {
          validateFrontendLock(root);
          allowed.add(file);
        }
        if (!allowed.has(file) || !fs.statSync(ordinaryPath(root, file)).isFile())
          throw new Error('Unauthorized or deleted repair: ' + file);
      }
    } catch (error) {
      return failure('E_INIT_REPAIR_SCOPE', error, root);
    }
    if (repairs.length) {
      gitRun(root, ['add', '--', ...repairs]);
      gitRun(root, [
        '-c',
        'user.name=SpecGate',
        '-c',
        'user.email=specgate@local',
        'commit',
        '--no-gpg-sign',
        '--only',
        '-m',
        'fix: main agent initialization repairs',
        '--',
        ...repairs,
      ]);
    }
    report.gitBaseline.commit = gitText(root, ['rev-parse', 'HEAD']);
    report.resumedAt = new Date().toISOString();
    return continueJavaInit({ root, report, runtime, parent, signal, dispatch, runner, env });
  });
}

export function summarizeJavaInit(result) {
  const prefix =
    result.code === 'MAIN_AGENT_PENDING'
      ? '初始化待主 agent 继续：'
      : result.code === 'GENERATED_ONLY'
        ? '仅生成完成：'
        : result.ok
          ? '初始化完成：'
          : '初始化未通过（' + (result.code || 'FAILED') + '）：';
  const version = result.report?.version
    ? '\n版本档：' +
      result.report.version.id +
      '；Golden：' +
      (result.report.template?.verified ? '已验证' : '未验证（可执行 /sg-verify）')
    : '';
  return prefix + result.message + version;
}
