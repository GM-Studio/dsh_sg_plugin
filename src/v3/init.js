import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initProject, createChange, configPath } from './change.js';
import { load, patchState } from './state.js';
import { exists, readText, writeText, ensureDir } from './util/fsx.js';
import { digest } from './util/hash.js';

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
    options: ['node', 'python', 'vue', 'react', 'monorepo', 'generic'],
    question: '选择技术栈：node / python / vue / react / monorepo / generic',
  },
  {
    key: 'acceptance',
    label: '验收标准',
    required: true,
    default: 'GET /health 返回 200 {"status":"ok"}，并有自动化测试',
    question: 'MVP 的可观察验收标准是什么？',
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

export async function collectContext({ userQuestions, agent, signal, initial = {} }) {
  const context = { ...initial };
  for (const field of CONTEXT_FIELDS) {
    if (context[field.key]) continue;
    const options = field.options
      ? field.options.map((value) => ({ label: value, description: value === field.default ? '推荐默认' : '' }))
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
    context[field.key] = selected && selected !== '跳过' ? selected : field.default;
  }
  return context;
}

export function renderContextSummary(context) {
  return [
    '# H0 初始化上下文',
    '',
    `- 背景与 MVP：${context.background}`,
    `- 技术栈：${context.stack}`,
    `- 验收标准：${context.acceptance}`,
    `- 团队与规范：${context.team}`,
    `- 实施步骤：${context.steps}`,
    '',
    '确认后将创建仓库、脚手架与首个 change（停在 H1）。',
  ].join('\n');
}

export async function confirmContext({ userQuestions, agent, signal, context }) {
  for (let round = 0; round < 3; round += 1) {
    const answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-init-h0',
          header: 'SpecGate H0 确认',
          question: renderContextSummary(context),
          options: [
            { label: '确认', description: '按该上下文初始化' },
            { label: '需要修改', description: '逐项重新回答' },
          ],
        },
      ],
      agent,
      signal,
    });
    if (answerOf(answer) !== '需要修改') return { ok: true, context };
    const next = await collectContext({ userQuestions, agent, signal, initial: {} });
    Object.assign(context, next);
  }
  return { ok: false, message: 'H0 修改次数超过上限' };
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

export function scaffoldFiles(stack) {
  if (stack === 'python') return pythonScaffold();
  if (stack === 'generic' || stack === 'vue' || stack === 'react' || stack === 'monorepo') {
    return { ...genericScaffold(), ...(stack === 'node' ? nodeScaffold() : {}) };
  }
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
    written.push(relative);
  }
  return { written, skipped };
}

export function writeArtifacts(root, context) {
  const files = {
    'project-context.md': `# 项目上下文\n\n## 背景与 MVP\n${context.background}\n\n## 技术栈\n${context.stack}\n\n## 验收标准\n${context.acceptance}\n\n## 团队与规范\n${context.team}\n\n## 实施步骤\n${context.steps}\n`,
    'AGENTS.md': `# AGENTS.md\n\n## 团队与规范\n${context.team}\n\n## 命令\n- 运行测试：/sg-run\n- 查看状态：/sg-status\n`,
    'docs/glossary.md': `# 术语表\n\n| 术语 | 定义 |\n|---|---|\n| MVP | ${context.background} |\n`,
    'docs/adr/0001-initial.md': `# ADR-0001 初始化\n\n## 决策\n采用 ${context.stack} 作为 MVP 技术栈。\n`,
    '.github/workflows/ci.yml': `name: ci\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo "configure test command"\n`,
  };
  return writeScaffold(root, files);
}

export function gitInitCommit(root, message = 'chore: 初始化 MVP 脚手架') {
  const run = (args) =>
    spawnSync('git', ['-c', 'user.name=SpecGate', '-c', 'user.email=specgate@local', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  if (!exists(path.join(root, '.git'))) run(['init', '-q']);
  run(['add', '-A']);
  const committed = run(['commit', '-q', '-m', message]);
  return { ok: committed.status === 0, stderr: committed.stderr };
}

function firstChangeFiles(context) {
  return {
    'openspec/changes/add-version/proposal.md': `# 变更提案：add-version\n\n## 问题\nMVP 只有 health，没有版本标识。\n\n## 目标\n新增 GET /version 返回 {"version":"1.0.0"}。\n\n## 非目标\n不改 health。\n\n## 影响面\nindex.js / sg-test.mjs\n`,
    'openspec/changes/add-version/specs/ops/spec.md': `## ADDED Requirements\n\n### Requirement: 版本接口 (REQ-001)\n\n#### Scenario: 返回版本 (AC-001)\n\n- **When** GET /version\n- **Then** 200 {"version":"1.0.0"}\n`,
    'openspec/changes/add-version/design.md': `# 方案：add-version\n\n## 目标与非目标\n新增 /version。\n\n## 任务图\nT-001。\n\n## AC 到用例\nAC-001 由 sg-test.mjs 覆盖。\n\n## 风险\n无。\n`,
    'openspec/changes/add-version/tasks.md': `# 任务：add-version\n\n## T-001 版本接口\n<!-- sg:task {"id":"T-001","title":"版本接口","ac":["AC-001"],"deps":[],"parallel":false} -->\n- [ ] 实现 /version 并补测试\n`,
    'openspec/changes/add-version/tests/cases.md': `# 测试用例\n\n| 用例 | AC | 层次 | 描述 |\n|---|---|---|---|\n| TC-001 | AC-001 | integration | GET /version |\n`,
    'openspec/changes/add-version/tests/mapping.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        change: 'add-version',
        requirements: [
          { ac: 'AC-001', covers: ['REQ-001'], tasks: ['T-001'], cases: ['TC-001'], suite: 'default' },
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
    'openspec/changes/add-version/proposal.md': `# 变更提案：add-version\n\n## 问题\nMVP 只有 health，没有版本标识。\n\n## 目标\n新增 GET /version 返回 {"version":"1.0.0"}。\n\n## 非目标\n不改 health。\n\n## 影响面\napp.py / tests/test_health.py\n`,
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

export function configureSuites(root, stack) {
  const common = `workflowVersion: 3\nschemaVersion: 3\nlanguage: zh\nstack: ${stack}\nmaxParallel: 2\ninstall: true\n`;
  if (stack === 'python') {
    writeText(
      configPath(root),
      `${common}suites:\n  - id: api\n    kind: pytest\n    cwd: "."\n    python: "3.12"\n    pytestArgs: ["-q", "tests"]\n`,
    );
  } else {
    writeText(
      configPath(root),
      `${common}suites:\n  - id: api\n    kind: node-test\n    command: ["node", "sg-test.mjs"]\n    cwd: "."\n`,
    );
  }
}

export async function initNewProject({ root, userQuestions, agent, signal }) {
  const context = await collectContext({ userQuestions, agent, signal });
  const confirmed = await confirmContext({ userQuestions, agent, signal, context });
  if (!confirmed.ok) return confirmed;

  const scaffold = writeScaffold(root, scaffoldFiles(context.stack));
  const init = initProject(root);
  if (!init.ok) return init;
  writeArtifacts(root, context);
  configureSuites(root, context.stack);
  const git = gitInitCommit(root);
  if (!git.ok) return { ok: false, message: `git commit 失败：${git.stderr}` };

  const created = createChange(root, {
    name: 'add-version',
    type: 'feature',
    baseCommit: null,
    changeKey: null,
  });
  if (!created.ok) return created;
  const files = context.stack === 'python' ? pythonChangeFiles() : firstChangeFiles(context);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    if (!exists(target)) writeText(target, content);
  }
  patchState(root, (draft) => {
    draft.h0 = {
      hash: digest(JSON.stringify(context)),
      approvedAt: new Date().toISOString(),
      context,
    };
  });
  return {
    ok: true,
    mode: 'new',
    stack: context.stack,
    context,
    scaffold,
    change: 'add-version',
    phase: 'H1_PENDING',
  };
}
