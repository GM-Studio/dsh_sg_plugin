import fs from 'node:fs';
import path from 'node:path';
import { exists, readText, writeText } from './util/fsx.js';
import { detectJavaProject } from './java-detect.js';

const NODE_TOOLS = {
  node: ['prettier', 'eslint'],
  vue: ['prettier', 'eslint', 'eslint-plugin-vue'],
  react: ['prettier', 'eslint'],
  python: ['ruff', 'mypy'],
};

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return null;
  }
}

function packageManager(root) {
  if (exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(root, 'package-lock.json'))) return 'npm';
  return null;
}

function workspaceDirs(root) {
  const dirs = ['.'];
  const pkg = readJson(path.join(root, 'package.json'));
  const patterns = Array.isArray(pkg?.workspaces) ? pkg.workspaces : [];
  for (const pattern of patterns) {
    const clean = String(pattern).replace(/\/\*$/, '');
    const base = path.join(root, clean);
    if (!exists(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.posix.join(clean, entry.name));
    }
  }
  for (const candidate of ['apps', 'packages']) {
    const base = path.join(root, candidate);
    if (!exists(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.posix.join(candidate, entry.name));
    }
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (['node_modules', '.git', '.specgate', 'dist', 'build'].includes(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (
      exists(path.join(full, 'package.json')) ||
      exists(path.join(full, 'pyproject.toml')) ||
      exists(path.join(full, 'requirements.txt')) ||
      exists(path.join(full, 'pom.xml')) ||
      exists(path.join(full, 'build.gradle')) ||
      exists(path.join(full, 'build.gradle.kts'))
    ) {
      dirs.push(entry.name);
    }
  }
  return [...new Set(dirs)];
}

function stackOf(root, dir) {
  if (
    exists(path.join(root, dir, 'pom.xml')) ||
    exists(path.join(root, dir, 'build.gradle')) ||
    exists(path.join(root, dir, 'build.gradle.kts'))
  ) {
    return 'java';
  }
  const pkgFile = path.join(root, dir, 'package.json');
  const pkg = exists(pkgFile) ? readJson(pkgFile) : null;
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (
    exists(path.join(root, dir, 'pyproject.toml')) ||
    exists(path.join(root, dir, 'requirements.txt'))
  ) {
    return 'python';
  }
  if (deps.vue || deps.nuxt) return 'vue';
  if (deps.react || deps.next) return 'react';
  if (pkg) return 'node';
  return null;
}

function runtimeInfo(root, dir, stack) {
  const info = {};
  const nvmrc = path.join(root, dir, '.nvmrc');
  const pyversion = path.join(root, dir, '.python-version');
  const javaversion = path.join(root, dir, '.java-version');
  if (exists(nvmrc)) info.node = readText(nvmrc).trim();
  if (exists(pyversion)) info.python = readText(pyversion).trim();
  if (exists(javaversion)) info.java = readText(javaversion).trim();
  if (stack === 'python') {
    const req = path.join(root, dir, 'requirements.txt');
    if (exists(req)) info.pythonDeps = readText(req).split(/\r?\n/).filter(Boolean).length;
  }
  return info;
}

function javaTools(root, dir) {
  const base = path.join(root, dir);
  const project = detectJavaProject(base);
  const pom = exists(path.join(base, 'pom.xml')) ? readText(path.join(base, 'pom.xml')) : '';
  const gradle = ['build.gradle', 'build.gradle.kts']
    .filter((file) => exists(path.join(base, file)))
    .map((file) => readText(path.join(base, file)))
    .join('\n');
  const text = `${pom}\n${gradle}`;
  const ready = (pattern) => (pattern.test(text) ? 'ready' : 'missing');
  return {
    maven: project.wrapper.maven ? 'ready' : 'missing',
    spotless: ready(/spotless/),
    checkstyle: ready(/checkstyle/),
    pmd: ready(/pmd/),
    spotbugs: ready(/spotbugs/),
    jacoco: ready(/jacoco/),
  };
}

function installedTools(root, dir, stack, pkg) {
  if (stack === 'java') return javaTools(root, dir);
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const required = NODE_TOOLS[stack] || NODE_TOOLS.node;
  const tools = {};
  for (const name of required) {
    let ready = Boolean(deps[name]);
    if (!ready) {
      const bin = path.join(root, dir, 'node_modules', '.bin', name);
      ready = exists(bin) || exists(`${bin}.cmd`);
    }
    tools[name] = ready ? 'ready' : 'missing';
  }
  if (stack === 'python') {
    const pyproject = exists(path.join(root, dir, 'pyproject.toml'))
      ? readText(path.join(root, dir, 'pyproject.toml'))
      : '';
    const reqs = exists(path.join(root, dir, 'requirements.txt'))
      ? readText(path.join(root, dir, 'requirements.txt'))
      : '';
    tools.ruff = /(^|\n)\s*ruff\b|\[tool\.ruff\]/i.test(`${pyproject}\n${reqs}`)
      ? 'ready'
      : 'missing';
    tools.mypy = /(^|\n)\s*mypy\b|\[tool\.mypy\]/i.test(`${pyproject}\n${reqs}`)
      ? 'ready'
      : 'missing';
  }
  if (stack === 'vue') {
    const ts = deps.typescript || deps['vue-tsc'];
    tools['vue-tsc'] = ts ? 'ready' : 'missing';
  } else if (stack === 'react' || stack === 'node') {
    if (exists(path.join(root, dir, 'tsconfig.json'))) {
      tools.typescript = deps.typescript ? 'ready' : 'missing';
    }
  }
  return tools;
}

function planFor(workspace) {
  const plan = [];
  if (workspace.stack === 'java') {
    for (const [name, state] of Object.entries(workspace.tools)) {
      if (state !== 'missing') continue;
      plan.push(
        name === 'maven'
          ? './mvnw -N wrapper:wrapper'
          : `# add ${name} plugin to pom.xml / build.gradle`,
      );
    }
    return plan;
  }
  for (const [name, state] of Object.entries(workspace.tools)) {
    if (state !== 'missing') continue;
    if (workspace.stack === 'python') plan.push(`pip install ${name}`);
    else plan.push(`npm install -D ${name}`);
  }
  return plan;
}

export function scanEnv(root) {
  const workspaces = [];
  const missing = new Set();
  const plan = [];
  for (const dir of workspaceDirs(root)) {
    const stack = stackOf(root, dir);
    if (!stack) continue;
    const pkgFile = path.join(root, dir, 'package.json');
    const pkg = exists(pkgFile) ? readJson(pkgFile) : null;
    const tools = installedTools(root, dir, stack, pkg);
    const workspace = {
      path: dir,
      stack,
      runtime: runtimeInfo(root, dir, stack),
      packageManager: stack === 'python' ? 'pip' : packageManager(root),
      tools,
    };
    if (stack === 'java') {
      const project = detectJavaProject(path.join(root, dir));
      workspace.java = {
        jdk: project.jdk,
        jdkSource: project.jdkSource,
        bootVersion: project.bootVersion,
        buildTool: project.buildTool,
        gradleDsl: project.gradleDsl,
        modules: project.modules,
      };
      workspace.packageManager = project.buildTool || 'maven';
      workspace.runtime = {
        ...workspace.runtime,
        jdk: project.jdk,
        bootVersion: project.bootVersion,
      };
    }
    workspace.plan = planFor(workspace);
    for (const [name, state] of Object.entries(tools)) if (state === 'missing') missing.add(name);
    plan.push(...workspace.plan);
    workspaces.push(workspace);
  }
  const result = {
    schemaVersion: 1,
    workspaces,
    missing: [...missing].sort(),
    plan: [...new Set(plan)],
    unsupported: [],
  };
  return result;
}

export function writeEnvReport(root, env) {
  const jsonFile = path.join(root, '.specgate', 'env.json');
  const mdFile = path.join(root, '.specgate', 'env-report.md');
  writeText(jsonFile, `${JSON.stringify(env, null, 2)}\n`);
  const lines = ['# 环境扫描报告', ''];
  for (const workspace of env.workspaces) {
    lines.push(`## ${workspace.path === '.' ? 'root' : workspace.path}`);
    lines.push(`- stack: ${workspace.stack}`);
    lines.push(`- packageManager: ${workspace.packageManager || 'unknown'}`);
    lines.push(`- runtime: ${JSON.stringify(workspace.runtime)}`);
    if (workspace.java) lines.push(`- java: ${JSON.stringify(workspace.java)}`);
    lines.push('- tools:');
    for (const [name, state] of Object.entries(workspace.tools))
      lines.push(`  - ${name}: ${state}`);
    if (workspace.plan.length) lines.push(`- plan: ${workspace.plan.join('; ')}`);
    lines.push('');
  }
  lines.push(`缺失：${env.missing.join(', ') || '无'}`);
  lines.push(`待安装：${env.plan.join('; ') || '无'}`);
  writeText(mdFile, `${lines.join('\n')}\n`);
  return { jsonFile, mdFile };
}

export function renderEnvLine(env) {
  if (!env || !Array.isArray(env.workspaces) || env.workspaces.length === 0) {
    return '环境：未扫描';
  }
  const stacks = [...new Set(env.workspaces.map((item) => item.stack))].join('/');
  return `环境：${stacks}｜workspace ${env.workspaces.length}｜缺失 ${env.missing.length}｜待安装 ${env.plan.length}`;
}
