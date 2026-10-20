import fs from 'node:fs';
import path from 'node:path';
import { scanEnvironment } from './environment.js';
import {
  ensureBuildWrappers,
  persistToolchain,
  planProvisioning,
  resolveMavenRepo,
  provisionSummary,
  provisionToolchain,
  toolchainEnv,
  verifyToolchain,
} from './provision.js';
import { jdkSourceSummary, resolveMirrors, writeMirrorFiles } from './mirrors.js';
import { scanWorkspace } from './workspace.js';

const TOOL_LABELS = [
  ['node', 'Node'],
  ['pnpm', 'pnpm'],
  ['npm', 'npm'],
  ['python', 'Python'],
  ['uv', 'uv'],
  ['java', 'JDK'],
  ['mvn', 'Maven'],
  ['gradle', 'Gradle'],
];

function sidesOf(scan) {
  if (!scan || scan.kind !== 'v4') return [];
  return (scan.sides || []).map((side) => {
    const item = {
      id: side.id,
      path: side.path,
      stack: side.stack,
      role: side.role,
      framework: side.framework,
      buildTool: side.buildTool,
      packageManager: side.packageManager,
    };
    if (side.stack === 'java') item.jdk = side.jdk || side.runtimeVersion || '17';
    if (side.stack === 'python') item.pythonVersion = side.runtimeVersion;
    if (side.stack === 'node' || side.stack === 'vue' || side.stack === 'react') {
      item.nodeVersion = side.runtimeVersion;
    }
    return item;
  });
}

function toolRows(environment) {
  const rows = [];
  for (const [key, label] of TOOL_LABELS) {
    const list = (environment.tools && environment.tools[key]) || [];
    if (!list.length) {
      rows.push({ name: label, version: '-', source: '-', status: 'missing' });
      continue;
    }
    for (const item of list) {
      rows.push({
        name: label,
        version: item.version || 'unknown',
        source: item.source || '-',
        status: 'ok',
      });
    }
  }
  return rows;
}

function pad(value, width) {
  const text = String(value === null || value === undefined ? '' : value);
  return text.length >= width ? text + ' ' : text + ' '.repeat(width - text.length);
}

function renderTable(rows) {
  const lines = [pad('工具', 10) + pad('版本', 16) + pad('来源', 10) + '状态'];
  for (const row of rows) {
    lines.push(pad(row.name, 10) + pad(row.version, 16) + pad(row.source, 10) + row.status);
  }
  return lines;
}

function planLines(plan) {
  if (!plan) return ['环境计划：未生成（当前目录不是 v4 workspace，先执行 sg_init）'];
  if (plan.ok === false) return ['环境计划：不可用 —— ' + plan.message];
  return String(provisionSummary(plan) || '复用当前环境')
    .split('\n')
    .map((line) => '环境计划：' + line);
}

function jdkLines(selection, plan) {
  const lines = [];
  if (!plan || plan.ok === false) return lines;
  const mirrors = plan.mirrors || resolveMirrors();
  for (const side of selection.sides || []) {
    if (side.stack !== 'java') continue;
    const source = jdkSourceSummary(mirrors, side.jdk, plan.platform, plan.arch);
    lines.push('JDK 源（' + side.id + ' ' + side.jdk + '）：' + (source || '无可用归档'));
  }
  return lines;
}

function header(root, environment, plan) {
  const mirrors = (plan && plan.mirrors) || resolveMirrors();
  return [
    '# SpecGate 环境自检',
    '项目：' + root,
    '平台：' +
      environment.platform +
      '/' +
      environment.arch +
      ' ｜ 镜像：' +
      mirrors.preset +
      ' ｜ JDK 提供方：' +
      mirrors.jdkProvider,
    '沙箱：' +
      (environment.sandbox?.scope || 'project') +
      ' ｜ 项目可写：' +
      (environment.sandbox?.projectWritable ? 'yes' : 'no') +
      ' ｜ 主目录可写：' +
      (environment.sandbox?.homeWritable ? 'yes' : 'no'),
  ];
}

function writeReport(root, body) {
  const dir = path.join(root, '.specgate');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'env-report.md'), body + '\n', 'utf8');
    return path.join(dir, 'env-report.md');
  } catch {
    return null;
  }
}

function toolsFromEnvironment(environment) {
  const first = (name) => ((environment.tools && environment.tools[name]) || [])[0] || null;
  const tools = {};
  const java = first('java');
  if (java) tools.java = java;
  const mvn = first('mvn');
  if (mvn) tools.maven = mvn;
  const gradle = first('gradle');
  if (gradle) tools.gradle = gradle;
  const uv = first('uv');
  if (uv) tools.uv = uv;
  return tools;
}

function neededTools(selection) {
  const needed = new Set();
  for (const side of selection.sides || []) {
    if (side.stack === 'java') {
      needed.add('JDK');
      needed.add(side.buildTool === 'gradle' ? 'Gradle' : 'Maven');
    } else if (side.stack === 'python') {
      needed.add('Python');
    } else {
      needed.add('Node');
      needed.add(side.packageManager === 'npm' ? 'npm' : 'pnpm');
    }
  }
  return needed;
}

async function checkEnv({ root, environment, plan, selection }) {
  const rows = toolRows(environment);
  const needed = neededTools(selection);
  const missing = rows
    .filter((row) => row.status === 'missing' && (needed.size === 0 || needed.has(row.name)))
    .map((row) => row.name);
  const lines = header(root, environment, plan);
  lines.push('');
  lines.push(...renderTable(rows));
  if (missing.length) lines.push('', '缺失：' + missing.join(' / '));
  lines.push('', ...planLines(plan));
  lines.push(...jdkLines(selection, plan));
  lines.push('', '安装：sg_env({ action: "install" })；校验：sg_env({ action: "verify" })');
  const text = lines.join('\n');
  const report = writeReport(root, text);
  return {
    ok: true,
    text: text + (report ? '\n报告：' + report : ''),
    data: { environment, plan, report },
  };
}

async function installEnv({ root, environment, plan, selection }) {
  if (!plan) {
    return {
      ok: false,
      text: '安装失败：当前目录不是 v4 workspace（缺少 .specgate/workspace.yaml），先执行 sg_init。',
      data: { code: 'NOT_V4' },
    };
  }
  if (plan.ok === false) {
    return { ok: false, text: '安装失败：' + plan.message, data: plan };
  }
  let tools = plan.tools || {};
  const actions = plan.actions || [];
  if (actions.length) {
    const provisioned = await provisionToolchain({ root, plan });
    if (!provisioned.ok) {
      return { ok: false, text: '安装失败：' + provisioned.message, data: provisioned };
    }
    tools = provisioned.tools;
  }
  const javaSide = (selection.sides || []).find((side) => side.stack === 'java');
  const verified = verifyToolchain(tools, toolchainEnv(tools), {
    jdkMajor: javaSide ? javaSide.jdk : null,
  });
  if (!verified.ok) {
    return { ok: false, text: '校验失败：' + verified.message, data: verified };
  }
  if (tools.maven && !tools.maven.repo) tools.maven.repo = resolveMavenRepo(root);
  const mirrors = resolveMirrors();
  writeMirrorFiles(root, mirrors, { localRepository: tools.maven?.repo || null });
  const env = persistToolchain({
    root,
    tools,
    platform: plan.platform,
    arch: plan.arch,
  });
  tools.env = env;
  const wrappers = [];
  for (const side of selection.sides || []) {
    if (side.stack !== 'java') continue;
    const result = ensureBuildWrappers(path.join(root, side.path), plan.platform);
    if (result.changed.length) wrappers.push(side.path + ' -> ' + result.changed.join(', '));
  }
  const lines = [
    '# 工具链已就绪',
    '项目：' + root,
    '动作：' + (actions.length ? actions.length + ' 项安装/下载' : '复用现有工具链'),
  ];
  lines.push('校验：' + (verified.checks || []).join(' / '));
  for (const action of actions) {
    lines.push(
      '- ' +
        action.tool +
        ' ' +
        action.version +
        '：' +
        (action.kind === 'download' ? '已解压到 ' + action.target : '已安装到 ' + action.target),
    );
  }
  if (wrappers.length) lines.push('包装器：' + wrappers.join('；'));
  lines.push('环境变量：' + env.hint);
  for (const [key, value] of Object.entries(env.vars || {})) lines.push('  ' + key + '=' + value);
  lines.push('', '激活后可直接使用 java / javac / mvn（无需安装程序、无需管理员权限）。');
  lines.push('下一步：重跑 /sg-init 可补跑初始化阶段跳过的质量检查。');
  const text = lines.join('\n');
  writeReport(root, text);
  return { ok: true, text, data: { tools, env, actions, project: root } };
}

async function verifyEnv({ root, environment, plan, selection }) {
  const tools = (plan && plan.ok && plan.tools) || toolsFromEnvironment(environment);
  const javaSide = (selection.sides || []).find((side) => side.stack === 'java');
  const verified = verifyToolchain(tools, toolchainEnv(tools), {
    jdkMajor: javaSide ? javaSide.jdk : null,
  });
  const rows = toolRows(environment);
  const lines = header(root, environment, plan);
  lines.push('', ...renderTable(rows), '');
  if (verified.ok) {
    lines.push('校验通过：' + (verified.checks || []).join(' / '));
  } else {
    lines.push('校验失败：' + verified.message);
  }
  const text = lines.join('\n');
  writeReport(root, text);
  return { ok: verified.ok, text, data: { verified, tools } };
}

function activateEnv({ root, environment }) {
  const file = path.join(root, '.specgate', 'toolchains', 'env.json');
  if (!fs.existsSync(file)) {
    const lines = header(root, environment, null);
    lines.push('', '尚未生成工具链环境：先执行 sg_env({ action: "install" })。');
    return { ok: false, text: lines.join('\n'), data: { code: 'ENV_NOT_INSTALLED' } };
  }
  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    payload = null;
  }
  const lines = ['# 激活项目工具链环境', '项目：' + root];
  if (payload && payload.vars) {
    for (const [key, value] of Object.entries(payload.vars)) lines.push(key + '=' + value);
  }
  const dir = path.join(root, '.specgate', 'toolchains');
  if (fs.existsSync(path.join(dir, 'env.ps1'))) {
    lines.push('', 'Windows PowerShell：. ' + path.join(dir, 'env.ps1'));
  }
  if (fs.existsSync(path.join(dir, 'env.cmd'))) {
    lines.push('Windows cmd：call ' + path.join(dir, 'env.cmd'));
  }
  if (fs.existsSync(path.join(dir, 'env.sh'))) {
    lines.push('Linux/macOS：source ' + path.join(dir, 'env.sh'));
  }
  lines.push(
    '',
    '脚本只影响当前 shell，刷新后再次执行即可；子进程（sg_run / 编辑器终端）已自动继承。',
  );
  return { ok: true, text: lines.join('\n'), data: { env: payload } };
}

export async function runEnvCommand({ cwd, path: targetPath = null, action = 'check' } = {}) {
  const root = targetPath ? path.resolve(cwd, targetPath) : cwd;
  const act = String(action || 'check').toLowerCase();
  const scan = scanWorkspace(root);
  const selection = { sides: sidesOf(scan) };
  const environment = await scanEnvironment({ root });
  let plan = null;
  if (selection.sides.length) {
    plan = planProvisioning({ environment, selection, mirrors: resolveMirrors() });
  }
  if (act === 'install') return installEnv({ root, environment, plan, selection });
  if (act === 'verify') return verifyEnv({ root, environment, plan, selection });
  if (act === 'activate') return activateEnv({ root, environment });
  return checkEnv({ root, environment, plan, selection });
}
