import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { observeInitTarget, requestInitApproval, consumeInitApproval } from './init-contract.js';
import { emptyState } from '../v3/state.js';
import { renderRequirementsDoc } from '../v3/requirements.js';
import { establishInitialBaseline, patchBaselineState } from '../v3/baseline.js';
import { fixedScaffoldFiles, fixedSelection, fixedVersions } from './minimal-scaffold.js';
import { verifyFixedScaffold, verificationPlan } from './minimal-verification.js';
import { workspaceYamlDetailed } from './workspace.js';

const hash = (value) => 'sha256:' + createHash('sha256').update(value).digest('hex');
const blocked = (code, message) => ({ ok: false, complete: false, changed: false, code, message });

function executable(name, directories) {
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const directory of directories.filter(Boolean)) {
    for (const suffix of suffixes) {
      if (!path.isAbsolute(directory)) continue;
      const candidate = path.join(directory, name + suffix);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* candidate absent */
      }
    }
  }
  return null;
}

/** Only trusted version probes, never package scripts, installers, writable probes or network. */
export function detectFixedEnvironment(root, env = process.env) {
  // Windows environment keys are case-insensitive, but the JavaScript object is not.
  env = Object.fromEntries(Object.entries(env).map(([key, value]) => [key.toUpperCase(), value]));
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const pathDirs = String(env.PATH || env.Path || '').split(path.delimiter);
  const local = path.join(root, '.specgate', 'toolchains');
  const javaDirs = [
    env.JAVA_HOME && path.join(env.JAVA_HOME, 'bin'),
    path.join(home, '.tools', 'jdk8', 'bin'),
    path.join(local, 'jdk8', 'bin'),
    ...pathDirs,
  ];
  const mavenDirs = [
    env.MAVEN_HOME && path.join(env.MAVEN_HOME, 'bin'),
    path.join(home, '.tools', 'maven', 'bin'),
    ...pathDirs,
  ];
  const nodeDirs = [path.dirname(process.execPath), ...pathDirs];
  const npmScript = [
    env.SG_NPM_CLI,
    path.resolve(path.dirname(process.execPath), '../node_modules/npm/bin/npm-cli.js'),
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'nodejs/node_modules/npm/bin/npm-cli.js'),
    env['PROGRAMFILES(X86)'] &&
      path.join(env['PROGRAMFILES(X86)'], 'nodejs/node_modules/npm/bin/npm-cli.js'),
    ...pathDirs
      .filter((directory) => directory && path.isAbsolute(directory))
      .map((directory) => path.join(directory, 'node_modules/npm/bin/npm-cli.js')),
  ]
    .filter(Boolean)
    .find((file) => fs.existsSync(file));
  const tools = {};
  const probe = (name, directories, args, childEnv = env) => {
    const file = executable(name, directories);
    if (!file) return null;
    const result = spawnSync(file, args, {
      cwd: os.tmpdir(),
      env: childEnv,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(file),
    });
    if (result.status !== 0) return null;
    const output = String(result.stdout || '') + String(result.stderr || '');
    const version = /\d+\.\d+(?:[._]\d+)?/.exec(output)?.[0];
    return version ? { path: file, version } : null;
  };
  tools.java = probe('java', javaDirs, ['-version']);
  tools.javac = probe('javac', tools.java ? [path.dirname(tools.java.path)] : javaDirs, [
    '-version',
  ]);
  for (const name of ['java', 'javac'])
    if (tools[name])
      tools[name].major = tools[name].version.startsWith('1.')
        ? Number(tools[name].version.split('.')[1])
        : Number(tools[name].version.split('.')[0]);
  const childEnv = { ...env };
  if (tools.java) childEnv.JAVA_HOME = path.dirname(path.dirname(tools.java.path));
  childEnv.PATH = [
    ...(tools.java ? [path.dirname(tools.java.path)] : []),
    ...nodeDirs,
    ...pathDirs,
  ].join(path.delimiter);
  tools.mvn = probe('mvn', mavenDirs, ['-version'], childEnv);
  tools.maven = tools.mvn;
  tools.node = probe('node', nodeDirs, ['--version']);
  tools.npm = probe('npm', [...nodeDirs, ...pathDirs], ['--version'], childEnv);
  if (!tools.npm && npmScript && tools.node) {
    const result = spawnSync(tools.node.path, [npmScript, '--version'], {
      cwd: os.tmpdir(),
      env: childEnv,
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    const version = /\d+\.\d+\.\d+/.exec(String(result.stdout || ''))?.[0];
    if (result.status === 0 && version)
      tools.npm = { path: npmScript, version, kind: 'node-script' };
  }
  const browserCandidates = [
    env.SG_BROWSER_EXECUTABLE,
    path.join(env.PROGRAMFILES || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(
      env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)',
      'Microsoft/Edge/Application/msedge.exe',
    ),
    path.join(env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(home, 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    executable('chromium', pathDirs),
    executable('google-chrome', pathDirs),
  ];
  tools.browser = browserCandidates.filter(Boolean).find((file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  });
  if (tools.browser) tools.browser = { path: tools.browser };
  const missing = ['java', 'javac', 'mvn', 'node', 'npm', 'browser'].filter((name) => !tools[name]);
  if (tools.java && tools.java.major !== 8)
    missing.push('Java 8 (detected ' + tools.java.version + ')');
  if (tools.javac && tools.javac.major !== 8)
    missing.push('javac 8 (detected ' + tools.javac.version + ')');
  if (tools.node && Number(tools.node.version.split('.')[0]) < 20) missing.push('Node.js >=20');
  if (tools.npm && Number(tools.npm.version.split('.')[0]) < 10) missing.push('npm >=10');
  if (tools.mvn) {
    const [major, minor] = tools.mvn.version.split('.').map(Number);
    if (major < 3 || (major === 3 && minor < 6)) missing.push('Maven >=3.6');
  }
  return { ok: missing.length === 0, tools, missing };
}

export function fixedRequirements() {
  return {
    functional: [
      '提供可删除的 Item 示例：id 后端生成，name 去首尾空白后 1–100 字符；创建、列表、详情、修改和删除',
      'Vue 页面真实连接后端，提供加载、空列表、输入校验和错误反馈',
    ],
    nonFunctional: [
      'H2 项目局部文件库持久化，后端正常重启后数据保留；不承诺生产备份或多实例部署',
      '构建、基本自动化测试、实际启动、浏览器 CRUD、非法输入及重启持久化全部通过后才能完成',
    ],
    constraints: [
      'Java 8 / Spring Boot 2.7.18 / Maven；Vue 3 / Vite / TypeScript / npm；具体依赖版本见工程文件',
      '新建工程，不覆盖已有文件；不下载工具链、不全局安装、不修改系统环境',
      '不包含鉴权、复杂业务、生产部署；后续通过 sg change 修改当前有效 req，不自动发起业务 change',
    ],
    acceptance: [
      '浏览器和 HTTP 增查改删及非法输入通过，重启后读出已保存数据',
      '前后端构建、测试和真实联通通过；验证进程被清理',
    ],
  };
}

export function fixedWorkflowFiles(selection = fixedSelection()) {
  const req =
    renderRequirementsDoc(fixedRequirements(), { version: 'v1.0' })
      .text.replace('状态：已确认', '状态：需求已批准；实现有效性以工程状态和验证证据为准')
      .replace(
        '后续需求变更只能通过 openspec/changes/vX.Y/delta.md 提出，并同步更新本文件。',
        '后续通过 sg change 引用当前有效基线并记录需求差异；验收及完成确认后才能更新本文件。',
      ) + '\n';
  const state = {
    schemaVersion: 4,
    workflowVersion: 4,
    phase: 'IDLE',
    change: null,
    type: null,
    workspace: { backend: 'java', frontend: 'vue', sides: ['api', 'web'] },
    projectReq: {
      status: 'pending',
      doc: 'openspec/REQ.md',
      version: 'v1.0',
      contentHash: hash(req),
      sourceChange: null,
    },
    updatedAt: null,
  };
  const files = {
    '.specgate/workspace.yaml': workspaceYamlDetailed(selection, {
      profile: 'full',
      approval: 'approved',
    }),
    '.specgate/state.json': JSON.stringify(state, null, 2) + '\n',
    'openspec/REQ.md': req,
  };
  for (const side of selection.sides) {
    const config = [
      'workflowVersion: 4',
      'schemaVersion: 4',
      'language: zh',
      'stack: ' + side.stack,
      'maxParallel: 1',
      'requirements:',
      '  enabled: true',
      '  version: v1.0',
      '  doc: openspec/REQ.md',
      'testing:',
      '  command: []',
      '  cwd: .',
      '',
    ].join('\n');
    files[side.path + '/.specgate/config.yaml'] = config;
    files[side.path + '/.specgate/state.json'] = JSON.stringify(emptyState(), null, 2) + '\n';
    files[side.path + '/openspec/REQ.md'] = req;
  }
  return files;
}

function targetPath(root, relative) {
  const absolute = path.resolve(root, relative);
  if (absolute === root || !absolute.startsWith(root + path.sep))
    throw new Error('计划路径越界：' + relative);
  let cursor = absolute;
  while (true) {
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error('符号链接路径：' + cursor);
      if (cursor !== absolute && !stat.isDirectory()) throw new Error('父路径不是目录：' + cursor);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return absolute;
}

export function inspectFixedTargets(root, files) {
  try {
    observeInitTarget(root);
    for (const relative of Object.keys(files)) {
      const absolute = targetPath(root, relative);
      try {
        fs.lstatSync(absolute);
        return blocked('FILE_CONFLICT', '禁止覆盖已有文件：' + relative);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    for (const relative of [
      '.git',
      '.specgate',
      'api/.git',
      'web/.git',
      'api/target',
      'api/data',
      'api/.m2-repository',
      'web/node_modules',
      'web/.npm-cache',
      'web/dist',
      'web/package-lock.json',
    ]) {
      if (fs.existsSync(path.join(root, relative)))
        return blocked(
          'EXISTING_PROJECT',
          '已有工程或部分初始化：' + relative + '；请人工处理或更换目录',
        );
    }
    return { ok: true };
  } catch (error) {
    return blocked('TARGET_UNREADABLE', error.message);
  }
}

function makeDirectory(directory) {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('目录冲突：' + directory);
    return;
  }
  const parent = path.dirname(directory);
  if (parent !== directory) makeDirectory(parent);
  try {
    fs.mkdirSync(directory);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw error;
  }
}

export function createFixedFiles(root, files, created = []) {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = targetPath(root, relative);
    makeDirectory(path.dirname(absolute));
    // O_EXCL prevents a file introduced after approval from being overwritten.
    const descriptor = fs.openSync(absolute, 'wx');
    try {
      fs.writeFileSync(descriptor, content, 'utf8');
      created.push(relative);
    } finally {
      fs.closeSync(descriptor);
    }
  }
  return created;
}

async function clarify({ root, environment, userQuestions, agent, signal }) {
  const rounds = [
    [
      'target',
      '初始化目标',
      '新建全栈工程：' + root + '\n一个可删除的 Item CRUD；不接入或覆盖已有工程。',
    ],
    [
      'stack',
      '技术与环境',
      '固定 Java 8 + Spring Boot 2.7.18 + Maven + H2 文件库；Vue 3 + Vite + TypeScript + npm。\n具体模板版本：' +
        JSON.stringify(fixedVersions) +
        '\n检测环境：' +
        JSON.stringify(environment.tools),
    ],
    [
      'acceptance',
      '数据与验收',
      '本地持久化，正常重启保留；构建、基本测试、实际启动、真实浏览器 CRUD 和非法输入全部验收。\n允许本方案展示的项目依赖安装；不下载工具链、不改全局环境；安装10分钟、构建测试5分钟、启动90秒上限。',
    ],
  ];
  for (const [id, header, question] of rounds) {
    const answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-fixed-' + id,
          header,
          question,
          options: [
            { label: '使用上述范围', description: '继续完善方案，不授权执行' },
            {
              label: '返回修改或暂不执行',
              description: '结束本轮，不修改项目；可补充新需求后重新开始',
            },
          ],
        },
      ],
      agent,
      signal,
    });
    const item = answer?.answers?.find((entry) => entry.id === 'sg-fixed-' + id);
    if (
      signal?.aborted ||
      item?.custom?.trim() ||
      item?.selected?.length !== 1 ||
      item.selected[0] !== '使用上述范围'
    )
      return false;
  }
  return true;
}

/** Human approval gates all target-project side effects, including requirement files. */
export async function startFixedInit({
  root,
  userQuestions,
  agent,
  signal,
  backend,
  frontend,
  preset,
  req,
  description,
  draft,
  environmentProbe = detectFixedEnvironment,
  verifier = verifyFixedScaffold,
  onStage = () => {},
}) {
  root = path.resolve(root);
  if (
    (backend && backend !== 'java') ||
    (frontend && frontend !== 'vue') ||
    (preset && preset !== 'java-vue')
  )
    return blocked(
      'UNSUPPORTED_INIT_STACK',
      '首版仅支持 Java 8 + Spring Boot 2.7.18 + Vue 3 TypeScript 固定全栈组合，不自动更换技术栈',
    );
  if (req || description || draft)
    return blocked(
      'NEEDS_DESIGN',
      '首版只初始化通用 Item 工程；指定业务需求需另行澄清，不自动扩大范围',
    );
  if (!userQuestions || typeof userQuestions.ask !== 'function')
    return blocked('APPROVAL_REQUIRED', '需要宿主对话澄清和明确执行批准；yes 不能跳过');
  const selection = fixedSelection();
  const files = { ...fixedScaffoldFiles(), ...fixedWorkflowFiles(selection) };
  let preflight = inspectFixedTargets(root, files);
  if (!preflight.ok) return preflight;
  onStage('detect');
  const environment = await environmentProbe(root);
  if (!environment.ok)
    return blocked(
      'ENV_BLOCKED',
      '工具缺失或版本不兼容：' +
        environment.missing.join('、') +
        '。请人工安装/修复后重新探测；未下载或修改环境',
    );
  let contract;
  try {
    if (!(await clarify({ root, environment, userQuestions, agent, signal })))
      return blocked('CANCELLED', '未确认初始化范围；未变更项目');
    contract = {
      schemaVersion: 2,
      root,
      sessionId: agent?.id || null,
      profile: 'full',
      operation: 'create',
      selection,
      observation: observeInitTarget(root),
      versions: fixedVersions,
      fileHashes: Object.fromEntries(
        Object.entries(files).map(([name, content]) => [name, hash(content)]),
      ),
      environment: environment.tools,
      requirements: fixedRequirements(),
      scope: {
        storage: 'h2-file',
        persistence: true,
        globalEnvironmentChanges: false,
        toolchainDownloads: false,
      },
    };
    contract.id = hash(JSON.stringify(contract));
    const freeze = (value) => {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    };
    freeze(contract);
    const commands = verificationPlan(environment.tools);
    const text = [
      '# sg-init 执行确认：方案 ' + contract.id.slice(0, 12),
      '目标：' + root + '（仅新建、不覆盖）',
      '技术栈版本：' + JSON.stringify(fixedVersions),
      '环境：' + JSON.stringify(environment.tools),
      '新增文件（完整模板清单）：',
      ...Object.keys(files).map((name) => '- ' + name),
      '项目安装产生：api/target、api/.m2-repository、web/node_modules、web/package-lock.json、web/.npm-cache、web/dist；H2数据 api/data；SG验证报告 .specgate/init-report.json。',
      '命令与超时：',
      typeof commands === 'string' ? commands : JSON.stringify(commands, null, 2),
      '初始 req：openspec/REQ.md，版本 v1.0；需求已批准但工程待验证。全部验收和状态保存成功后生效。',
      files['openspec/REQ.md'],
      '验收：安装、构建、基本测试、启动、真实浏览器 CRUD、非法输入、重启持久化；仅结束自有验证进程。',
      '不包含：正式业务、鉴权、生产部署、并行change；不下载工具链、不改系统环境、不覆盖文件。',
      '后续：通过 sg change 引用有效基线；不自动创建业务变更。',
      '风险：Java 8 / Boot 2.7.18 为旧组合，不承诺生产安全维护；失败保留变更，不自动回滚或续跑。',
      '本次不自动初始化或提交 Git；后续工作流所需 Git 基线需独立明确授权。',
    ].join('\n');
    onStage('awaiting-approval');
    const decision = await requestInitApproval({ contract, userQuestions, agent, signal, text });
    if (decision.decision !== 'approved')
      return blocked(
        decision.decision === 'modify' ? 'NEEDS_DESIGN' : 'CANCELLED',
        '未获执行批准；方案草稿不落盘',
      );
    const authorization = consumeInitApproval(contract, decision.receipt, signal);
    if (!authorization.ok) return { ...authorization, complete: false, changed: false };
  } catch (error) {
    return blocked('QUESTIONS_UNAVAILABLE', error.message);
  }
  preflight = inspectFixedTargets(root, files);
  if (!preflight.ok) return preflight;
  const rechecked = await environmentProbe(root);
  if (!rechecked.ok || JSON.stringify(rechecked.tools) !== JSON.stringify(environment.tools))
    return blocked('ENV_CHANGED', '执行前工具环境发生变化；旧批准失效，请重新探测确认');
  if (signal?.aborted) return blocked('CANCELLED', '已取消，未变更项目');
  const created = [];
  try {
    onStage('generate');
    createFixedFiles(root, files, created);
    const runtime = await verifier({ root, tools: environment.tools, signal, onStage });
    const passed =
      runtime.ok === true &&
      runtime.browserCrud === 'passed' &&
      runtime.restartPersistence === 'passed' &&
      runtime.cleanup === 'passed';
    // Persist evidence before publishing the effective baseline. A report write conflict must not activate req.
    const report = {
      schemaVersion: 3,
      contractId: contract.id,
      complete: false,
      acceptancePassed: passed,
      verificationStatus: passed ? 'passed' : 'failed',
      runtime,
      created,
      next: passed ? 'sg change（Git前提需独立准备）' : '人工处理残留或选择新目录后重新确认初始化',
    };
    const initialReportText = JSON.stringify(report, null, 2) + '\n';
    createFixedFiles(root, { '.specgate/init-report.json': initialReportText }, created);
    if (passed) {
      const baseline = establishInitialBaseline(root, {
        content: files['openspec/REQ.md'],
        version: 'v1.0',
        doc: 'openspec/REQ.md',
      });
      if (!baseline.ok) throw new Error(baseline.message || '初始基线状态保存失败');
      report.complete = true;
      const reportPath = targetPath(root, '.specgate/init-report.json');
      const expected = hash(initialReportText);
      try {
        if (hash(fs.readFileSync(reportPath, 'utf8')) !== expected)
          throw new Error('验收报告在发布前发生变化');
        // Update only the report this execution created; user-introduced replacements are rejected.
        const descriptor = fs.openSync(reportPath, 'r+');
        try {
          fs.writeFileSync(descriptor, JSON.stringify(report, null, 2) + '\n');
          fs.ftruncateSync(descriptor, Buffer.byteLength(JSON.stringify(report, null, 2) + '\n'));
        } finally {
          fs.closeSync(descriptor);
        }
      } catch (error) {
        patchBaselineState(root, (draft) => {
          draft.projectReq.status = 'pending';
          draft.projectReq.initialized = false;
        });
        throw error;
      }
    }
    onStage(passed ? 'complete' : 'failed');
    return {
      ...report,
      ok: passed,
      changed: true,
      code: passed ? undefined : 'VERIFICATION_FAILED',
      message: passed
        ? '初始化验收通过，初始 req 已生效；可通过 sg change 提出后续需求'
        : runtime.message || '验收未全部通过，初始化未完成；变更已保留',
    };
  } catch (error) {
    onStage('failed');
    return {
      ok: false,
      complete: false,
      changed: created.length > 0,
      code: 'INIT_FAILED',
      created,
      message: error.message + '；已生成内容保留，不自动回滚或续跑',
    };
  }
}
