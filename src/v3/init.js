import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initProject, createChange, configPath, readConfig } from './change.js';
import { load, patchState } from './state.js';
import { issueApproval } from './approvals.js';
import {
  buildClarifyPayload,
  CONFIRM_OPTIONS,
  DOC_RELATIVE,
  nextRequirementsDocPath,
  normalizeDraftInput,
  parseRequirementsText,
  readRequirementsFile,
  renderConfirmationPage,
  renderRequirementsDocument,
  toLegacyRequirements,
  validateParsedDoc,
  writeRequirementsDocument,
} from './requirements-doc.js';
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
    } catch (error) {
      const wrapped = new Error('用户问答不可用：' + (error?.message || String(error)));
      wrapped.code = 'E_QUESTIONS_UNAVAILABLE';
      throw wrapped;
    }
    const selected = answerOf(answer);
    const previous = context[field.key];
    context[field.key] =
      selected && selected !== '跳过' ? selected : previous !== undefined ? previous : '';
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
      return {
        ok: false,
        code: answer.code || 'E_QUESTIONS_UNAVAILABLE',
        message: `确认问题不可用：${answer.message}`,
      };
    }
    if (answer.action === '确认') return { ok: true, requirements: reqs, context: ctx };
    if (answer.action === '修改需求') {
      reqs = await collectRequirements({ userQuestions, agent, signal, initial: reqs });
    } else if (answer.action === '修改技术栈') {
      ctx = await collectContext({ userQuestions, agent, signal, initial: ctx, only: TECH_KEYS });
    } else if (answer.action === '修改其他确认点') {
      ctx = await collectContext({ userQuestions, agent, signal, initial: ctx, only: OTHER_KEYS });
    } else {
      return {
        ok: false,
        code: 'E_CONFIRM_CANCELLED',
        message: '用户取消了初始化确认',
      };
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

/**
 * v3.9：新项目（java/node/python）的第一变更固定为 mvp-scaffold。
 * init 只生成 change 包，CRUD 代码由 /sg-run 执行任务时生成。
 */
function mvpScaffoldFiles(stack, context = {}) {
  const isJava = stack === 'java';
  const isPython = stack === 'python';
  const pkgPath = isJava ? javaPathOf(context) : '';
  const touched = isJava
    ? {
        modify: [],
        bootstrap: [
          'src/main/java/' + pkgPath + '/Item.java',
          'src/main/java/' + pkgPath + '/ItemStore.java',
          'src/main/java/' + pkgPath + '/ItemController.java',
          'src/test/java/' + pkgPath + '/ItemControllerTest.java',
        ],
      }
    : isPython
      ? {
          modify: ['app.py'],
          bootstrap: ['items.py', 'tests/test_items.py'],
        }
      : {
          modify: ['index.js'],
          bootstrap: ['src/items.js', 'test/items.test.mjs'],
        };
  const suite = isJava ? 'backend' : 'api';
  const testFile = isJava
    ? 'src/test/java/' + pkgPath + '/ItemControllerTest.java'
    : isPython
      ? 'tests/test_items.py'
      : 'test/items.test.mjs';
  const testCommand = isJava ? 'mvnw verify' : isPython ? 'pytest -q tests' : 'npm test';
  const files = [...touched.bootstrap, ...touched.modify];

  const scenarios = [
    ['AC-001', '列表返回数组', 'GET /api/items', '200，返回 JSON 数组（可为空）'],
    ['AC-002', '查询存在的条目', 'GET /api/items/{id}', '200，返回该条目的 id/name/description'],
    ['AC-003', '查询不存在的条目', 'GET /api/items/{id}', '404'],
    ['AC-004', '创建条目', 'POST /api/items {"name":"demo"}', '201，返回包含 id 的条目'],
    ['AC-005', '创建缺少 name', 'POST /api/items {}', '400'],
    ['AC-006', '更新存在的条目', 'PUT /api/items/{id} {"name":"updated"}', '200，返回更新后的条目'],
    ['AC-007', '更新不存在的条目', 'PUT /api/items/{id} {"name":"x"}', '404'],
    ['AC-008', '删除存在的条目', 'DELETE /api/items/{id}', '204'],
    ['AC-009', '删除不存在的条目', 'DELETE /api/items/{id}', '404'],
    ['AC-010', '全接口测试与静态检查', testCommand, '退出码 0，全部用例通过'],
  ];

  const specLines = [
    '## ADDED Requirements',
    '',
    '### Requirement: MVP 框架与 Item CRUD 示例 (REQ-001)',
    '',
    '系统 SHALL 在 ' + stack + ' 脚手架上提供内存版 Item CRUD 示例，作为后续业务变更的框架基线。',
    '',
  ];
  for (const [ac, title, when, then] of scenarios) {
    specLines.push('#### Scenario: ' + title + ' (' + ac + ')', '');
    specLines.push('- **WHEN** ' + when);
    specLines.push('- **THEN** ' + then);
    specLines.push('');
  }

  const tasks = [
    {
      id: 'T-001',
      title: 'Item 模型与读取接口',
      ac: ['AC-001', 'AC-002', 'AC-003'],
      deps: [],
      lines: [
        '- [ ] 定义 Item（id/name/description）与内存存储',
        '- [ ] GET /api/items、GET /api/items/{id}（含 404）',
      ],
    },
    {
      id: 'T-002',
      title: '创建/更新/删除接口',
      ac: ['AC-004', 'AC-005', 'AC-006', 'AC-007', 'AC-008', 'AC-009'],
      deps: ['T-001'],
      lines: [
        '- [ ] POST /api/items（name 必填，201）',
        '- [ ] PUT /api/items/{id}（含 404/400）',
        '- [ ] DELETE /api/items/{id}（含 404）',
      ],
    },
    {
      id: 'T-003',
      title: '全接口测试与静态检查',
      ac: ['AC-010'],
      deps: ['T-001', 'T-002'],
      lines: [
        '- [ ] 补齐 ' + testFile + ' 的 5 接口成功/404/400 用例',
        '- [ ] 运行 ' + testCommand + ' 并确保全绿',
      ],
    },
  ];

  const cases = [
    ['TC-001', 'AC-001', 'integration', 'GET /api/items 返回数组'],
    ['TC-002', 'AC-002', 'integration', 'GET /api/items/{id} 存在'],
    ['TC-003', 'AC-003', 'integration', 'GET /api/items/{id} 404'],
    ['TC-004', 'AC-004', 'integration', 'POST /api/items 创建'],
    ['TC-005', 'AC-005', 'unit', 'POST /api/items 缺 name 返回 400'],
    ['TC-006', 'AC-006', 'integration', 'PUT /api/items/{id} 更新'],
    ['TC-007', 'AC-007', 'integration', 'PUT /api/items/{id} 404'],
    ['TC-008', 'AC-008', 'integration', 'DELETE /api/items/{id} 204'],
    ['TC-009', 'AC-009', 'integration', 'DELETE /api/items/{id} 404'],
    ['TC-010', 'AC-010', 'quality', testCommand + ' 全绿'],
  ];

  const mapping = {
    schemaVersion: 1,
    change: 'mvp-scaffold',
    requirements: scenarios.map(([ac], index) => ({
      ac,
      covers: ['REQ-001'],
      tasks: [index < 3 ? 'T-001' : index < 9 ? 'T-002' : 'T-003'],
      cases: ['TC-' + String(index + 1).padStart(3, '0')],
      suite,
      priority: 'P0',
    })),
    automation: [],
  };

  return {
    'openspec/changes/mvp-scaffold/proposal.md':
      '# 变更提案：MVP框架搭建\n\n' +
      '## 问题\n' +
      '新项目只有 health 检查，没有可复用的 CRUD 样板，无法验证分层、参数校验、错误处理与测试链路。\n\n' +
      '## 目标\n' +
      '在 ' +
      stack +
      ' 脚手架上实现通用 Item CRUD 示例：\n' +
      '- GET /api/items\n' +
      '- GET /api/items/{id}\n' +
      '- POST /api/items\n' +
      '- PUT /api/items/{id}\n' +
      '- DELETE /api/items/{id}\n' +
      '内存存储，不引入数据库/外部服务；补齐全接口测试与静态检查。\n\n' +
      '## 非目标\n' +
      '不实现业务域接口；不做持久化、鉴权、分页、文件上传。\n\n' +
      '## 影响面\n' +
      files.map((file) => '- ' + file).join('\n') +
      '\n' +
      '- 关联需求：REQ-001\n',
    'openspec/changes/mvp-scaffold/specs/mvp/spec.md': specLines.join('\n'),
    'openspec/changes/mvp-scaffold/design.md':
      '# 方案：MVP框架搭建\n\n' +
      '## 目标与非目标\n' +
      '提供内存版 Item CRUD 示例，验证 Controller/Service/测试链路；不做持久化与鉴权。\n\n' +
      '## 任务图\n' +
      'T-001 → T-002 → T-003（T-002/T-003 依赖前者）。\n\n' +
      '## AC 到用例\n' +
      'AC-001..AC-010 由 ' +
      testFile +
      ' 覆盖。\n\n' +
      '## 风险\n' +
      '内存存储在重启后丢失，仅用于框架演示；后续业务 change 再引入持久化。\n',
    'openspec/changes/mvp-scaffold/tasks.md':
      '# 任务：MVP框架搭建\n\n' +
      tasks
        .map(
          (task) =>
            '## ' +
            task.id +
            ' ' +
            task.title +
            '\n' +
            '<!-- sg:task ' +
            JSON.stringify({
              id: task.id,
              title: task.title,
              ac: task.ac,
              deps: task.deps,
              parallel: false,
            }) +
            ' -->\n' +
            task.lines.join('\n') +
            '\n',
        )
        .join('\n'),
    'openspec/changes/mvp-scaffold/tests/cases.md':
      '# 测试用例\n\n' +
      '| 用例 | AC | 层次 | 描述 |\n' +
      '|---|---|---|---|\n' +
      cases.map((row) => '| ' + row.join(' | ') + ' |').join('\n') +
      '\n',
    'openspec/changes/mvp-scaffold/tests/mapping.json': JSON.stringify(mapping, null, 2) + '\n',
    'openspec/changes/mvp-scaffold/tests/touched.json':
      JSON.stringify(
        { schemaVersion: 1, modify: touched.modify, delete: [], bootstrap: touched.bootstrap },
        null,
        2,
      ) + '\n',
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
    source: state.requirementsSource?.doc || null,
    sourceHash: state.requirementsSource?.docHash || null,
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

  const backendMvp = ['java', 'node', 'python'].includes(context.stack);
  const changeName = backendMvp ? 'mvp-scaffold' : 'add-version';
  let files = null;
  if (backendMvp) files = mvpScaffoldFiles(context.stack, context);
  else if (context.stack === 'java') files = javaChangeFiles(context);
  else if (context.stack === 'python') files = pythonChangeFiles();
  else if (context.stack === 'vue' || context.stack === 'react')
    files = frontendChangeFiles(context.stack);
  else if (context.stack === 'monorepo') files = monorepoChangeFiles();
  else if (context.stack === 'generic') files = genericChangeFiles();
  else files = firstChangeFiles(context);

  const created = createChange(root, {
    name: changeName,
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
  return { ok: true, phase: 'H1_PENDING', change: changeName, scaffold, baseline };
}

export async function initNewProject({ root, userQuestions, agent, signal }) {
  const started = await startInitProject({ root, userQuestions, agent, signal });
  if (!started.ok) return started;
  const state = load(root).state;
  const finished = await finishInitProject({ root, state });
  if (!finished.ok) return finished;
  return { ...started, ...finished, mode: 'new' };
}

/* ------------------------------------------------------------------ *
 * v3.8：需求先行的三种入口（-req / 自由描述 / 纯对话）
 * 所有校验、技术栈问答与确认都发生在落盘之前；确认失败一律零写。
 * ------------------------------------------------------------------ */

const INIT_GENERATED_PATHS = [
  'openspec/REQ.md',
  'openspec/history',
  'openspec/specs/.gitkeep',
  'openspec/changes/.gitkeep',
  '.specgate/config.yaml',
  '.gitignore',
];

/** 已初始化项目直接幂等跳过；H0_PENDING 且无基线时允许重新澄清。 */
export function inspectInit(root) {
  const loaded = load(root);
  if (!loaded.ok || !loaded.state) return { ok: true, skip: false, fresh: true };
  const state = loaded.state;
  const baselineExists = exists(path.join(root, 'openspec', 'REQ.md'));
  if (baselineExists || state.change || !['IDLE', 'H0_PENDING'].includes(state.phase)) {
    return {
      ok: true,
      skip: true,
      phase: state.phase,
      change: state.change || null,
      requirementsDoc: state.requirementsDoc || 'openspec/REQ.md',
      requirementsSource: state.requirementsSource || null,
      reason: baselineExists ? 'REQ_BASELINE_EXISTS' : 'ALREADY_INITIALIZED',
    };
  }
  return { ok: true, skip: false, replace: state.phase === 'H0_PENDING' };
}

function docTarget(root) {
  return nextRequirementsDocPath(root, 'v1.0') || DOC_RELATIVE;
}

function initWriteList(root, context, mode) {
  const list = [
    docTarget(root),
    'openspec/REQ.md',
    'openspec/history/v1.0/REQ.md',
    '.specgate/config.yaml',
    '.specgate/state.json',
    '.specgate/init-result.json',
  ];
  if (mode === 'new') {
    const files = Object.keys(scaffoldFiles(context.stack || 'generic', context));
    list.push('脚手架（' + files.length + ' 个文件）');
    list.push('openspec/changes/add-version/（首个 change）');
  }
  return list;
}

async function askContextFields({ userQuestions, agent, signal, context, only }) {
  if (!userQuestions || typeof userQuestions.ask !== 'function') {
    return {
      ok: false,
      code: 'E_QUESTIONS_UNAVAILABLE',
      message: '当前宿主没有用户问答通道，无法完成技术栈采集；未写入任何文件。',
    };
  }
  try {
    const next = await collectContext({ userQuestions, agent, signal, initial: context, only });
    return { ok: true, context: next };
  } catch (error) {
    return {
      ok: false,
      code: error?.code || 'E_QUESTIONS_UNAVAILABLE',
      message: '技术栈问答失败：' + (error?.message || String(error)),
    };
  }
}

async function askRequirementsConfirmation({ userQuestions, agent, signal, page }) {
  if (!userQuestions || typeof userQuestions.ask !== 'function') {
    return {
      ok: false,
      code: 'E_QUESTIONS_UNAVAILABLE',
      message: '当前宿主没有用户问答通道，确认被拒绝（fail-closed）；未写入任何文件。',
    };
  }
  let answer;
  try {
    answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-init-confirm',
          header: 'SpecGate 初始化确认',
          question: page,
          options: CONFIRM_OPTIONS.map((label) => ({
            label,
            description: label === '确认' ? '写入需求文档与基线，并进入 H1_PENDING' : '',
          })),
        },
      ],
      agent,
      signal,
    });
  } catch (error) {
    return {
      ok: false,
      code: 'E_QUESTIONS_UNAVAILABLE',
      message: '确认问答失败：' + (error?.message || String(error)) + '；未写入任何文件。',
    };
  }
  const selected = answerOf(answer);
  if (selected === '确认') return { ok: true, action: '确认' };
  if (selected === '修改需求') return { ok: true, action: '修改需求' };
  if (selected === '修改技术栈') return { ok: true, action: '修改技术栈' };
  if (selected === '修改其他确认点') return { ok: true, action: '修改其他确认点' };
  return {
    ok: false,
    code: 'E_CONFIRM_CANCELLED',
    message: '用户取消了初始化确认；未写入任何文件。',
  };
}

function splitRequirementItems(text) {
  return String(text || '')
    .split(/\r?\n|[；;]/)
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean);
}

function docToInterviewDraft(doc, extra = {}) {
  return {
    background: extra.background || '',
    functional: doc.functional.map((entry) => ({
      title: entry.title,
      acceptance: entry.acceptanceText || '',
    })),
    nonFunctional: doc.nonFunctional.map((entry) => ({
      title: entry.title,
      metric: entry.metric || '',
    })),
    constraints: doc.constraints.map((entry) => entry.title),
    acceptance: [],
    confirmedEmpty: extra.confirmedEmpty || [],
    context: extra.context || {},
    team: extra.team || '',
    steps: extra.steps || '',
  };
}

const BACKEND_STACKS = ['java', 'node', 'python'];
const FRAMEWORK_REQUIREMENT_MARKER = 'MVP 框架与 Item CRUD 示例';
const FRAMEWORK_REQUIREMENT_TITLE = 'MVP 框架与 Item CRUD 示例（框架基线）';
const FRAMEWORK_ACCEPTANCE = '启动项目后 Item CRUD 全接口测试通过（GET/POST/PUT/DELETE + 404/400）';

function supportsMvpScaffold(stack) {
  return BACKEND_STACKS.includes(String(stack || ''));
}

/**
 * 新项目 + 后端栈：需求基线第一条固定为框架需求，业务需求顺延。
 * 非后端栈或既有项目不注入。
 */
function syncFrameworkRequirement(doc, stack) {
  const should = supportsMvpScaffold(stack);
  const has = doc.functional.some((entry) =>
    String(entry.title || '').includes(FRAMEWORK_REQUIREMENT_MARKER),
  );
  if (should === has) return doc;
  const draft = docToInterviewDraft(doc, {});
  if (should) {
    draft.functional.unshift({
      title: FRAMEWORK_REQUIREMENT_TITLE,
      acceptance: FRAMEWORK_ACCEPTANCE,
    });
  } else {
    draft.functional = draft.functional.filter(
      (entry) => !String(entry.title || '').includes(FRAMEWORK_REQUIREMENT_MARKER),
    );
  }
  return normalizeDraftInput(draft).doc;
}

/**
 * 有问答通道时，sg-init 主动打开对话框逐维澄清；
 * 无通道时才退回 CLARIFY 交给 Agent。任何失败都不写盘。
 */
async function interviewRequirements({ userQuestions, agent, signal, base = null, keys = null }) {
  const draft = base || {
    functional: [],
    nonFunctional: [],
    constraints: [],
    acceptance: [],
    confirmedEmpty: [],
  };
  const initial = {
    functional: (draft.functional || []).map((entry) => entry.title || entry).filter(Boolean),
    nonFunctional: (draft.nonFunctional || []).map((entry) => entry.title || entry).filter(Boolean),
    constraints: (draft.constraints || []).map((entry) => entry.title || entry).filter(Boolean),
    acceptance: (draft.functional || [])
      .map((entry) => entry.acceptance || entry.acceptanceText || '')
      .filter(Boolean),
  };
  const collected = await collectRequirements({ userQuestions, agent, signal, initial, keys });
  const asked = keys || ['functional', 'nonFunctional', 'constraints', 'acceptance'];
  const next = {
    ...draft,
    functional: [...(draft.functional || [])],
    nonFunctional: [...(draft.nonFunctional || [])],
    constraints: [...(draft.constraints || [])],
    acceptance: [...(draft.acceptance || [])],
    confirmedEmpty: [...(draft.confirmedEmpty || [])],
  };
  const empty = new Set(next.confirmedEmpty);
  for (const key of asked) {
    const value = collected[key]?.[0] || '';
    const items = splitRequirementItems(value);
    if (key === 'acceptance') {
      if (items.length) {
        next.acceptance = items.map((title, index) => ({ title, covers: [index + 1] }));
      }
      continue;
    }
    if (!items.length) {
      next[key] = [];
      empty.add(key);
      continue;
    }
    next[key] = items;
    empty.delete(key);
  }
  next.confirmedEmpty = [...empty];
  return normalizeDraftInput(next);
}

async function runInterview(args) {
  try {
    return { ok: true, ...(await interviewRequirements(args)) };
  } catch (error) {
    return {
      ok: false,
      code: error?.code || 'E_QUESTIONS_UNAVAILABLE',
      message: '需求问答失败：' + (error?.message || String(error)) + '；未写入任何文件。',
    };
  }
}

/**
 * 三种入口的统一实现。返回 CLARIFY 时一定没有写盘。
 */
export async function startRequirementsInit({
  root,
  userQuestions,
  agent,
  signal,
  req = null,
  description = '',
  draft = null,
  mode = null,
}) {
  const guard = inspectInit(root);
  if (guard.skip) return { ...guard, ok: true, skipped: true };

  const targetMode = mode || detectInitMode(root);
  const seed = String(description || '').trim();
  let model = null;
  let source = { kind: 'dialog', path: null, hash: null };
  let background = seed;
  let team = '';
  let steps = '';
  let context = {};
  let confirmedEmpty = [];
  let warnings = [];

  if (req) {
    const read = readRequirementsFile(root, req);
    if (!read.ok) return read;
    model = parseRequirementsText(read.text);
    source = { kind: 'req', path: read.displayPath, hash: read.hash };
    background =
      String(model.meta?.frontmatter?.background || '').trim() ||
      seed ||
      '导入需求文档：' + read.displayPath;
    warnings = model.warnings || [];
    const valid = validateParsedDoc(model, { sourceKind: 'req' });
    if (!valid.ok) {
      return {
        ok: false,
        ...valid.errors[0],
        missing: valid.missing,
        draft: buildClarifyPayload({
          source: 'req',
          seed,
          doc: model,
          background,
          warnings,
          sourceInfo: source,
        }).draft,
      };
    }
  } else if (draft && typeof draft === 'object') {
    const normalized = normalizeDraftInput(draft);
    model = normalized.doc;
    source =
      normalized.source?.kind === 'req' && normalized.source.path
        ? { kind: 'req', path: normalized.source.path, hash: normalized.source.hash || null }
        : { kind: 'draft', path: null, hash: digest(JSON.stringify(draft)) };
    background = normalized.background || seed;
    team = normalized.team;
    steps = normalized.steps;
    context = normalized.context;
    confirmedEmpty = normalized.confirmedEmpty;
    warnings = normalized.warnings;
    const valid = validateParsedDoc(model, { sourceKind: 'draft', confirmedEmpty });
    if (!valid.ok) {
      return {
        ok: false,
        ...valid.errors[0],
        missing: valid.missing,
        draft: buildClarifyPayload({
          source: 'draft',
          seed,
          doc: model,
          background,
          team,
          steps,
          context,
          confirmedEmpty,
          warnings,
        }).draft,
      };
    }
  } else {
    if (!userQuestions || typeof userQuestions.ask !== 'function') {
      return buildClarifyPayload({ source: 'dialog', seed, background: seed });
    }
    const seedDraft = seed
      ? {
          background: seed,
          functional: [{ title: seed }],
          nonFunctional: [],
          constraints: [],
          acceptance: [],
          confirmedEmpty: [],
        }
      : null;
    const interviewed = await runInterview({
      userQuestions,
      agent,
      signal,
      ...(seedDraft ? { base: seedDraft } : {}),
    });
    if (!interviewed.ok) return interviewed;
    model = interviewed.doc;
    background = seed || interviewed.background || '';
    team = interviewed.team || '';
    steps = interviewed.steps || '';
    context = interviewed.context || {};
    confirmedEmpty = interviewed.confirmedEmpty || [];
    warnings = interviewed.warnings || [];
    source = { kind: 'dialog', path: null, hash: null };
    if (!model.functional.length) {
      return {
        ok: false,
        code: 'E_REQ_NO_FUNCTIONAL',
        message: '对话框中没有得到任何功能需求；未写入任何文件。',
        missing: ['functional'],
      };
    }
  }

  const reviewed = validateParsedDoc(model, {
    sourceKind: source.kind === 'req' ? 'req' : 'draft',
    confirmedEmpty,
  });
  if (!reviewed.ok) return { ok: false, ...reviewed.errors[0], missing: reviewed.missing };
  if (reviewed.missing.length) {
    if (!userQuestions || typeof userQuestions.ask !== 'function') {
      return buildClarifyPayload({
        source: source.kind,
        seed,
        doc: model,
        background,
        team,
        steps,
        context,
        confirmedEmpty,
        warnings,
        missing: reviewed.missing,
        ...(source.kind === 'req' ? { sourceInfo: source } : {}),
      });
    }
    const baseDraft = docToInterviewDraft(model, {
      background,
      team,
      steps,
      context,
      confirmedEmpty,
    });
    const interviewed = await runInterview({
      userQuestions,
      agent,
      signal,
      base: baseDraft,
      keys: reviewed.missing,
    });
    if (!interviewed.ok) return interviewed;
    model = interviewed.doc;
    confirmedEmpty = interviewed.confirmedEmpty || [];
    warnings = [...new Set([...(warnings || []), ...(interviewed.warnings || [])])];
    if (!model.functional.length) {
      return {
        ok: false,
        code: 'E_REQ_NO_FUNCTIONAL',
        message: '对话后仍没有功能需求；未写入任何文件。',
        missing: ['functional'],
      };
    }
    const afterInterview = validateParsedDoc(model, {
      sourceKind: source.kind === 'req' ? 'req' : 'draft',
      confirmedEmpty,
    });
    if (!afterInterview.ok) return { ok: false, ...afterInterview.errors[0] };
    if (afterInterview.missing.length) {
      return buildClarifyPayload({
        source: source.kind,
        seed,
        doc: model,
        background,
        team,
        steps,
        context,
        confirmedEmpty,
        warnings,
        missing: afterInterview.missing,
        ...(source.kind === 'req' ? { sourceInfo: source } : {}),
      });
    }
  }

  let ctx = { ...context };
  if (!ctx.background) ctx.background = background;
  if (!ctx.team) ctx.team = team;
  if (!ctx.steps) ctx.steps = steps;

  const needsContext =
    !ctx.stack ||
    (ctx.stack === 'java' &&
      ['buildTool', 'jdk', 'bootVersion', 'modules'].some((key) => !ctx[key]));
  if (needsContext) {
    const collected = await askContextFields({ userQuestions, agent, signal, context: ctx });
    if (!collected.ok) return collected;
    ctx = collected.context;
  }
  if (!ctx.stack) {
    return {
      ok: false,
      code: 'E_DRAFT_INCOMPLETE',
      message: '技术栈未确认（stack 为空）；未写入任何文件。',
      fix: '重新执行 /sg-init 并选择技术栈',
    };
  }
  if (ctx.stack === 'java') {
    const selection = validateJavaSelection(ctx);
    if (!selection.ok) {
      return {
        ok: false,
        code: 'JAVA_MATRIX_INVALID',
        message: selection.errors.join('; ') + '；未写入任何文件。',
      };
    }
  }
  if (!ctx.background) ctx.background = seed || '（待补充）';
  if (!ctx.team) ctx.team = '（待补充）';
  if (!ctx.steps) ctx.steps = '（待补充）';
  if (targetMode === 'new') model = syncFrameworkRequirement(model, ctx.stack);

  const approvedAt = new Date().toISOString();
  let legacy = toLegacyRequirements(model);
  const buildDoc = () =>
    renderRequirementsDocument(model, {
      source: source.kind === 'req' ? source.path : 'dialog',
      sourceHash: source.hash || digest(JSON.stringify({ model, context: ctx })),
      updatedAt: approvedAt,
      background: ctx.background,
      team: ctx.team,
      steps: ctx.steps,
    });

  let confirmedDoc = null;
  for (let round = 0; round < MAX_CONFIRM_ROUNDS; round += 1) {
    const docText = buildDoc();
    const page = renderConfirmationPage({
      docText,
      contextText: renderContextSummary(ctx),
      warnings: [...new Set([...(warnings || []), ...(model.warnings || [])])],
      willWrite: initWriteList(root, ctx, targetMode),
    });
    const answer = await askRequirementsConfirmation({ userQuestions, agent, signal, page });
    if (!answer.ok) return answer;
    if (answer.action === '确认') {
      confirmedDoc = docText;
      break;
    }
    if (answer.action === '修改需求') {
      if (!userQuestions || typeof userQuestions.ask !== 'function') {
        return buildClarifyPayload({
          source: source.kind,
          seed,
          doc: model,
          background: ctx.background,
          team: ctx.team,
          steps: ctx.steps,
          context: ctx,
          confirmedEmpty,
          warnings,
          action: 'revise',
        });
      }
      const reviseDraft = docToInterviewDraft(model, {
        background: ctx.background,
        team: ctx.team,
        steps: ctx.steps,
        context: ctx,
        confirmedEmpty,
      });
      const revised = await runInterview({
        userQuestions,
        agent,
        signal,
        base: reviseDraft,
      });
      if (!revised.ok) return revised;
      model = revised.doc;
      confirmedEmpty = revised.confirmedEmpty || [];
      warnings = [...new Set([...(warnings || []), ...(revised.warnings || [])])];
      if (targetMode === 'new') model = syncFrameworkRequirement(model, ctx.stack);
      if (!model.functional.length) {
        return {
          ok: false,
          code: 'E_REQ_NO_FUNCTIONAL',
          message: '修改后仍没有功能需求；未写入任何文件。',
          missing: ['functional'],
        };
      }
      continue;
    }
    if (answer.action === '修改技术栈') {
      const collected = await askContextFields({
        userQuestions,
        agent,
        signal,
        context: ctx,
        only: TECH_KEYS,
      });
      if (!collected.ok) return collected;
      ctx = collected.context;
      if (ctx.stack === 'java') {
        const selection = validateJavaSelection(ctx);
        if (!selection.ok) {
          return {
            ok: false,
            code: 'JAVA_MATRIX_INVALID',
            message: selection.errors.join('; ') + '；未写入任何文件。',
          };
        }
      }
      if (targetMode === 'new') model = syncFrameworkRequirement(model, ctx.stack);
      continue;
    }
    if (answer.action === '修改其他确认点') {
      const collected = await askContextFields({
        userQuestions,
        agent,
        signal,
        context: ctx,
        only: OTHER_KEYS,
      });
      if (!collected.ok) return collected;
      ctx = collected.context;
      if (!ctx.background) ctx.background = seed || '（待补充）';
      if (!ctx.team) ctx.team = '（待补充）';
      if (!ctx.steps) ctx.steps = '（待补充）';
      continue;
    }
  }
  if (!confirmedDoc) {
    return {
      ok: false,
      code: 'E_CONFIRM_LIMIT',
      message: '初始化确认次数超过上限（6 轮）；未写入任何文件。',
    };
  }
  // 确认页可能经过“修改需求”多轮，最终基线必须与最后一次渲染的文档一致。
  legacy = toLegacyRequirements(model);

  const h0Hash = digest(JSON.stringify({ doc: confirmedDoc, context: ctx }));
  const init = initProject(root);
  if (!init.ok) return init;
  const docWrite = writeRequirementsDocument(root, confirmedDoc, { version: 'v1.0' });
  if (!docWrite.ok) return docWrite;
  const saved = patchState(root, (draftState) => {
    draftState.phase = 'H0_PENDING';
    draftState.mode = targetMode;
    draftState.context = { ...ctx, requirements: legacy };
    draftState.requirements = legacy;
    draftState.requirementsVersion = 'v1.0';
    draftState.requirementsDoc = 'openspec/REQ.md';
    draftState.requirementsSource = {
      kind: source.kind,
      path: source.kind === 'req' ? source.path : null,
      hash: source.hash || null,
      doc: docWrite.relative,
      docHash: digest(confirmedDoc),
    };
    draftState.h0 = { hash: h0Hash, approvedAt };
    draftState.approvals = draftState.approvals || {};
    issueApproval(draftState, 'H0', h0Hash, approvedAt);
  });
  if (!saved.ok) return saved;

  const finished = await finishInitProject({
    root,
    state: load(root).state,
    gitOnly: targetMode === 'existing',
  });
  if (!finished.ok) return finished;

  if (targetMode === 'existing') {
    const committed = gitInitCommit(root, 'chore: 接入 SpecGate 需求基线', {
      gitOnly: true,
      commitPaths: [...INIT_GENERATED_PATHS, docWrite.relative],
    });
    if (!committed.ok) {
      return {
        ok: false,
        code: 'E_WRITE_FAILED',
        message: 'git 提交失败：' + (committed.stderr || 'unknown'),
      };
    }
  }

  const payload = {
    ok: true,
    phase: 'H1_PENDING',
    mode: targetMode,
    requirements: legacy,
    requirementsVersion: 'v1.0',
    requirementsDoc: 'openspec/REQ.md',
    docsDoc: docWrite.relative,
    requirementsSource: load(root).state?.requirementsSource || null,
    h0Hash,
    approvedAt,
    change: finished.change || null,
    scaffold: finished.scaffold || null,
    git: finished.git || null,
    warnings: [...new Set([...(warnings || []), ...(model.warnings || [])])],
    autoConfirmed: false,
  };
  writeText(
    path.join(root, '.specgate', 'init-result.json'),
    JSON.stringify(payload, null, 2) + '\n',
  );
  return payload;
}

export function summarizeInitResult(result) {
  if (!result || result.ok === false) {
    const code = result?.code || 'E_INIT_FAILED';
    const fix = result?.fix ? '\n修复：' + result.fix : '';
    const report = result?.report ? '\n报告：' + result.report : '';
    const missing =
      Array.isArray(result?.missing) && result.missing.length
        ? '\n缺失维度：' + result.missing.join('、')
        : '';
    const draft = result?.draft ? '\n当前草稿：\n' + JSON.stringify(result.draft, null, 2) : '';
    return (
      '初始化失败（' +
      code +
      '）：' +
      (result?.message || '未知错误') +
      fix +
      report +
      missing +
      draft +
      '\n未写入任何文件。'
    );
  }
  if (result.skipped) {
    return [
      'SpecGate v3 已初始化（幂等跳过）：当前阶段 ' + result.phase + '。',
      '需求基线：' +
        result.requirementsDoc +
        (result.change ? '；进行中的 change：' + result.change : '') +
        '。',
      '如需修改初始化上下文请执行 /sg-context --reset。',
    ].join('\n');
  }
  if (result.phase === 'CLARIFY') {
    const lines = [
      'SpecGate 需求澄清（尚未写入任何文件）',
      '',
      '来源：' + result.source + (result.seed ? '（种子描述已记录）' : ''),
      '缺失维度：' + (result.missing.length ? result.missing.join('、') : '无'),
      '',
      '下一批问题：',
      ...result.nextQuestions.map((question, index) => index + 1 + '. ' + question),
      '',
      '协议：' + result.protocol,
      '',
      '当前草稿（收集完请调用 sg_init({ draft })）：',
      '\x60\x60\x60json',
      JSON.stringify(result.draft, null, 2),
      '\x60\x60\x60',
    ];
    if (result.warnings?.length) {
      lines.push('', '告警：', ...result.warnings.map((warning) => '- ' + warning));
    }
    return lines.join('\n');
  }
  const written = Array.isArray(result.scaffold?.written) ? result.scaffold.written : [];
  const skipped = Array.isArray(result.scaffold?.skipped) ? result.scaffold.skipped : [];
  const lines = [
    'SpecGate v3 初始化完成：' + result.phase,
    '需求文档：' + result.docsDoc,
    '需求基线：' + result.requirementsDoc + '（' + result.requirementsVersion + '）',
  ];
  if (written.length) {
    lines.push(
      '脚手架：已生成 ' +
        written.length +
        ' 个文件（' +
        written.slice(0, 6).join('、') +
        (written.length > 6 ? '…' : '') +
        '）',
    );
  }
  if (skipped.length) lines.push('已存在而跳过：' + skipped.join('、'));
  lines.push(
    result.change
      ? '首个 change：' + result.change + '（示例任务，尚未执行）'
      : '既有项目：未生成脚手架',
  );
  if (result.autoBuildSkipped) {
    lines.push('自动构建：跳过（' + result.autoBuildSkipped + '）；可运行 /sg-run 继续');
  }
  if (result.change) {
    lines.push(
      '下一步：/sg-run 校验 M1，然后 sg_approve H1；首个 change 的示例任务会示范实现与测试流程',
    );
  } else {
    lines.push('下一步：/sg-change <name> --type feature 编写 proposal/specs，然后 /sg-run');
  }
  lines.push('说明：sg-init 只负责脚手架与需求基线；业务接口（CRUD）由 change 任务实现并测试。');
  return lines.join('\n');
}
