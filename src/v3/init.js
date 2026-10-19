import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initProject, createChange, configPath, readConfig } from './change.js';
import { load, patchState } from './state.js';
import { exists, readText, writeText, ensureDir } from './util/fsx.js';
import { digest } from './util/hash.js';
import { scanEnv, writeEnvReport } from './env-scan.js';
import { detectJavaProject, validateJavaSelection } from './java-detect.js';
import { patchConfigRequirements } from './change.js';
import {
  renderMarkdownReport,
  renderScanSummary,
  reverseRequirements,
  scanProject,
} from './reverse.js';
import { isGitRepo } from './util/git.js';
import {
  MAX_CONFIRM_ROUNDS,
  askInitConfirmation,
  collectRequirements,
  normalizeRequirements,
  renderInitConfirmation,
  renderRequirementsSummary,
  writeRequirementsBaseline,
} from './requirements.js';

export const TECH_KEYS = ['stack', 'buildTool', 'jdk', 'bootVersion', 'modules'];
export const OTHER_KEYS = ['background', 'team', 'steps'];

export const CONTEXT_FIELDS = [
  {
    key: 'background',
    label: '项目背景与 MVP 需求',
    required: true,
    default: '一个最小可运行的全栈应用',
    question: '这个项目解决什么问题？MVP 必须包含什么？',
  },
  {
    key: 'stack',
    label: '技术栈',
    required: true,
    default: 'node',
    options: ['node', 'python', 'vue', 'react', 'monorepo', 'generic', 'java'],
    question: '选择技术栈：node / python / vue / react / monorepo / generic / java',
  },
  {
    key: 'buildTool',
    label: '构建工具',
    required: true,
    default: 'maven',
    options: ['maven', 'gradle'],
    when: (context) => context.stack === 'java',
    question: '选择构建工具：maven / gradle',
  },
  {
    key: 'jdk',
    label: 'JDK 版本',
    required: true,
    default: '8',
    options: ['8', '11', '17', '21'],
    when: (context) => context.stack === 'java',
    question: '选择 JDK LTS：8 / 11 / 17 / 21',
  },
  {
    key: 'bootVersion',
    label: 'Spring Boot 版本',
    required: true,
    default: '2.7.x',
    optionsFor: (context) => {
      if (context.jdk === '21') return ['3.x'];
      if (context.jdk === '17') return ['2.7.x', '3.x'];
      return ['2.7.x'];
    },
    when: (context) => context.stack === 'java',
    question: '选择 Spring Boot：2.7.x / 3.x（JDK8/11 只支持 2.7.x，JDK21 只支持 3.x）',
  },
  {
    key: 'modules',
    label: 'Java 模块',
    required: true,
    default: 'minimal',
    options: ['minimal', 'minimal+jpa'],
    when: (context) => context.stack === 'java',
    question: '选择模块：minimal（Web+Validation+Actuator+Test）或 minimal+jpa',
  },
  {
    key: 'team',
    label: '团队背景与规范',
    required: true,
    default: '1-3 人小团队，代码评审 + 自动化测试',
    question: '团队角色、协作与评审约定是什么？',
  },
  {
    key: 'steps',
    label: '实施步骤',
    required: true,
    default: '1) 跑通 health 2) 补版本接口 3) 接前端页面',
    question: '第一版按什么顺序推进？',
  },
];

export function detectInitMode(root) {
  if (exists(path.join(root, '.specgate', 'state.json'))) return 'existing';
  let entries = [];
  try {
    entries = fs.readdirSync(root).filter((name) => name !== '.git');
  } catch {
    return 'new';
  }
  if (entries.length === 0) return 'new';
  const markers = [
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'mvnw',
    'gradlew',
    '.java-version',
    'src',
    'app',
    'apps',
    'index.js',
    'index.ts',
    'manage.py',
  ];
  if (markers.some((name) => exists(path.join(root, name)))) return 'existing';
  if (entries.some((name) => /\.(js|ts|jsx|tsx|vue|py|go|rs|java)$/.test(name))) return 'existing';
  return 'new';
}

function answerOf(answer, index = 0) {
  const item = answer?.answers?.[index];
  if (Array.isArray(item?.selected)) return item.selected[0];
  return item?.selected;
}

export async function collectContext({
  userQuestions,
  agent,
  signal,
  initial = {},
  skip = [],
  only = null,
}) {
  const context = { ...initial };
  for (const field of CONTEXT_FIELDS) {
    if (skip.includes(field.key)) continue;
    if (only && !only.includes(field.key)) continue;
    if (context[field.key] && !only) continue;
    if (field.when && !field.when(context)) continue;
    const values = field.optionsFor ? field.optionsFor(context) : field.options;
    const options = values
      ? values.map((value) => ({
          label: value,
          description: value === field.default ? '推荐默认' : '',
        }))
      : [
          { label: field.default, description: '使用推荐默认' },
          { label: '跳过', description: '留空，后续再补' },
        ];
    let answer;
    try {
      answer = await userQuestions.ask({
        questions: [
          {
            id: `sg-init-${field.key}`,
            header: field.label,
            question: field.question,
            options,
          },
        ],
        agent,
        signal,
      });
    } catch {
      context[field.key] = field.default;
      continue;
    }
    const selected = answerOf(answer);
    const previous = context[field.key];
    context[field.key] =
      selected && selected !== '跳过'
        ? selected
        : previous !== undefined
          ? previous
          : field.default;
  }
  return context;
}

export function renderContextSummary(context) {
  const java =
    context.stack === 'java'
      ? [
          `- JDK：${context.jdk}`,
          `- Spring Boot：${context.bootVersion}`,
          `- Java 模块：${context.modules}`,
        ]
      : [];
  return [
    '# H0 技术栈与项目上下文',
    '',
    `- 项目背景与目标：${context.background}`,
    `- 技术栈：${context.stack}`,
    ...java,
    `- 团队与规范：${context.team}`,
    `- 实施步骤：${context.steps}`,
  ].join('\n');
}

/**
 * REQ-006: the requirements draft and the tech stack share one confirmation
 * point. Picking a section re-asks only that section, then re-renders the page.
 */
export async function confirmInit({ userQuestions, agent, signal, requirements, context }) {
  let reqs = normalizeRequirements(requirements);
  let ctx = { ...context };
  for (let round = 0; round < MAX_CONFIRM_ROUNDS; round += 1) {
    const page = renderInitConfirmation({
      requirementsBlock: renderRequirementsSummary(reqs),
      contextBlock: renderContextSummary(ctx),
    });
    const answer = await askInitConfirmation({ userQuestions, agent, signal, question: page });
    if (!answer.ok) {
      if (round === 0) {
        return {
          ok: true,
          autoConfirmed: true,
          reason: answer.code,
          requirements: reqs,
          context: ctx,
        };
      }
      return { ok: false, message: `确认问题不可用：${answer.message}` };
    }
    if (answer.action === '确认') return { ok: true, requirements: reqs, context: ctx };
    if (answer.action === '修改需求') {
      reqs = await collectRequirements({ userQuestions, agent, signal, initial: reqs });
    } else if (answer.action === '修改技术栈') {
      ctx = await collectContext({ userQuestions, agent, signal, initial: ctx, only: TECH_KEYS });
    } else if (answer.action === '修改其他确认点') {
      ctx = await collectContext({ userQuestions, agent, signal, initial: ctx, only: OTHER_KEYS });
    } else {
      return { ok: true, requirements: reqs, context: ctx };
    }
  }
  return { ok: false, message: '初始化确认次数超过上限' };
}

/** Backwards-compatible single-section confirmation over the tech stack only. */
export async function confirmContext({ userQuestions, agent, signal, context }) {
  const result = await confirmInit({
    userQuestions,
    agent,
    signal,
    requirements: normalizeRequirements({}),
    context,
  });
  if (!result.ok) return result;
  return { ok: true, context: result.context };
}

function nodeScaffold() {
  return {
    'package.json': `${JSON.stringify(
      {
        name: 'sg-mvp',
        private: true,
        type: 'module',
        scripts: { start: 'node index.js', 'test:json': 'node sg-test.mjs' },
      },
      null,
      2,
    )}\n`,
    'index.js': `import http from 'node:http';
import { pathToFileURL } from 'node:url';

export function createApp() {
  return http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(3000, () => console.log('listening on 3000'));
}
`,
    'sg-test.mjs': `import fs from 'node:fs';
import { createApp } from './index.js';

const server = createApp().listen(0);
const port = server.address().port;
const response = await fetch(\`http://127.0.0.1:\${port}/health\`);
const body = await response.json();
server.close();
fs.writeFileSync(
  process.env.SG_REPORT || 'sg-report.json',
  JSON.stringify({
    schemaVersion: 1,
    cases: [
      {
        id: 'TC-001',
        ac: ['AC-001'],
        status: response.status === 200 && body.status === 'ok' ? 'pass' : 'fail',
        file: 'index.js',
      },
    ],
  }, null, 2),
);
process.exit(response.status === 200 && body.status === 'ok' ? 0 : 1);
`,
    '.nvmrc': '22\n',
  };
}

function pythonScaffold() {
  return {
    'requirements.txt': 'pytest\n',
    '.python-version': '3.12\n',
    'app.py': `import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
            return
        self.send_response(404)
        self.end_headers()


def serve(port=8000):
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
`,
    'tests/test_health.py': `import json
import threading
import urllib.request
from http.server import HTTPServer

from app import Handler


def test_health():
    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health") as response:
            assert response.status == 200
            assert json.loads(response.read())["status"] == "ok"
    finally:
        server.shutdown()
`,
  };
}

function genericScaffold() {
  return {
    'README.md': '# MVP\n\n由 SpecGate 初始化生成。\n',
    'docs/glossary.md': '# 术语表\n\n| 术语 | 定义 |\n|---|---|\n',
  };
}

const UNIT_ADAPTER = `import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const out = path.join(os.tmpdir(), \`sg-vitest-\${process.pid}.json\`);
const run = spawnSync(process.execPath, [
  path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
  'run', '--reporter=json', \`--outputFile=\${out}\`,
], { encoding: 'utf8', cwd: root });
const cases = [];
let failed = run.status !== 0;
if (fs.existsSync(out)) {
  const raw = JSON.parse(fs.readFileSync(out, 'utf8'));
  for (const result of raw.testResults || []) {
    const file = path.relative(root, result.name).replace(/\\\\/g, '/');
    for (const assertion of result.assertionResults || []) {
      const status = assertion.status === 'passed' ? 'pass' : assertion.status === 'failed' ? 'fail' : 'skip';
      if (status === 'fail') failed = true;
      const title = assertion.fullName || assertion.title || '';
      cases.push({
        id: \`TC-\${String(cases.length + 1).padStart(3, '0')}\`,
        ac: [...String(title).matchAll(/\\[(AC-\\d{3,})\\]/g)].map((m) => m[1]),
        status,
        file,
      });
    }
  }
}
fs.writeFileSync(process.env.SG_REPORT, JSON.stringify({ schemaVersion: 1, cases }, null, 2));
process.exit(failed ? 1 : 0);
`;

const E2E_ADAPTER = `import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const run = spawnSync(process.execPath, [
  path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
  'test', '--project=chromium', '--reporter=json',
], { encoding: 'utf8', cwd: root, maxBuffer: 32 * 1024 * 1024 });
let raw = { suites: [] };
try { raw = JSON.parse(run.stdout); } catch { /* keep empty */ }
const cases = [];
let failed = run.status !== 0;

function walk(suites) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      const results = (spec.tests || []).flatMap((item) => item.results || []);
      const skipped = results.length > 0 && results.every((item) => item.status === 'skipped');
      const passed = results.some((item) => item.status === 'passed');
      const status = skipped ? 'skip' : passed ? 'pass' : 'fail';
      if (status === 'fail') failed = true;
      cases.push({
        id: \`TC-\${String(cases.length + 1).padStart(3, '0')}\`,
        ac: [...String(spec.title || '').matchAll(/\\[(AC-\\d{3,})\\]/g)].map((m) => m[1]),
        status,
        file: spec.file || suite.file || '',
      });
    }
    walk(suite.suites);
  }
}
walk(raw.suites);
fs.writeFileSync(process.env.SG_REPORT, JSON.stringify({ schemaVersion: 1, cases }, null, 2));
process.exit(failed ? 1 : 0);
`;

function prefixFiles(files, prefix) {
  return Object.fromEntries(
    Object.entries(files).map(([key, value]) => [`${prefix}${key}`, value]),
  );
}

function vueScaffold(prefix = '') {
  return prefixFiles(
    {
      'package.json': `${JSON.stringify(
        {
          name: 'sg-web',
          private: true,
          type: 'module',
          scripts: {
            dev: 'vite --port 5173',
            build: 'vite build',
            'test:unit': 'vitest run',
            'test:e2e': 'playwright test',
          },
          dependencies: { vue: '^3.5.0' },
          devDependencies: {
            '@playwright/test': '^1.50.0',
            '@vitejs/plugin-vue': '^5.2.0',
            jsdom: '^25.0.0',
            vite: '^6.0.0',
            vitest: '^3.0.0',
          },
        },
        null,
        2,
      )}\n`,
      'index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>\n',
      'vite.config.js': `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], server: { port: 4173, host: '127.0.0.1' } });
`,
      'src/main.js': `import { createApp } from 'vue';
import App from './App.vue';
createApp(App).mount('#app');
`,
      'src/App.vue': `<template>
  <main>
    <h1 data-test="app-title">MVP</h1>
  </main>
</template>
`,
      'src/smoke.test.js': `import { expect, test } from 'vitest';
test('smoke', () => { expect(1).toBe(1); });
`,
      'e2e/home.spec.ts': `import { expect, test } from '@playwright/test';
test('home title [AC-001]', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-title')).toHaveText('MVP');
});
`,
      'playwright.config.ts': `import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:4173', testIdAttribute: 'data-test' },
  webServer: { command: 'npm run dev -- --port 4173 --host 127.0.0.1', url: 'http://127.0.0.1:4173', reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`,
      'sg-test-unit.mjs': UNIT_ADAPTER,
      'sg-test-e2e.mjs': E2E_ADAPTER,
    },
    prefix,
  );
}

function reactScaffold(prefix = '') {
  const files = vueScaffold(prefix);
  delete files[`${prefix}src/App.vue`];
  files[`${prefix}src/App.jsx`] = `export default function App() {
  return <main><h1 data-test="app-title">MVP</h1></main>;
}
`;
  files[`${prefix}src/main.jsx`] =
    "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('app')).render(<App />);\n";
  files[`${prefix}index.html`] =
    '<div id="app"></div><script type="module" src="/src/main.jsx"></script>\n';
  const pkg = JSON.parse(files[`${prefix}package.json`]);
  pkg.dependencies = { react: '^19.0.0', 'react-dom': '^19.0.0' };
  pkg.devDependencies['@vitejs/plugin-react'] = '^4.3.0';
  files[`${prefix}package.json`] = `${JSON.stringify(pkg, null, 2)}\n`;
  files[`${prefix}vite.config.js`] = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: 4173, host: '127.0.0.1' } });
`;
  return files;
}

function monorepoScaffold() {
  const api = prefixFiles(nodeScaffold(), 'apps/api/');
  const web = vueScaffold('apps/web/');
  const rootPkg = {
    name: 'sg-monorepo',
    private: true,
    workspaces: ['apps/*'],
    scripts: { 'test:e2e': 'npm --workspace apps/web run test:e2e' },
  };
  return {
    ...api,
    ...web,
    'package.json': `${JSON.stringify(rootPkg, null, 2)}\n`,
    'README.md': '# MVP Monorepo\n\napps/api + apps/web。\n',
  };
}

function genericStackScaffold() {
  return {
    ...genericScaffold(),
    VERSION: '0.1.0\n',
    'check.mjs': `import fs from 'node:fs';
const version = fs.readFileSync('VERSION', 'utf8').trim();
const ok = /^\\d+\\.\\d+\\.\\d+$/.test(version);
fs.writeFileSync(
  process.env.SG_REPORT || 'sg-report.json',
  JSON.stringify({
    schemaVersion: 1,
    cases: [{ id: 'TC-001', ac: ['AC-001'], status: ok ? 'pass' : 'fail', file: 'VERSION' }],
  }, null, 2),
);
process.exit(ok ? 0 : 1);
`,
  };
}

function genericChangeFiles() {
  return {
    'openspec/changes/add-version/proposal.md': `# 变更提案：add-version\n\n## 问题\n通用骨架只有占位版本 0.1.0。\n\n## 目标\nVERSION 固定为 1.0.0，并由 check.mjs 校验。\n\n## 非目标\n不绑定技术栈。\n\n## 影响面\nVERSION / check.mjs\n- 关联需求：REQ-001\n`,
    'openspec/changes/add-version/specs/ops/spec.md': `## ADDED Requirements\n\n### Requirement: 版本文件 (REQ-001)\n\n#### Scenario: 版本为 1.0.0 (AC-001)\n\n- **When** 运行 check.mjs\n- **Then** VERSION 为 1.0.0\n`,
    'openspec/changes/add-version/design.md': `# 方案：add-version\n\n## 目标与非目标\n更新 VERSION 与校验脚本。\n\n## 任务图\nT-001。\n\n## AC 到用例\nAC-001 由 check.mjs 覆盖。\n\n## 风险\n无。\n`,
    'openspec/changes/add-version/tasks.md': `# 任务：add-version\n\n## T-001 版本文件\n<!-- sg:task {"id":"T-001","title":"版本文件","ac":["AC-001"],"deps":[],"parallel":false} -->\n- [ ] VERSION 改为 1.0.0\n- [ ] check.mjs 校验 1.0.0\n`,
    'openspec/changes/add-version/tests/cases.md': `# 测试用例\n\n| 用例 | AC | 层次 | 描述 |\n|---|---|---|---|\n| TC-001 | AC-001 | unit | VERSION=1.0.0 |\n`,
    'openspec/changes/add-version/tests/mapping.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        change: 'add-version',
        requirements: [
          { ac: 'AC-001', covers: ['REQ-001'], tasks: ['T-001'], cases: ['TC-001'], suite: 'api' },
        ],
        automation: [],
      },
      null,
      2,
    )}\n`,
    'openspec/changes/add-version/tests/touched.json': `${JSON.stringify(
      { schemaVersion: 1, modify: ['VERSION', 'check.mjs'], delete: [], bootstrap: [] },
      null,
      2,
    )}\n`,
  };
}

const JAVA_BOOT_VERSIONS = { '2.7.x': '2.7.18', '3.x': '3.5.16' };

function javaPackage(context) {
  return String(context.packageName || 'com.example.demo');
}

function javaPathOf(context) {
  return javaPackage(context).replace(/\./g, '/');
}

function javaWrapper() {
  return {
    mvnw: `#!/bin/sh
# Minimal Maven wrapper. Prefer a full Maven Wrapper distribution in CI.
if command -v mvn >/dev/null 2>&1; then
  exec mvn "$@"
fi
echo "Maven not found. Install Maven or add the full Maven Wrapper." >&2
exit 1
`,
    'mvnw.cmd': `@echo off
where mvn >nul 2>nul
if %ERRORLEVEL%==0 (
  mvn %*
  exit /b %ERRORLEVEL%
)
echo Maven not found. Install Maven or add the full Maven Wrapper.
exit /b 1
`,
    '.mvn/wrapper/maven-wrapper.properties':
      'distributionUrl=https\\://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip\n',
  };
}

function javaGradleFiles(context) {
  const bootVersion = JAVA_BOOT_VERSIONS[String(context.bootVersion || '2.7.x')] || '2.7.18';
  const boot3 = String(context.bootVersion || '').startsWith('3');
  const jdk = String(context.jdk || '8');
  const source = jdk === '8' ? '1.8' : jdk;
  const dependencyManagement = boot3 ? '1.1.6' : '1.0.15.RELEASE';
  const build = `plugins {
    id 'java'
    id 'org.springframework.boot' version '${bootVersion}'
    id 'io.spring.dependency-management' version '${dependencyManagement}'
    id 'com.diffplug.spotless' version '6.25.0'
    id 'checkstyle'
    id 'com.github.spotbugs' version '6.0.9'
}

group = 'com.example'
version = '0.0.1-SNAPSHOT'

java {
    sourceCompatibility = JavaVersion.VERSION_${source.replace('.', '_')}
    targetCompatibility = JavaVersion.VERSION_${source.replace('.', '_')}
}

repositories {
    mavenCentral()
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.boot:spring-boot-starter-validation'
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}

tasks.named('test') {
    useJUnitPlatform()
}

spotless {
    java {
        googleJavaFormat('1.22.0')
    }
}

checkstyle {
    toolVersion = '10.12.4'
}

spotbugs {
    effort = 'max'
    reportLevel = 'low'
}
`;
  return {
    'build.gradle': build,
    'settings.gradle': "rootProject.name = 'demo'\n",
    gradlew: `#!/bin/sh
# Minimal Gradle wrapper. Prefer a full Gradle Wrapper distribution in CI.
if command -v gradle >/dev/null 2>&1; then
  exec gradle "$@"
fi
echo "Gradle not found. Install Gradle 8.x or add the full Gradle Wrapper." >&2
exit 1
`,
    'gradlew.bat': `@echo off
where gradle >nul 2>nul
if %ERRORLEVEL%==0 (
  gradle %*
  exit /b %ERRORLEVEL%
)
echo Gradle not found. Install Gradle 8.x or add the full Gradle Wrapper.
exit /b 1
`,
    'gradle/wrapper/gradle-wrapper.properties':
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14-bin.zip\n',
    'config/checkstyle/checkstyle.xml': `<?xml version="1.0"?>
<!DOCTYPE module PUBLIC "-//Checkstyle//DTD Checkstyle Configuration 1.3//EN" "https://checkstyle.org/dtds/configuration_1_3.dtd">
<module name="Checker">
  <module name="TreeWalker">
    <module name="AvoidStarImport"/>
    <module name="UnusedImports"/>
    <module name="NeedBraces"/>
  </module>
</module>
`,
    'config/checkstyle/suppressions.xml': `<?xml version="1.0"?>
<!DOCTYPE suppressions PUBLIC "-//Checkstyle//DTD SuppressionFilter Configuration 1.2//EN" "https://checkstyle.org/dtds/suppressions_1_2.dtd">
<suppressions/>
`,
  };
}

function javaPom(context) {
  const jdk = String(context.jdk || '8');
  const bootVersion = JAVA_BOOT_VERSIONS[String(context.bootVersion || '2.7.x')] || '2.7.18';
  const withJpa = context.modules === 'minimal+jpa';
  const javaVersion = jdk === '17' ? '17' : jdk;
  const modern = jdk === '17' || jdk === '21';
  const spotlessVersion = modern ? '3.10.4' : '2.32.0';
  const gjfVersion = modern ? '1.28.0' : '1.7';
  const checkstyleVersion = modern ? '12.3.1' : '9.3';
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>${bootVersion}</version>
    <relativePath/>
  </parent>
  <groupId>com.example</groupId>
  <artifactId>demo</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <name>demo</name>
  <description>SpecGate Java MVP</description>
  <properties>
    <java.version>${javaVersion}</java.version>
    <google-java-format.version>${gjfVersion}</google-java-format.version>
    <checkstyle.version>${checkstyleVersion}</checkstyle.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>${
      withJpa
        ? `
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-data-jpa</artifactId>
    </dependency>
    <dependency>
      <groupId>com.h2database</groupId>
      <artifactId>h2</artifactId>
      <scope>runtime</scope>
    </dependency>`
        : ''
    }
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
      <plugin>
        <groupId>com.diffplug.spotless</groupId>
        <artifactId>spotless-maven-plugin</artifactId>
        <version>${spotlessVersion}</version>
        <configuration>
          <java>
            <googleJavaFormat>
              <version>\${google-java-format.version}</version>
            </googleJavaFormat>
          </java>
        </configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-checkstyle-plugin</artifactId>
        <version>3.3.1</version>
        <configuration>
          <configLocation>google_checks.xml</configLocation>
          <consoleOutput>true</consoleOutput>
          <failOnViolation>true</failOnViolation>
        </configuration>
        <dependencies>
          <dependency>
            <groupId>com.puppycrawl.tools</groupId>
            <artifactId>checkstyle</artifactId>
            <version>\${checkstyle.version}</version>
          </dependency>
        </dependencies>
      </plugin>
      <plugin>
        <groupId>org.jacoco</groupId>
        <artifactId>jacoco-maven-plugin</artifactId>
        <version>0.8.15</version>
        <executions>
          <execution>
            <goals>
              <goal>prepare-agent</goal>
            </goals>
          </execution>
          <execution>
            <id>report</id>
            <phase>verify</phase>
            <goals>
              <goal>report</goal>
            </goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

function javaScaffold(context) {
  const pkg = javaPackage(context);
  const pkgPath = javaPathOf(context);
  const appClass = 'DemoApplication';
  const buildTool = context.buildTool === 'gradle' ? 'gradle' : 'maven';
  const buildFiles =
    buildTool === 'gradle'
      ? javaGradleFiles(context)
      : { ...javaWrapper(), 'pom.xml': javaPom(context) };
  return {
    ...buildFiles,
    '.java-version': `${context.jdk || '8'}\n`,
    '.gitignore': buildTool === 'gradle' ? 'build/\n.gradle/\n' : 'target/\n',
    'src/main/resources/application.yml': 'server:\n  port: 8080\n',
    [`src/main/java/${pkgPath}/${appClass}.java`]: `package ${pkg};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ${appClass} {

    public static void main(String[] args) {
        SpringApplication.run(${appClass}.class, args);
    }
}
`,
    [`src/main/java/${pkgPath}/HealthController.java`]: `package ${pkg};

import java.util.Collections;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    @GetMapping("/health")
    public Map<String, String> health() {
        return Collections.singletonMap("status", "ok");
    }
}
`,
    [`src/test/java/${pkgPath}/HealthControllerTest.java`]: `package ${pkg};

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class HealthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("[AC-001] health returns ok")
    void healthReturnsOk_AC_001() throws Exception {
        mockMvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"));
    }
}
`,
  };
}

export function scaffoldFiles(stack, context = {}) {
  if (stack === 'java') return javaScaffold(context);
  if (stack === 'python') return pythonScaffold();
  if (stack === 'vue') return { ...genericScaffold(), ...vueScaffold() };
  if (stack === 'react') return { ...genericScaffold(), ...reactScaffold() };
  if (stack === 'monorepo') return { ...genericScaffold(), ...monorepoScaffold() };
  if (stack === 'generic') return { ...genericStackScaffold() };
  return { ...genericScaffold(), ...nodeScaffold() };
}

export function writeScaffold(root, files) {
  const written = [];
  const skipped = [];
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    if (exists(target)) {
      skipped.push(relative);
      continue;
    }
    ensureDir(path.dirname(target));
    writeText(target, content);
    if (relative === 'mvnw' || relative === 'gradlew') {
      try {
        fs.chmodSync(target, 0o755);
      } catch {
        // Windows has no POSIX mode bits.
      }
    }
    written.push(relative);
  }
  return { written, skipped };
}

export function writeArtifacts(root, context) {
  const files = {
    'project-context.md': `# 项目上下文\n\n## 背景与 MVP\n${context.background}\n\n## 技术栈\n${context.stack}\n\n## 需求基线\n见 openspec/REQ.md（唯一需求来源，AC 全部声明 covers）。\n\n## 团队与规范\n${context.team}\n\n## 实施步骤\n${context.steps}\n`,
    'AGENTS.md': `# AGENTS.md\n\n## 团队与规范\n${context.team}\n\n## 命令\n- 运行测试：/sg-run\n- 查看状态：/sg-status\n`,
    'docs/glossary.md': `# 术语表\n\n| 术语 | 定义 |\n|---|---|\n| MVP | ${context.background} |\n`,
    'docs/adr/0001-initial.md': `# ADR-0001 初始化\n\n## 决策\n采用 ${context.stack} 作为 MVP 技术栈。\n`,
    '.github/workflows/ci.yml': `name: ci\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo "configure test command"\n`,
  };
  return writeScaffold(root, files);
}

export function gitInitCommit(root, message = 'chore: 初始化 MVP 脚手架', options = {}) {
  const run = (args) =>
    spawnSync('git', ['-c', 'user.name=SpecGate', '-c', 'user.email=specgate@local', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  const hadRepo = exists(path.join(root, '.git'));
  const initialized = !hadRepo;
  if (!hadRepo) run(['init', '-q']);
  // Legacy onboarding only guarantees a repository; it must not commit the
  // existing working tree (REQ-010: skip scaffolding, git init only). It may
  // commit exactly the paths SpecGate itself generated, never anything else.
  if (options.gitOnly) {
    const paths = (Array.isArray(options.commitPaths) ? options.commitPaths : []).filter(
      (relative) => exists(path.join(root, relative)),
    );
    if (!paths.length) return { ok: true, initialized, hadRepo, committed: false };
    const pending = run(['status', '--porcelain', '--', ...paths]);
    if (!pending.stdout.trim()) return { ok: true, initialized, hadRepo, committed: false };
    for (const relative of paths) run(['add', '--', relative]);
    const committed = run(['commit', '-q', '-m', message, '--', ...paths]);
    return {
      ok: committed.status === 0,
      stderr: committed.stderr,
      initialized,
      hadRepo,
      committed: committed.status === 0,
    };
  }
  run(['add', '-A']);
  const committed = run(['commit', '-q', '-m', message]);
  return {
    ok: committed.status === 0,
    stderr: committed.stderr,
    initialized,
    hadRepo,
    committed: committed.status === 0,
  };
}

function firstChangeFiles(context) {
  return {
    'openspec/changes/add-version/proposal.md': `# 变更提案：add-version\n\n## 问题\nMVP 只有 health，没有版本标识。\n\n## 目标\n新增 GET /version 返回 {"version":"1.0.0"}。\n\n## 非目标\n不改 health。\n\n## 影响面\nindex.js / sg-test.mjs\n- 关联需求：REQ-001\n`,
    'openspec/changes/add-version/specs/ops/spec.md': `## ADDED Requirements\n\n### Requirement: 版本接口 (REQ-001)\n\n#### Scenario: 返回版本 (AC-001)\n\n- **When** GET /version\n- **Then** 200 {"version":"1.0.0"}\n`,
    'openspec/changes/add-version/design.md': `# 方案：add-version\n\n## 目标与非目标\n新增 /version。\n\n## 任务图\nT-001。\n\n## AC 到用例\nAC-001 由 sg-test.mjs 覆盖。\n\n## 风险\n无。\n`,
    'openspec/changes/add-version/tasks.md': `# 任务：add-version\n\n## T-001 版本接口\n<!-- sg:task {"id":"T-001","title":"版本接口","ac":["AC-001"],"deps":[],"parallel":false} -->\n- [ ] 实现 /version 并补测试\n`,
    'openspec/changes/add-version/tests/cases.md': `# 测试用例\n\n| 用例 | AC | 层次 | 描述 |\n|---|---|---|---|\n| TC-001 | AC-001 | integration | GET /version |\n`,
    'openspec/changes/add-version/tests/mapping.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        change: 'add-version',
        requirements: [
          {
            ac: 'AC-001',
            covers: ['REQ-001'],
            tasks: ['T-001'],
            cases: ['TC-001'],
            suite: 'default',
          },
        ],
        automation: [],
      },
      null,
      2,
    )}\n`,
    'openspec/changes/add-version/tests/touched.json': `${JSON.stringify(
      { schemaVersion: 1, modify: ['index.js', 'sg-test.mjs'], delete: [], bootstrap: [] },
      null,
      2,
    )}\n`,
  };
}

function pythonChangeFiles() {
  return {
    'openspec/changes/add-version/proposal.md': `# 变更提案：add-version\n\n## 问题\nMVP 只有 health，没有版本标识。\n\n## 目标\n新增 GET /version 返回 {"version":"1.0.0"}。\n\n## 非目标\n不改 health。\n\n## 影响面\napp.py / tests/test_health.py\n- 关联需求：REQ-001\n`,
    'openspec/changes/add-version/specs/ops/spec.md': `## ADDED Requirements\n\n### Requirement: 版本接口 (REQ-001)\n\n#### Scenario: 返回版本 (AC-001)\n\n- **When** GET /version\n- **Then** 200 {"version":"1.0.0"}\n`,
    'openspec/changes/add-version/design.md': `# 方案：add-version\n\n## 目标与非目标\n新增 /version。\n\n## 任务图\nT-001。\n\n## AC 到用例\nAC-001 由 tests/test_health.py 增补。\n\n## 风险\n无。\n`,
    'openspec/changes/add-version/tasks.md': `# 任务：add-version\n\n## T-001 版本接口\n<!-- sg:task {"id":"T-001","title":"版本接口","ac":["AC-001"],"deps":[],"parallel":false} -->\n- [ ] app.py 实现 /version\n- [ ] tests/test_health.py 增补 AC-001 用例\n`,
    'openspec/changes/add-version/tests/cases.md': `# 测试用例\n\n| 用例 | AC | 层次 | 描述 |\n|---|---|---|---|\n| TC-001 | AC-001 | integration | GET /version |\n`,
    'openspec/changes/add-version/tests/mapping.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        change: 'add-version',
        requirements: [
          { ac: 'AC-001', covers: ['REQ-001'], tasks: ['T-001'], cases: ['TC-001'], suite: 'api' },
        ],
        automation: [],
      },
      null,
      2,
    )}\n`,
    'openspec/changes/add-version/tests/touched.json': `${JSON.stringify(
      { schemaVersion: 1, modify: ['app.py', 'tests/test_health.py'], delete: [], bootstrap: [] },
      null,
      2,
    )}\n`,
  };
}

function frontendChangeFiles(stack) {
  const appFile = stack === 'react' ? 'src/App.jsx' : 'src/App.vue';
  const testFile = 'e2e/sg-version.spec.ts';
  return {
    'openspec/changes/add-version/proposal.md': `# 变更提案：add-version\n\n## 问题\n首页没有版本标识。\n\n## 目标\n首页展示 v1.0.0，并有 E2E 覆盖。\n\n## 非目标\n不改路由。\n\n## 影响面\n${appFile} / ${testFile}\n- 关联需求：REQ-001\n`,
    'openspec/changes/add-version/specs/ops/spec.md': `## ADDED Requirements\n\n### Requirement: 首页版本标识 (REQ-001)\n\n#### Scenario: 展示版本 (AC-001)\n\n- **When** 访问 /\n- **Then** [data-test="app-version"] 文本为 v1.0.0\n`,
    'openspec/changes/add-version/design.md': `# 方案：add-version\n\n## 目标与非目标\n在首页增加版本标识。\n\n## 任务图\nT-001。\n\n## AC 到用例\nAC-001 由 ${testFile} 覆盖。\n\n## 风险\n无。\n`,
    'openspec/changes/add-version/tasks.md': `# 任务：add-version\n\n## T-001 版本标识\n<!-- sg:task {"id":"T-001","title":"版本标识","ac":["AC-001"],"deps":[],"parallel":false} -->\n- [ ] ${appFile} 增加版本标识\n- [ ] 新增 ${testFile}\n`,
    'openspec/changes/add-version/tests/cases.md': `# 测试用例\n\n| 用例 | AC | 层次 | 描述 |\n|---|---|---|---|\n| TC-001 | AC-001 | e2e | 首页展示版本 |\n`,
    'openspec/changes/add-version/tests/mapping.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        change: 'add-version',
        requirements: [
          {
            ac: 'AC-001',
            covers: ['REQ-001'],
            tasks: ['T-001'],
            cases: ['TC-001'],
            suite: 'web-e2e',
          },
        ],
        automation: [],
      },
      null,
      2,
    )}\n`,
    'openspec/changes/add-version/tests/touched.json': `${JSON.stringify(
      { schemaVersion: 1, modify: [appFile], delete: [], bootstrap: [testFile] },
      null,
      2,
    )}\n`,
  };
}

function monorepoChangeFiles() {
  return {
    'openspec/changes/add-version/proposal.md': `# 变更提案：add-version\n\n## 问题\nAPI 只有 health。\n\n## 目标\n新增 /version。\n\n## 非目标\n不改 web。\n\n## 影响面\napps/api/index.js / apps/api/sg-test.mjs\n- 关联需求：REQ-001\n`,
    'openspec/changes/add-version/specs/ops/spec.md': `## ADDED Requirements\n\n### Requirement: 版本接口 (REQ-001)\n\n#### Scenario: 返回版本 (AC-001)\n\n- **When** GET /version\n- **Then** 200 {"version":"1.0.0"}\n`,
    'openspec/changes/add-version/design.md': `# 方案：add-version\n\n## 目标与非目标\n新增 /version。\n\n## 任务图\nT-001。\n\n## AC 到用例\nAC-001 由 apps/api/sg-test.mjs 覆盖。\n\n## 风险\n无。\n`,
    'openspec/changes/add-version/tasks.md': `# 任务：add-version\n\n## T-001 版本接口\n<!-- sg:task {"id":"T-001","title":"版本接口","ac":["AC-001"],"deps":[],"parallel":false} -->\n- [ ] apps/api/index.js 增加 /version\n- [ ] apps/api/sg-test.mjs 增补断言\n`,
    'openspec/changes/add-version/tests/cases.md': `# 测试用例\n\n| 用例 | AC | 层次 | 描述 |\n|---|---|---|---|\n| TC-001 | AC-001 | integration | GET /version |\n`,
    'openspec/changes/add-version/tests/mapping.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        change: 'add-version',
        requirements: [
          { ac: 'AC-001', covers: ['REQ-001'], tasks: ['T-001'], cases: ['TC-001'], suite: 'api' },
        ],
        automation: [],
      },
      null,
      2,
    )}\n`,
    'openspec/changes/add-version/tests/touched.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        modify: ['apps/api/index.js', 'apps/api/sg-test.mjs'],
        delete: [],
        bootstrap: [],
      },
      null,
      2,
    )}\n`,
  };
}

function javaChangeFiles(context) {
  const pkgPath = javaPathOf(context);
  const versionFile = `src/main/java/${pkgPath}/VersionController.java`;
  const versionTest = `src/test/java/${pkgPath}/VersionControllerTest.java`;
  return {
    'openspec/changes/add-version/proposal.md': `# 变更提案：add-version

## 问题
MVP 只有 health，没有版本标识。

## 目标
新增 GET /version 返回 {"version":"1.0.0"}。

## 非目标
不改 health。

## 影响面
${versionFile} / ${versionTest}
- 关联需求：REQ-001
`,
    'openspec/changes/add-version/specs/ops/spec.md': `## ADDED Requirements

### Requirement: 版本接口 (REQ-001)

#### Scenario: 返回版本 (AC-001)

- **WHEN** GET /version
- **THEN** 200 {"version":"1.0.0"}
`,
    'openspec/changes/add-version/design.md': `# 方案：add-version

## 目标与非目标
新增 /version。

## 任务图
T-001。

## AC 到用例
AC-001 由 ${versionTest} 覆盖。

## 风险
无。
`,
    'openspec/changes/add-version/tasks.md': `# 任务：add-version

## T-001 版本接口
<!-- sg:task {"id":"T-001","title":"版本接口","ac":["AC-001"],"deps":[],"parallel":false} -->
- [ ] 实现 /version 并补测试
`,
    'openspec/changes/add-version/tests/cases.md': `# 测试用例

| 用例 | AC | 层次 | 描述 |
|---|---|---|---|
| TC-001 | AC-001 | integration | GET /version |
`,
    'openspec/changes/add-version/tests/mapping.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        change: 'add-version',
        requirements: [
          {
            ac: 'AC-001',
            covers: ['REQ-001'],
            tasks: ['T-001'],
            cases: ['TC-001'],
            suite: 'backend',
            priority: 'P0',
          },
        ],
        automation: [],
      },
      null,
      2,
    )}\n`,
    'openspec/changes/add-version/tests/touched.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        modify: [],
        delete: [],
        bootstrap: [versionFile, versionTest],
      },
      null,
      2,
    )}\n`,
  };
}

const REQUIREMENTS_BLOCK_RE = /^requirements:\s*$/m;

function requirementsBlock(block) {
  const lines = [
    'requirements:',
    `  enabled: ${block.enabled === false ? 'false' : 'true'}`,
    `  version: ${block.version || 'v1.0'}`,
  ];
  for (const key of ['doc', 'history']) {
    if (block[key]) lines.push(`  ${key}: ${block[key]}`);
  }
  return lines.join('\n');
}

/** configureSuites 会整体重写配置；需求基线开关必须原样保留（REQ-008）。 */
export function configureSuites(root, stack, context = {}) {
  const previous = readConfig(root);
  writeSuitesConfig(root, stack, context);
  const block = previous && previous.requirements;
  if (!block || typeof block !== 'object') return;
  const current = readText(configPath(root));
  if (REQUIREMENTS_BLOCK_RE.test(current)) return;
  const prefix = current.endsWith('\n') ? current : `${current}\n`;
  writeText(configPath(root), `${prefix}${requirementsBlock(block)}\n`);
}

function writeSuitesConfig(root, stack, context = {}) {
  const common = `workflowVersion: 3\nschemaVersion: 3\nlanguage: zh\nstack: ${stack}\nmaxParallel: 2\ninstall: true\n`;
  if (stack === 'java') {
    const jdk = String(context.jdk || '8');
    const bootVersion = String(context.bootVersion || '2.7.x');
    const modules =
      context.modules === 'minimal+jpa'
        ? ['web', 'validation', 'actuator', 'test', 'data-jpa']
        : ['web', 'validation', 'actuator', 'test'];
    const buildTool = context.buildTool === 'gradle' ? 'gradle' : 'maven';
    const suite =
      buildTool === 'gradle'
        ? `  - id: backend\n    kind: gradle\n    cwd: "."\n    jdk: "${jdk}"\n    buildTool: gradle\n    goals: ["check"]\n    reportGlob: "build/test-results/test/TEST-*.xml"\n    jacocoGlob: "build/reports/jacoco/test/jacocoTestReport.xml"\n    timeoutMinutes: 30\n`
        : `  - id: backend\n    kind: maven\n    cwd: "."\n    jdk: "${jdk}"\n    buildTool: maven\n    goals: ["-B", "-ntp", "verify"]\n    reportGlob: "target/{surefire,failsafe}-reports/TEST-*.xml"\n    jacocoGlob: "target/site/jacoco/jacoco.xml"\n    timeoutMinutes: 30\n`;
    writeText(
      configPath(root),
      `${common}java:\n  jdk: ${jdk}\n  buildTool: ${buildTool}\n  bootVersion: "${bootVersion}"\n  groupId: com.example\n  artifactId: demo\n  packageName: com.example.demo\n  modules: ${JSON.stringify(modules)}\nquality:\n  profile: strict\ncoverage:\n  blocking: true\n  lines: 80\n  branches: 70\n  p0p1: 100\n  p2: 90\nsuites:\n${suite}`,
    );
    return;
  }
  if (stack === 'python') {
    writeText(
      configPath(root),
      `${common}suites:\n  - id: api\n    kind: pytest\n    cwd: "."\n    python: "3.12"\n    pytestArgs: ["-q", "tests"]\n`,
    );
    return;
  }
  if (stack === 'vue' || stack === 'react') {
    writeText(
      configPath(root),
      `${common}suites:\n  - id: web-unit\n    kind: command\n    command: ["node", "sg-test-unit.mjs"]\n    cwd: "."\n  - id: web-e2e\n    kind: command\n    command: ["node", "sg-test-e2e.mjs"]\n    cwd: "."\n`,
    );
    return;
  }
  if (stack === 'monorepo') {
    writeText(
      configPath(root),
      `${common}suites:\n  - id: api\n    kind: node-test\n    command: ["node", "sg-test.mjs"]\n    cwd: "apps/api"\n  - id: web-unit\n    kind: command\n    command: ["node", "sg-test-unit.mjs"]\n    cwd: "apps/web"\n  - id: web-e2e\n    kind: command\n    command: ["node", "sg-test-e2e.mjs"]\n    cwd: "apps/web"\n`,
    );
    return;
  }
  if (stack === 'generic') {
    writeText(
      configPath(root),
      `${common}suites:\n  - id: api\n    kind: node-test\n    command: ["node", "check.mjs"]\n    cwd: "."\n`,
    );
    return;
  }
  writeText(
    configPath(root),
    `${common}suites:\n  - id: api\n    kind: node-test\n    command: ["node", "sg-test.mjs"]\n    cwd: "."\n`,
  );
}

export function onboardExistingJava(root) {
  const project = detectJavaProject(root);
  if (!project.ok) return null;
  const config = readConfig(root) || {};
  const hasSuites = Array.isArray(config.suites) && config.suites.length > 0;
  const jdk = String(project.jdk || '8');
  const bootVersion = String(project.bootVersion || '').startsWith('3') ? '3.x' : '2.7.x';
  if (!hasSuites) configureSuites(root, 'java', { jdk, bootVersion, modules: 'minimal' });
  const env = scanEnv(root);
  const envFiles = writeEnvReport(root, env);
  const onboarding = path.join(root, 'docs', 'java-onboarding.md');
  const lines = [
    '# Java 接入报告',
    '',
    `- 构建工具：${project.buildTool || 'unknown'}`,
    `- Gradle DSL：${project.gradleDsl || '-'}`,
    `- JDK：${project.jdk || 'unknown'}（来源：${project.jdkSource || 'unknown'}）`,
    `- Spring Boot：${project.bootVersion || 'unknown'}`,
    `- Maven Wrapper：${project.wrapper.maven ? 'ready' : 'missing'}`,
    `- Gradle Wrapper：${project.wrapper.gradle ? 'ready' : 'missing'}`,
    `- 模块：${project.modules.length ? project.modules.join(', ') : '(single)'}`,
    '',
    '## 接入说明',
    '',
    '- 未修改 `pom.xml` / `build.gradle`。',
    '- 已生成/更新 `.specgate/config.yaml`、`.specgate/env.json`、`.specgate/env-report.md`。',
    '- Spotless/Checkstyle/PMD/SpotBugs/JaCoCo 缺失时使用外部 CLI 或标记降级，补丁建议见下。',
    '',
    '## 补丁建议',
    '',
  ];
  for (const [name, state] of Object.entries(env.workspaces?.[0]?.tools || {})) {
    if (state === 'missing') lines.push(`- 添加 ${name} 插件/工具到构建文件或环境。`);
  }
  ensureDir(path.dirname(onboarding));
  writeText(onboarding, `${lines.join('\n')}\n`);
  return {
    ok: true,
    project,
    configWritten: !hasSuites,
    envFiles,
    onboarding,
    env,
  };
}

/**
 * REQ-001/REQ-002/REQ-006: requirements questions run first, then the tech
 * stack, and both are approved through a single confirmation page. REQ-003:
 * nothing is written to disk before that confirmation.
 */
/**
 * 老项目接入：完整只读扫描 → 反推四维需求 → 用户确认 → 生成 REQ.md。
 * 不生成脚手架；仓库不存在时才 git init（已存在则跳过）。
 */
/** 老项目接入第一阶段（H0 之前）由 SpecGate 自己生成的资产路径。 */
const LEGACY_SCAN_PATHS = [
  '.gitignore',
  'openspec/specs/.gitkeep',
  'openspec/changes/.gitkeep',
  '.specgate/config.yaml',
  '.specgate/requirements-scan.json',
  'docs/requirements-scan.md',
];

export async function startLegacyInitProject({ root, userQuestions, agent, signal }) {
  if (!userQuestions || typeof userQuestions.ask !== 'function') {
    return {
      ok: false,
      code: 'QUESTIONS_UNAVAILABLE',
      message: '当前环境没有用户问答服务，无法确认反推需求；请使用交互式会话执行 /sg-init',
    };
  }
  const scan = scanProject(root);
  const proposed = reverseRequirements(scan);
  const requirements = await collectRequirements({
    userQuestions,
    agent,
    signal,
    initial: proposed,
  });
  const context = {
    stack: scan.stacks[0]?.stack || 'generic',
    background: '既有项目接入（未生成脚手架）',
  };
  const confirmed = await confirmInit({ userQuestions, agent, signal, requirements, context });
  if (!confirmed.ok) return confirmed;
  const finalRequirements = confirmed.requirements;
  const finalContext = confirmed.context;

  const init = initProject(root);
  if (!init.ok) return init;

  const hadRepo = isGitRepo(root);
  if (!hadRepo) {
    const initialized = gitInitCommit(root, 'chore: 接入 SpecGate 需求基线', { gitOnly: true });
    if (!initialized.ok) return { ok: false, message: `git init 失败：${initialized.stderr}` };
  }

  ensureDir(path.join(root, 'docs'));
  const reportFile = path.join(root, 'docs', 'requirements-scan.md');
  writeText(reportFile, renderMarkdownReport(scan, finalRequirements) + '\n');
  const scanFile = path.join(root, '.specgate', 'requirements-scan.json');
  writeText(scanFile, JSON.stringify(scan, null, 2) + '\n');
  // 扫描报告属于本项目自己生成的资产，随接入一并入库，避免留下未跟踪文件（REQ-010）。
  const scanCommit = gitInitCommit(root, 'chore: 扫描既有项目并反推需求', {
    gitOnly: true,
    commitPaths: LEGACY_SCAN_PATHS,
  });
  if (!scanCommit.ok) return { ok: false, message: `git 提交失败：${scanCommit.stderr}` };

  const hash = digest(JSON.stringify({ context: finalContext, requirements: finalRequirements }));
  patchState(root, (draft) => {
    draft.phase = 'H0_PENDING';
    draft.change = null;
    draft.mode = 'existing';
    draft.context = { ...finalContext, requirements: finalRequirements };
    draft.requirements = finalRequirements;
    draft.requirementsVersion = 'v1.0';
    draft.requirementsDoc = 'openspec/REQ.md';
    draft.requirementsScan = { generatedAt: new Date().toISOString(), fileCount: scan.fileCount };
    draft.h0 = { hash, approvedAt: null };
    draft.approvals = {
      H0: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
      H1: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
      H2: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
      H3: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
    };
  });
  return {
    ok: true,
    mode: 'existing',
    phase: 'H0_PENDING',
    context: { ...finalContext, requirements: finalRequirements },
    requirements: finalRequirements,
    requirementsDoc: 'openspec/REQ.md',
    autoConfirmed: Boolean(confirmed.autoConfirmed),
    h0Hash: hash,
    scan: {
      fileCount: scan.fileCount,
      truncated: scan.truncated,
      stacks: scan.stacks.map((item) => item.stack),
      routes: scan.routes.length,
      capabilities: scan.capabilities.map((item) => item.label),
      report: 'docs/requirements-scan.md',
      json: '.specgate/requirements-scan.json',
      summary: renderScanSummary(scan),
    },
    git: { hadRepo, initialized: !hadRepo },
  };
}

export async function startInitProject({ root, userQuestions, agent, signal, mode = 'new' }) {
  // REQ-010：已初始化的项目重复 /sg-init 必须幂等跳过，不能重置既有阶段与需求基线。
  const current = load(root);
  if (current.ok && current.state?.phase && current.state.phase !== 'IDLE') {
    return {
      ok: true,
      skipped: true,
      phase: current.state.phase,
      mode: current.state.mode || mode,
      change: current.state.change || null,
      requirementsDoc: current.state.requirementsDoc || 'openspec/REQ.md',
    };
  }
  if (mode === 'existing') return startLegacyInitProject({ root, userQuestions, agent, signal });
  if (!userQuestions || typeof userQuestions.ask !== 'function') {
    return {
      ok: false,
      code: 'QUESTIONS_UNAVAILABLE',
      message: '当前环境没有用户问答服务，无法完成需求盘问；请使用交互式会话执行 /sg-init',
    };
  }
  const requirements = await collectRequirements({ userQuestions, agent, signal });
  const context = await collectContext({ userQuestions, agent, signal, initial: { requirements } });
  if (context.stack === 'java') {
    const selection = validateJavaSelection(context);
    if (!selection.ok) {
      return { ok: false, code: 'JAVA_MATRIX_INVALID', message: selection.errors.join('; ') };
    }
  }
  const confirmed = await confirmInit({ userQuestions, agent, signal, requirements, context });
  if (!confirmed.ok) return confirmed;
  const finalRequirements = confirmed.requirements;
  const finalContext = confirmed.context;
  finalContext.requirements = finalRequirements;
  const init = initProject(root);
  if (!init.ok) return init;
  writeEnvReport(root, scanEnv(root));
  const hash = digest(JSON.stringify({ context: finalContext, requirements: finalRequirements }));
  patchState(root, (draft) => {
    draft.phase = 'H0_PENDING';
    draft.change = null;
    draft.mode = 'new';
    draft.context = finalContext;
    draft.requirements = finalRequirements;
    draft.requirementsVersion = 'v1.0';
    draft.requirementsDoc = 'openspec/REQ.md';
    draft.h0 = { hash, approvedAt: null };
    draft.approvals = {
      H0: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
      H1: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
      H2: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
      H3: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
    };
  });
  return {
    ok: true,
    mode: 'new',
    phase: 'H0_PENDING',
    context: finalContext,
    requirements: finalRequirements,
    requirementsDoc: 'openspec/REQ.md',
    autoConfirmed: Boolean(confirmed.autoConfirmed),
    h0Hash: hash,
  };
}

export async function finishInitProject({ root, state, gitOnly = false }) {
  const context = state.context || {};
  const requirements = context.requirements || state.requirements || {};
  const baseline = writeRequirementsBaseline(root, requirements, {
    version: state.requirementsVersion || 'v1.0',
  });
  if (gitOnly) {
    const gitOnlyResult = gitInitCommit(root, 'chore: 接入 SpecGate 需求基线', { gitOnly: true });
    if (!gitOnlyResult.ok) return { ok: false, message: `git init 失败：${gitOnlyResult.stderr}` };
    patchConfigRequirements(root, {
      enabled: true,
      version: state.requirementsVersion || 'v1.0',
    });
    patchState(root, (draft) => {
      draft.phase = 'H1_PENDING';
      if (!draft.requirementsVersion) draft.requirementsVersion = 'v1.0';
      draft.requirementsDoc = 'openspec/REQ.md';
    });
    return {
      ok: true,
      phase: 'H1_PENDING',
      change: null,
      mode: 'existing',
      scaffold: { written: [], skipped: [] },
      baseline,
      git: gitOnlyResult,
    };
  }
  patchConfigRequirements(root, {
    enabled: true,
    version: state.requirementsVersion || 'v1.0',
  });
  const scaffold = writeScaffold(root, scaffoldFiles(context.stack || 'generic', context));
  writeArtifacts(root, context);
  configureSuites(root, context.stack || 'generic', context);
  const git = gitInitCommit(root);
  if (!git.ok) return { ok: false, message: `git commit 失败：${git.stderr}` };

  let files = null;
  if (context.stack === 'java') files = javaChangeFiles(context);
  else if (context.stack === 'python') files = pythonChangeFiles();
  else if (context.stack === 'vue' || context.stack === 'react')
    files = frontendChangeFiles(context.stack);
  else if (context.stack === 'monorepo') files = monorepoChangeFiles();
  else if (context.stack === 'generic') files = genericChangeFiles();
  else files = firstChangeFiles(context);

  const created = createChange(root, {
    name: 'add-version',
    type: 'feature',
    baseCommit: null,
    changeKey: null,
    requirements: Object.keys(requirements).length ? ['REQ-001'] : null,
  });
  if (!created.ok) return created;
  for (const [relative, content] of Object.entries(files)) {
    writeText(path.join(root, relative), content);
  }
  patchState(root, (draft) => {
    draft.phase = 'H1_PENDING';
    draft.h0 = {
      ...(draft.h0 || {}),
      approvedAt: draft.h0?.approvedAt || new Date().toISOString(),
    };
  });
  return { ok: true, phase: 'H1_PENDING', change: 'add-version', scaffold, baseline };
}

export async function initNewProject({ root, userQuestions, agent, signal }) {
  const started = await startInitProject({ root, userQuestions, agent, signal });
  if (!started.ok) return started;
  const state = load(root).state;
  const finished = await finishInitProject({ root, state });
  if (!finished.ok) return finished;
  return { ...started, ...finished, mode: 'new' };
}
