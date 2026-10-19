import fs from 'node:fs';
import path from 'node:path';
import { exists, readText } from './util/fsx.js';

/**
 * 老项目接入（REQ：扫描现有项目反推需求）。
 * 只读扫描：不修改、不删除任何现有文件。
 */

export const SCAN_VERSION = 'v1.0';
export const MAX_SCAN_FILES = 4000;
export const MAX_FILE_BYTES = 512 * 1024;

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.specgate',
  '.ak47',
  '.qoder',
  '.dsh',
  'dist',
  'build',
  'out',
  'target',
  'bin',
  'obj',
  'coverage',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.gradle',
  '.idea',
  '.vscode',
  'vendor',
  'tmp',
  'temp',
]);

const STACK_MARKERS = [
  { stack: 'node', files: ['package.json'], note: 'Node.js' },
  {
    stack: 'python',
    files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'manage.py', 'Pipfile'],
    note: 'Python',
  },
  {
    stack: 'java',
    files: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'mvnw', 'gradlew'],
    note: 'Java',
  },
  { stack: 'vue', files: ['vite.config.ts', 'vite.config.js'], note: 'Vite 前端' },
  { stack: 'react', files: ['next.config.js', 'next.config.mjs'], note: 'React 前端' },
  { stack: 'go', files: ['go.mod'], note: 'Go' },
  { stack: 'rust', files: ['Cargo.toml'], note: 'Rust' },
  { stack: 'dotnet', files: ['*.csproj', '*.sln'], note: '.NET' },
];

function listFiles(root, options = {}) {
  const maxFiles = options.maxFiles || MAX_SCAN_FILES;
  const out = [];
  const queue = [''];
  let truncated = false;
  while (queue.length) {
    const relative = queue.shift();
    const dir = path.join(root, relative);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        queue.push(child);
        continue;
      }
      if (!entry.isFile()) continue;
      if (out.length >= maxFiles) {
        truncated = true;
        break;
      }
      out.push(child);
    }
    if (truncated) break;
  }
  out.sort();
  return { files: out, truncated };
}

function readSmall(root, relative, maxBytes = MAX_FILE_BYTES) {
  const full = path.join(root, relative);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > maxBytes) return null;
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

function detectStacks(files) {
  const stacks = [];
  for (const marker of STACK_MARKERS) {
    for (const pattern of marker.files) {
      const hit = pattern.includes('*')
        ? files.some((file) => file.endsWith(pattern.slice(1)))
        : files.includes(pattern) || files.some((file) => file.endsWith('/' + pattern));
      if (!hit) continue;
      if (!stacks.some((item) => item.stack === marker.stack)) {
        stacks.push({ stack: marker.stack, note: marker.note, evidence: pattern });
      }
      break;
    }
  }
  return stacks;
}

const ROUTE_PATTERNS = [
  {
    kind: 'express',
    re: /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"\x60]([^'"\x60]+)/g,
    group: [1, 2],
  },
  {
    kind: 'fastify',
    re: /\b(?:fastify|server)\.(get|post|put|patch|delete)\(\s*['"\x60]([^'"\x60]+)/g,
    group: [1, 2],
  },
  { kind: 'flask', re: /@\w+\.(?:route|get|post|put|patch|delete)\(\s*['"]([^'"]+)/g, group: [1] },
  { kind: 'fastapi', re: /@\w+\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)/g, group: [1, 2] },
  {
    kind: 'spring',
    re: /@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:value\s*=\s*)?["']([^"']+)/g,
    group: [1, 2],
  },
  { kind: 'vue-router', re: /\bpath:\s*['"]([^'"]+)['"]/g, group: [1] },
];

const SOURCE_DIRS = [
  'src',
  'app',
  'apps',
  'lib',
  'server',
  'api',
  'backend',
  'frontend',
  'packages',
  'services',
  'routes',
  'controllers',
  'pages',
  'views',
];

function inSourceDir(file) {
  const head = file.split('/')[0];
  return SOURCE_DIRS.includes(head) || file.split('/').length === 1;
}

function detectRoutes(root, files) {
  const routes = [];
  const seen = new Set();
  for (const file of files) {
    if (!inSourceDir(file)) continue;
    if (!/\.(js|mjs|cjs|ts|tsx|jsx|vue|py|java|kt)$/.test(file)) continue;
    const text = readSmall(root, file, 256 * 1024);
    if (!text) continue;
    for (const pattern of ROUTE_PATTERNS) {
      pattern.re.lastIndex = 0;
      let match;
      while ((match = pattern.re.exec(text))) {
        const method = pattern.group.length === 2 ? String(match[1]).toUpperCase() : 'ANY';
        const route = String(match[pattern.group.length === 2 ? 2 : 1] || '').trim();
        if (!route.startsWith('/')) continue;
        const key = method + ' ' + route;
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push({ method, path: route, file, kind: pattern.kind });
      }
    }
  }
  routes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return routes;
}

function detectCapabilities(root, files) {
  const capabilities = new Map();
  const known = {
    health: '健康检查',
    auth: '身份认证',
    login: '登录',
    user: '用户管理',
    version: '版本信息',
    config: '配置管理',
    report: '报表',
    order: '订单',
    payment: '支付',
    upload: '文件上传',
    search: '搜索',
    notify: '通知',
    admin: '后台管理',
    audit: '审计日志',
    cache: '缓存',
    job: '定时任务',
    file: '文件存储',
  };
  for (const file of files) {
    const parts = file
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .split('/');
    for (const part of parts) {
      for (const [key, label] of Object.entries(known)) {
        if (part === key || part.includes(key)) capabilities.set(key, label);
      }
    }
  }
  return Array.from(capabilities.entries()).map(([key, label]) => ({ key, label }));
}

function detectConstraints(root, files, scan) {
  const constraints = [];
  const present = new Set(files);
  const has = (name) => present.has(name) || files.some((file) => file.endsWith('/' + name));

  if (has('Dockerfile') || has('docker-compose.yml') || has('compose.yaml')) {
    constraints.push('部署依赖容器镜像（Dockerfile / compose），需保持镜像构建可用');
  }
  if (
    has('.github/workflows') ||
    has('.gitlab-ci.yml') ||
    has('Jenkinsfile') ||
    has('azure-pipelines.yml')
  ) {
    constraints.push('已接入 CI，提交必须保持流水线通过');
  }
  if (has('pom.xml') || has('build.gradle') || has('build.gradle.kts')) {
    const java = scan.java;
    constraints.push(
      'Java 构建链已固定（' +
        (java.buildTool || 'maven') +
        (java.jdk ? ' / JDK ' + java.jdk : '') +
        (java.bootVersion ? ' / Spring Boot ' + java.bootVersion : '') +
        '），不升级主版本、不改构建坐标',
    );
  }
  if (has('package.json')) {
    const pkg = scan.packageJson;
    if (pkg && pkg.lockfile)
      constraints.push('Node.js 依赖以 ' + pkg.lockfile + ' 为准，不在接入时升级依赖');
    if (pkg && pkg.engines && pkg.engines.node) {
      constraints.push('Node.js 版本要求 ' + pkg.engines.node);
    }
  }
  if (has('pyproject.toml') || has('requirements.txt')) {
    constraints.push('Python 依赖清单已存在，接入过程中不新增必装依赖');
  }
  if (exists(path.join(root, '.env')) || exists(path.join(root, '.env.example'))) {
    constraints.push('运行依赖环境变量（.env），不得把密钥写入版本库');
  }
  if (exists(path.join(root, 'LICENSE'))) constraints.push('已有开源许可证，需保持许可兼容');
  if (scan.db) constraints.push('已存在数据库相关文件（' + scan.db + '），不做破坏性 schema 变更');
  if (scan.i18n) constraints.push('已存在多语言资源，新增文案需同步 i18n');
  constraints.push('接入过程中不修改现有业务代码行为，只补充需求基线与流程配置');
  return constraints;
}

function detectNonFunctional(root, files, scan) {
  const items = [];
  if (
    files.some(
      (file) =>
        /(^|\/)(__tests__|test|tests|spec|e2e)\//.test(file) || /\.(test|spec)\./.test(file),
    )
  ) {
    items.push('现有测试套件必须保持通过（接入不得破坏既有测试）');
  }
  if (scan.hasCi) items.push('CI 流水线保持绿色，接入后不允许跳过检查');
  items.push('接口响应时间不劣于改造前基线，关键路径 P95 小于 300ms');
  if (scan.hasDocker || scan.hasCi)
    items.push('部署形态（镜像 / 流水线）保持不变，接入不新增运维依赖');
  items.push('现有对外接口契约保持向后兼容，不做破坏性变更');
  items.push('密钥与凭证不入库，沿用现有环境变量与密钥管理方式');
  return items;
}

function detectFunctional(scan) {
  const items = [];
  for (const route of scan.routes.slice(0, 40)) {
    const label = route.method === 'ANY' ? route.path : route.method + ' ' + route.path;
    items.push('现有接口可用：' + label);
  }
  for (const capability of scan.capabilities) {
    if (items.length >= 60) break;
    const covered = scan.routes.some((route) => route.path.toLowerCase().includes(capability.key));
    if (covered) continue;
    items.push('现有能力保持可用：' + capability.label);
  }
  if (!items.length) {
    items.push('现有 ' + (scan.stacks[0]?.note || '项目') + ' 主流程在接入改造后保持原行为');
  }
  return items;
}

function detectAcceptance(functional) {
  return functional.map((item) => '回归验证通过：' + String(item).replace(/^现有[^：]*：/, ''));
}

export function scanJava(root) {
  const result = { buildTool: null, jdk: null, bootVersion: null };
  if (exists(path.join(root, 'pom.xml'))) result.buildTool = 'maven';
  else if (exists(path.join(root, 'build.gradle')) || exists(path.join(root, 'build.gradle.kts'))) {
    result.buildTool = 'gradle';
  }
  const pom = exists(path.join(root, 'pom.xml')) ? readSmall(root, 'pom.xml') : null;
  if (pom) {
    const jdk =
      /<java\.version>([^<]+)</.exec(pom) || /<maven\.compiler\.source>([^<]+)</.exec(pom);
    if (jdk) result.jdk = jdk[1].trim();
    const boot = /<version>([0-9]+\.[0-9]+\.[0-9]+[^<]*)<\/version>/.exec(
      /spring-boot-starter-parent[\s\S]{0,200}?<version>([^<]+)</.exec(pom)?.[0] || '',
    );
    if (boot) result.bootVersion = boot[1].trim();
  }
  for (const name of ['build.gradle', 'build.gradle.kts']) {
    if (!exists(path.join(root, name))) continue;
    const text = readSmall(root, name) || '';
    const jdk =
      /sourceCompatibility\s*=?\s*['"]?([0-9]+)/.exec(text) ||
      /JavaLanguageVersion\.of\(([0-9]+)\)/.exec(text);
    if (jdk && !result.jdk) result.jdk = jdk[1];
    const boot = /springframework\.boot['"]?\s*version\s*['"]?([0-9][^'"\s]*)/.exec(text);
    if (boot && !result.bootVersion) result.bootVersion = boot[1];
  }
  if (exists(path.join(root, '.java-version')))
    result.jdk = readText(path.join(root, '.java-version')).trim();
  return result;
}

export function scanProject(root, options = {}) {
  const listing = listFiles(root, options);
  const files = listing.files;
  const stacks = detectStacks(files);
  const routes = detectRoutes(root, files);
  const capabilities = detectCapabilities(root, files);

  let packageJson = null;
  if (files.includes('package.json')) {
    try {
      const parsed = JSON.parse(readSmall(root, 'package.json') || '{}');
      packageJson = {
        name: parsed.name || null,
        engines: parsed.engines || null,
        lockfile: files.includes('pnpm-lock.yaml')
          ? 'pnpm-lock.yaml'
          : files.includes('yarn.lock')
            ? 'yarn.lock'
            : files.includes('package-lock.json')
              ? 'package-lock.json'
              : null,
        scripts: Object.keys(parsed.scripts || {}),
      };
    } catch {
      packageJson = { name: null, engines: null, lockfile: null, scripts: [] };
    }
  }

  const hasCi = files.some(
    (file) =>
      file.startsWith('.github/workflows/') ||
      file === '.gitlab-ci.yml' ||
      file === 'Jenkinsfile' ||
      file.startsWith('.circleci/') ||
      file === 'azure-pipelines.yml',
  );
  const hasDocker = files.some(
    (file) => file === 'Dockerfile' || /(^|\/)docker-compose\.ya?ml$/.test(file),
  );
  const db =
    files.find((file) => /(^|\/)(migrations?|schema\.sql|alembic|prisma)(\/|$)/.test(file)) || null;
  const i18n = files.find((file) => /(^|\/)(locales|i18n|lang)(\/|$)/.test(file)) || null;

  const scan = {
    version: SCAN_VERSION,
    root,
    files,
    truncated: listing.truncated,
    fileCount: files.length,
    stacks,
    routes,
    capabilities,
    packageJson,
    java: scanJava(root),
    db,
    i18n,
    hasCi,
    hasDocker,
  };
  scan.functional = detectFunctional(scan);
  scan.nonFunctional = detectNonFunctional(root, files, scan);
  scan.constraints = detectConstraints(root, files, scan);
  scan.acceptance = detectAcceptance(scan.functional);
  return scan;
}

/** 反推四维需求；缺项用示例占位，保证 REQ.md 一定可生成。 */
export function reverseRequirements(scan, fallback = {}) {
  const pick = (list, fallbackList) => (list && list.length ? list : fallbackList.slice());
  return {
    functional: pick(scan.functional, fallback.functional || ['现有项目主流程保持可用']),
    nonFunctional: pick(
      scan.nonFunctional,
      fallback.nonFunctional || ['接口 P95 响应时间小于 300ms'],
    ),
    constraints: pick(scan.constraints, fallback.constraints || ['不破坏现有接口契约']),
    acceptance: pick(scan.acceptance, fallback.acceptance || []),
  };
}

/** 人类可读的扫描摘要，写进确认页与 init-result.json。 */
export function renderScanSummary(scan) {
  const lines = [];
  lines.push('## 项目扫描结果（只读）');
  lines.push('');
  lines.push('- 文件数：' + scan.fileCount + (scan.truncated ? '（已截断）' : ''));
  lines.push(
    '- 识别技术栈：' +
      (scan.stacks.length
        ? scan.stacks.map((item) => item.note + '(' + item.stack + ')').join('、')
        : '未识别'),
  );
  if (scan.routes.length) {
    lines.push('- 识别接口 ' + scan.routes.length + ' 个，例如：');
    for (const route of scan.routes.slice(0, 8)) {
      lines.push(
        '  - ' +
          (route.method === 'ANY' ? '' : route.method + ' ') +
          route.path +
          '（' +
          route.file +
          '）',
      );
    }
  }
  if (scan.capabilities.length) {
    lines.push('- 识别能力：' + scan.capabilities.map((item) => item.label).join('、'));
  }
  if (scan.packageJson) {
    lines.push(
      '- Node 包：' +
        (scan.packageJson.name || '(未命名)') +
        (scan.packageJson.engines?.node ? '，engines.node=' + scan.packageJson.engines.node : ''),
    );
  }
  if (scan.java && scan.java.buildTool) {
    lines.push(
      '- Java：' +
        scan.java.buildTool +
        (scan.java.jdk ? ' / JDK ' + scan.java.jdk : '') +
        (scan.java.bootVersion ? ' / Boot ' + scan.java.bootVersion : ''),
    );
  }
  lines.push(
    '- CI：' +
      (scan.hasCi ? '已接入' : '未识别') +
      '；容器：' +
      (scan.hasDocker ? '已接入' : '未识别'),
  );
  return lines.join('\n');
}

export function renderMarkdownReport(scan, requirements) {
  const lines = [renderScanSummary(scan), '', '## 反推需求（已确认）', ''];
  const data = requirements || {};
  lines.push('### 功能需求（MVP）');
  lines.push('');
  for (const item of data.functional || []) lines.push('- ' + item);
  lines.push('');
  lines.push('### 非功能需求');
  lines.push('');
  for (const item of data.nonFunctional || []) lines.push('- ' + item);
  lines.push('');
  lines.push('### 约束与依赖');
  lines.push('');
  for (const item of data.constraints || []) lines.push('- ' + item);
  lines.push('');
  lines.push('### 验收标准');
  lines.push('');
  for (const item of data.acceptance || []) lines.push('- ' + item);
  lines.push('');
  lines.push('> 本报告由 /sg-init 只读扫描生成，未修改任何现有文件。');
  return lines.join('\n');
}
