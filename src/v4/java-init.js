import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { javaFullstackFiles } from './java-fullstack-template.js';
import { JAVA_PRESETS, goldenStatus, normalizeJavaPreset, templateHash } from './java-versions.js';
import { initProject, patchConfigRequirements } from '../v3/change.js';
import { writeRequirementsBaseline, answerOf } from '../v3/requirements.js';

const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);

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
  if (raw === '~' || raw.startsWith('~' + BS)) raw = path.join(os.homedir(), raw.slice(1));
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
    '代码文档始终生成；初始化默认只生成，不安装、不执行；可选 /sg-verify 本地验证，未执行项明确标注未验证',
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
    constraints: [
      preset.label + (preset.legacy ? '；披露旧版本维护风险' : '；使用当前受支持版本线'),
      ...JAVA_INIT_REQUIREMENTS.constraints.slice(1),
    ],
  };
}

function baselineConfig(preset) {
  return [
    '# Single-repository Java/Vue monorepo using the existing SpecGate gate engine',
    'workflowVersion: 3',
    'schemaVersion: 3',
    'language: zh',
    'maxParallel: 2',
    'install: false',
    'coverage:',
    '  blocking: false',
    'requirements:',
    '  enabled: true',
    '  version: v1.0',
    '  doc: openspec/REQ.md',
    '  history: openspec/history',
    'suites:',
    '  - id: backend',
    '    kind: maven',
    '    cwd: backend',
    '    jdk: "' + preset.jdk + '"',
    '    buildTool: maven',
    '    goals: ["-B","-ntp","verify"]',
    '    install: false',
    '  - id: frontend',
    '    kind: command',
    '    cwd: frontend',
    '    command: ["node","../scripts/frontend-test.mjs"]',
    '    install: false',
    '',
  ].join(NL);
}

function confirmationText(root, preset, requirements) {
  return [
    '目标：' + root,
    '完全空目录；单 Git monorepo；' +
      preset.label +
      ' + Vue3/TS/Vite/npm；任务 CRUD + H2 文件持久化；无登录。',
    '初始化默认只生成：不安装依赖、不编译、不执行质量命令；需要本地验证时执行 /sg-verify。',
    '必须执行本地 git init/add/commit 建立单仓基线（不联网）；req v1.0 + 快照基线，后续 sg-change 独立发起。',
    preset.legacy
      ? '旧 Java/Boot 有维护安全风险，本示例不可直接作为生产安全基线。'
      : preset.preview
        ? 'Boot 4.0 为 preview，需在目标环境验证后再用于生产。'
        : '使用当前受支持版本线；本示例仍非生产安全基线。',
    '确认后才写入。',
    '完整需求：' + JSON.stringify(requirements, null, 2),
  ].join(NL);
}

function existingJavaWorkspace(root) {
  const marker = path.join(root, '.specgate', 'monorepo.json');
  if (!fs.existsSync(marker)) return null;
  try {
    const metadata = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (metadata.stack !== 'java-vue') return null;
    if (!fs.existsSync(path.join(root, '.specgate', 'state.json'))) return null;
    let report = null;
    try {
      report = JSON.parse(
        fs.readFileSync(path.join(root, '.specgate', 'init-report.json'), 'utf8'),
      );
    } catch {
      return null;
    }
    if (!report || report.gitBaseline?.status !== 'passed') return null;
    return {
      ok: true,
      skipped: true,
      code: 'ALREADY_INITIALIZED',
      root,
      report,
      message: '已初始化，幂等跳过；不覆盖现有文件',
    };
  } catch {
    return null;
  }
}

export async function startJavaInit({
  root,
  userQuestions,
  agent,
  signal,
  version,
  backend,
  frontend,
  preset: stackPreset,
  req,
  description,
  draft,
}) {
  const existing = existingJavaWorkspace(root);
  if (existing) return existing;
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
  if (!userQuestions || typeof userQuestions.ask !== 'function')
    return {
      ok: false,
      phase: 'CLARIFY',
      code: 'QUESTIONS_UNAVAILABLE',
      message: '需求澄清（尚未写入任何文件）：必须通过宿主对话框确认初始化',
    };
  let chosenVersion = version;
  if (!chosenVersion) {
    let pick;
    try {
      pick = await userQuestions.ask({
        questions: [
          {
            id: 'sg-java-init-version',
            header: 'Java 版本档',
            question: '选择 Java + Spring Boot 版本档',
            options: JAVA_PRESETS.map((item) => ({
              label: item.id,
              description: item.label + (item.preview ? '（preview）' : ''),
            })),
          },
        ],
        agent,
        signal,
      });
    } catch (error) {
      return { ok: false, code: 'CONFIRM_FAILED', message: error.message };
    }
    const choice = String(answerOf(pick) || '').trim();
    if (choice === '取消')
      return { ok: false, code: 'CANCELLED', message: '用户取消；未写入任何文件' };
    chosenVersion = choice;
  }
  const versionResult = normalizeJavaPreset(chosenVersion);
  if (!versionResult.ok) return versionResult;
  const preset = versionResult.preset;
  const requirements = requirementsFor(preset);
  let answer;
  try {
    answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-java-init-confirm',
          header: 'Java/Vue 初始化需求确认',
          question: confirmationText(root, preset, requirements),
          options: [
            { label: '确认', description: '生成代码、req v1.0 与 Git 基线；不安装、不执行' },
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
  const checked = inspectEmptyTarget(root);
  if (!checked.ok) return checked;
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
    mandatoryGitBaseline: true,
    confirmedAt: new Date().toISOString(),
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
          quality: { generateOnly: true },
          execution: {},
        },
        null,
        2,
      ) + NL,
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
      ) + NL,
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
    quality: { generateOnly: true },
    execution: {},
    gitBaseline: { mandatory: true, status: 'pending', network: false },
    phase: 'GENERATED_ONLY',
    initializationComplete: false,
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
        JSON.stringify(report, null, 2) + NL,
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
    JSON.stringify(report, null, 2) + NL,
  );
  return {
    ok: true,
    code: 'GENERATED_ONLY',
    phase: 'GENERATED_ONLY',
    root,
    generated: true,
    report,
    message: '仅生成完成；未验证，可执行 /sg-verify。',
  };
}

export function summarizeJavaInit(result) {
  const prefix =
    result.code === 'GENERATED_ONLY'
      ? '仅生成完成：'
      : result.ok
        ? '初始化完成：'
        : '初始化未通过（' + (result.code || 'FAILED') + '）：';
  const version = result.report?.version
    ? NL +
      '版本档：' +
      result.report.version.id +
      '；Golden：' +
      (result.report.template?.verified ? '已验证' : '未验证（可执行 /sg-verify）')
    : '';
  return prefix + result.message + version;
}
