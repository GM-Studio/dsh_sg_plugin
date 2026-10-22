import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { javaFullstackFiles, normalizeProjectNamespace } from './java-fullstack-template.js';
import { VERIFY_STAGES } from './verify-evidence.js';
import { JAVA_PRESETS, goldenStatus, normalizeJavaPreset, templateHash } from './java-versions.js';
import { initProject, patchConfigRequirements } from '../change.js';
import { writeRequirementsBaseline, answerOf } from '../requirements.js';
import { patchState } from '../state.js';

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

function promoteGeneratedDirectory(workRoot, targetRoot) {
  const checked = inspectEmptyTarget(targetRoot);
  if (!checked.ok) throw new Error(checked.message);
  if (checked.missing === false) fs.rmdirSync(targetRoot);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.renameSync(workRoot, targetRoot);
      return;
    } catch (error) {
      if (attempt === 2 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

export const JAVA_INIT_REQUIREMENTS = {
  functional: [
    '用户通过 Vue 页面完成任务 CRUD、分页筛选排序和原子批量操作，调用真实 Java /api/tasks API',
    '任务以 H2 文件库持久化，后端重启后保留数据',
    '查询 GET、写操作 POST JSON；统一 JSON 响应、参数校验和全局异常，删除返回回执',
    '本地 admin/viewer 账号使用 Session Cookie 和 CSRF 防护；后端强制两类角色权限',
    'CSV 支持预校验、原子导入和筛选导出；导入 multipart、下载导出文件流，错误为 JSON',
    '本地文件经类型大小和路径校验后上传，鉴权下载；内容及元数据重启后保留',
    '提供健康检查和可配置端口，前后端独立构建与启动',
    '项目包名使用 com.<company>.<business>，生成源码包含中文注释',
    '前端使用 i18n，默认显示中文，并支持切换英文',
  ],
  nonFunctional: [
    '校验输入并显示错误反馈，页面不直接渲染用户 HTML',
    'Windows、Linux、macOS 通用启动与验证入口',
    '代码文档始终生成；初始化默认只生成，不安装、不执行；可选 /sg-verify 本地验证，未执行项明确标注未验证',
  ],
  constraints: [
    'Java8 + Spring Boot2.7.18 + Maven；披露旧版本维护风险',
    'Vue3、TypeScript、Vite 锁定稳定兼容版本；Node 受支持 LTS；npm',
    'company 和 business 必须是合法的小写 Java 包片段，禁止生成 com.example.* 新代码',
    '初始密码由环境变量提供，无默认运行密码；不含注册、SSO、多租户，不自动发起后续 change；保留 H1/H2/H3 审批',
  ],
  acceptance: [
    '页面通过真实 API 完成任务 CRUD，错误输入有反馈',
    '创建任务、重启 Java 后端、查询任务仍存在',
    '错误输入、错误方法和缺失资源返回统一 JSON 与正确状态',
    '登录/退出/CSRF/限流有效，只读角色不能写入',
    '合法 CSV 预校验与导入导出正确，非法 CSV 无部分写入',
    '文件上传下载正确，非法路径/类型/大小与权限错误被拒绝',
    '健康检查、前后端独立构建及端口配置可用',
    '生成后端使用指定包名并可通过构建，前端默认中文且可切换英文',
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
    '  blocking: true',
    '  lines: 80',
    '  branches: 70',
    'templateStyle:',
    '  required: true',
    'quality:',
    '  format: ["node","scripts/run.mjs","format"]',
    '  lint: ["node","scripts/run.mjs","lint"]',
    '  typecheck: ["node","scripts/run.mjs","typecheck"]',
    '  static: ["node","scripts/run.mjs","static"]',
    '  format-check: ["node","scripts/run.mjs","format:check"]',
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

function confirmationText(root, preset, { fileCount, golden, namespace }) {
  const record = golden.record;
  const goldenLine = golden.verified
    ? 'Golden：' +
      (record?.verifiedAt || '已验证') +
      ' / ' +
      (record?.result || 'passed') +
      (golden.pendingPlatforms?.length ? '；待验收平台：' + golden.pendingPlatforms.join(', ') : '')
    : 'Golden：' + (golden.reason || '未验证（可执行 /sg-verify）');
  return [
    '操作目录：',
    root,
    '',
    '版本：',
    preset.id + ' / ' + preset.label,
    '后端：' + preset.label + ' / Maven / H2',
    '前端：Vue 3 / TypeScript / Vite / npm',
    '后端包名：' + namespace.basePackage,
    '前端语言：zh-CN（默认）/ en-US',
    '文件数：' + fileCount,
    goldenLine,
    'IDEA：',
    '1. 打开根目录，将 Project SDK 设置为 JDK ' + preset.jdk,
    '2. Maven Reload 识别 backend/pom.xml 与 Maven Wrapper',
    '3. 在 frontend 执行 npm install，再启动 backend 与 frontend',
    '预计耗时：2–5 秒',
    '失败后：目标目录不会留下半成品，代码与 Git 基线只在成功后原子出现',
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
  company = 'company',
  business = 'tasks',
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
      message: '默认初始化生成固定任务示例需求；自定义需求请通过 Codex change 流程提交',
    };
  if (!userQuestions || typeof userQuestions.ask !== 'function')
    return {
      ok: false,
      phase: 'CLARIFY',
      code: 'QUESTIONS_UNAVAILABLE',
      message: '需求澄清（尚未写入任何文件）：必须通过宿主对话框确认初始化',
    };
  let chosenVersion = version;
  const namespace = normalizeProjectNamespace({ company, business });
  if (!namespace.ok) return namespace;
  let preset = null;
  let files = null;
  let hash = null;
  let golden = null;
  for (let round = 0; round < 2; round += 1) {
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
    preset = versionResult.preset;
    try {
      files = javaFullstackFiles({
        preset,
        company: namespace.company,
        business: namespace.business,
      });
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
    hash = templateHash(files);
    golden = goldenStatus(preset, hash);
    let answer;
    try {
      answer = await userQuestions.ask({
        questions: [
          {
            id: 'sg-java-init-confirm',
            header: '初始化确认',
            question: confirmationText(root, preset, {
              fileCount: Object.keys(files).length,
              golden,
              namespace,
            }),
            options: [
              { label: '确认', description: '生成代码、req v1.0 与 Git 基线；不安装、不执行' },
              { label: '返回修改', description: '回到版本档选择，不写入任何文件' },
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
    const decision = String(answerOf(answer) || '').trim();
    if (decision === '返回修改') {
      chosenVersion = null;
      continue;
    }
    if (decision !== '确认' || signal?.aborted)
      return { ok: false, code: 'CANCELLED', message: '用户取消；未写入任何文件' };
    break;
  }
  if (!preset || !files || !hash || !golden)
    return { ok: false, code: 'CANCELLED', message: '未完成初始化确认；未写入任何文件' };
  const requirements = requirementsFor(preset);
  const checked = inspectEmptyTarget(root);
  if (!checked.ok) return checked;
  const approval = {
    source: 'host-userQuestions',
    questionId: 'sg-java-init-confirm',
    root,
    mandatoryGitBaseline: true,
    confirmedAt: new Date().toISOString(),
    requirementsHash: createHash('sha256').update(JSON.stringify(requirements)).digest('hex'),
  };
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
    projectNamespace: {
      company: namespace.company,
      business: namespace.business,
      basePackage: namespace.basePackage,
      groupId: namespace.groupId,
      packagePath: namespace.packagePath,
    },
    template: {
      hash,
      verified: golden.verified,
      reason: golden.reason,
      matrixComplete: golden.matrixComplete || false,
      pendingPlatforms: golden.pendingPlatforms || [],
    },
    quality: { generateOnly: true },
    execution: Object.fromEntries(VERIFY_STAGES.map((name) => [name, 'not-run'])),
    gitBaseline: { mandatory: true, status: 'pending', network: false, tag: null },
    phase: 'GENERATED_ONLY',
    initializationComplete: false,
    generatedAt: new Date().toISOString(),
  };
  let workRoot = null;
  try {
    const parent = path.dirname(root);
    fs.mkdirSync(parent, { recursive: true });
    workRoot = fs.mkdtempSync(path.join(parent, '.' + path.basename(root) + '.sg-init-'));
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(workRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { flag: 'wx' });
    }
    const initialized = initProject(workRoot, { keepStateTracked: true });
    if (!initialized.ok) throw new Error(initialized.message || initialized.code);
    fs.writeFileSync(path.join(workRoot, '.specgate/config.yaml'), baselineConfig(preset));
    patchConfigRequirements(workRoot, { enabled: true, version: 'v1.0' });
    writeRequirementsBaseline(workRoot, requirements, { version: 'v1.0' });
    fs.writeFileSync(
      path.join(workRoot, '.specgate/monorepo.json'),
      JSON.stringify(
        {
          version: 1,
          topology: 'monorepo',
          repository: 'single',
          backend: 'backend',
          frontend: 'frontend',
          stack: 'java-vue',
          preset: preset.id,
          company: namespace.company,
          business: namespace.business,
          backendPackage: namespace.basePackage,
          groupId: namespace.groupId,
          frontendDefaultLocale: 'zh-CN',
          frontendLocales: ['zh-CN', 'en-US'],
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
      path.join(workRoot, '.specgate/golden.json'),
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
    const initializedState = patchState(workRoot, (draft) => {
      draft.initialization = {
        kind: 'java-vue',
        phase: 'GENERATED_ONLY',
        goldenId: preset.id,
        jdk: preset.jdk,
        bootVersion: preset.bootVersion,
        templateHash: hash,
        templateVerified: golden.verified,
        goldenVerifiedAt: golden.record?.verifiedAt || null,
        pendingPlatforms: golden.pendingPlatforms || [],
        initializationComplete: false,
      };
    });
    if (!initializedState.ok) throw new Error(initializedState.message);
    fs.writeFileSync(
      path.join(workRoot, '.specgate/init-report.json'),
      JSON.stringify(report, null, 2) + NL,
    );
    const git = (args) =>
      spawnSync('git', ['-c', 'user.name=SpecGate', '-c', 'user.email=specgate@local', ...args], {
        cwd: workRoot,
        encoding: 'utf8',
        timeout: 120000,
      });
    for (const args of [
      ['init', '-q'],
      ['add', '-A'],
      ['commit', '--no-gpg-sign', '-q', '-m', 'chore: initialize Java Vue req v1 baseline'],
    ]) {
      const step = git(args);
      if (step.status !== 0) throw new Error(step.stderr || step.error?.message || 'git failed');
    }
    report.gitBaseline.commit = git(['rev-parse', 'HEAD']).stdout.trim();
    report.gitBaseline.status = 'passed';
    report.gitBaseline.tag = 'init-baseline';
    fs.writeFileSync(
      path.join(workRoot, '.specgate/init-report.json'),
      JSON.stringify(report, null, 2) + NL,
    );
    for (const args of [
      ['add', '.specgate/init-report.json'],
      ['commit', '--no-gpg-sign', '-q', '-m', 'chore: record Java Vue init baseline'],
      ['tag', 'init-baseline'],
    ]) {
      const step = git(args);
      if (step.status !== 0) throw new Error(step.stderr || step.error?.message || 'git failed');
    }
    promoteGeneratedDirectory(workRoot, root);
    workRoot = null;
    return {
      ok: true,
      code: 'GENERATED_ONLY',
      phase: 'GENERATED_ONLY',
      root,
      generated: true,
      report,
      message: '仅生成完成；未验证，可执行 /sg-verify。',
    };
  } catch (error) {
    if (workRoot) fs.rmSync(workRoot, { recursive: true, force: true });
    return {
      ok: false,
      code: 'E_GENERATION_FAILED',
      message: error.message,
      generated: false,
      root,
    };
  }
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
      (result.report.template?.verified ? '已本地验证' : '未验证（可执行 /sg-verify）') +
      (result.report.template?.pendingPlatforms?.length
        ? '；待验收平台：' + result.report.template.pendingPlatforms.join(', ')
        : '')
    : '';
  return prefix + result.message + version;
}
