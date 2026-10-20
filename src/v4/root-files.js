function readme({ backend, frontend }) {
  const lines = [
    '# SpecGate 全栈项目',
    '',
    '一个仓库同时包含后端与前端，根目录统一编排。',
    '',
    '## 目录',
    '',
    '- `api/`：' + (backend === 'java' ? 'Java 8 + Spring Boot 2.7 + Maven' : backend) + ' 后端',
    '- `web/`：' + (frontend === 'vue' ? 'Vue 3' : 'React 18') + ' + Vite 前端',
    '- `contracts/openapi.yaml`：接口契约',
    '- `scripts/`：本地开发与验收脚本',
    '',
    '## 前置条件',
    '',
    '- JDK 8（`JAVA_HOME` 指向 JDK 8；或让 `api/mvnw` 使用 `.specgate/toolchains/jdk-8`）',
    '- Maven 3.9+（也可用 `api/mvnw`）',
    '- Node.js 20+ 与 npm 10+',
    '',
    '## 命令',
    '',
    '```bash',
    'npm run dev       # 同时启动 api(8080) 与 web(5173)',
    'npm run build     # 后端打包 + 前端构建',
    'npm test          # 后端测试 + 前端测试',
    'npm run verify    # 构建、测试、启动、CRUD 冒烟（推荐）',
    '```',
    '',
    '## 端口',
    '',
    '- 后端：http://127.0.0.1:8080',
    '- 前端：http://127.0.0.1:5173（`/api` 代理到 8080）',
    '',
    '## 说明',
    '',
    '- 前端 `VITE_API_MODE=real` 为默认；`mock` 仅用于离线演示。',
    '- fresh clone 不含 `.specgate/toolchains`（已被 gitignore）：先执行 `/sg-env install`，或安装 JDK 8 + Maven 3.9+ 后重试。',
    '',
  ];
  return lines.join('\n');
}

function devScript() {
  return `import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const win = process.platform === 'win32';
const only = process.argv[2] || 'all';
const procs = [];
fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });

function launch(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: win && /\\.(cmd|bat)$/i.test(command),
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      JAVA_TOOL_OPTIONS: '-Djava.io.tmpdir=' + path.join(root, '.tmp'),
    },
  });
  const tag = '[' + name + ']';
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split(/\\r?\\n/)) if (line) console.log(tag + ' ' + line);
    });
  }
  child.on('exit', (code) => console.log(tag + ' exited ' + code));
  procs.push(child);
}

const mvnw = path.join(root, 'api', win ? 'mvnw.cmd' : 'mvnw');
const npm = win ? 'npm.cmd' : 'npm';

if (only === 'all' || only === 'api') {
  launch('api', mvnw, ['-q', '-DskipTests', 'spring-boot:run'], path.join(root, 'api'));
}
if (only === 'all' || only === 'web') {
  launch('web', npm, ['--prefix', 'web', 'run', 'dev'], root);
}

function shutdown() {
  for (const child of procs) {
    if (child.killed) continue;
    if (win) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
`;
}

function mvnScript() {
  return `import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const win = process.platform === 'win32';
const mvnw = path.join(root, 'api', win ? 'mvnw.cmd' : 'mvnw');
const result = spawnSync(mvnw, process.argv.slice(2), {
  cwd: path.join(root, 'api'),
  stdio: 'inherit',
  shell: win,
});
process.exit(result.status === null ? 1 : result.status);
`;
}

function verifyScript() {
  return `import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const mvnw = path.join(root, 'api', win ? 'mvnw.cmd' : 'mvnw');

function run(name, command, args, cwd) {
  console.log('\\n== ' + name + ' ==');
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: win && /\\.(cmd|bat)$/i.test(command),
  });
  if (result.status !== 0) {
    console.error(name + ' failed with ' + result.status);
    process.exit(result.status === null ? 1 : result.status);
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    setTimeout(() => { socket.destroy(); resolve(false); }, 800);
  });
}

async function waitFor(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

function stop(child) {
  if (!child || child.killed) return;
  if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

run('api test', mvnw, ['-B', '-ntp', 'verify'], path.join(root, 'api'));
run('web install', npm, ['--prefix', 'web', 'install', '--no-audit', '--no-fund'], root);
run('web build', npm, ['--prefix', 'web', 'run', 'build'], root);
run('web test', npm, ['--prefix', 'web', 'test'], root);

const target = path.join(root, 'api', 'target');
const jar = fs.existsSync(target)
  ? fs.readdirSync(target).filter((name) => name.endsWith('.jar') && !name.endsWith('.original'))[0]
  : null;
if (!jar) {
  console.error('未找到后端 jar：先执行 mvn package');
  process.exit(1);
}

const localJava = path.join(
  root,
  '.specgate',
  'toolchains',
  'jdk-8',
  'bin',
  win ? 'java.exe' : 'java',
);
const java = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', win ? 'java.exe' : 'java')
  : fs.existsSync(localJava)
    ? localJava
    : 'java';
const tempDir = path.join(root, '.tmp');
fs.mkdirSync(tempDir, { recursive: true });
const api = spawn(java, ['-Djava.io.tmpdir=' + tempDir, '-jar', path.join(target, jar)], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
});
const web = spawn(npm, ['--prefix', 'web', 'run', 'preview', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: win,
});

let failed = false;
try {
  if (!(await waitFor(8080, 90000))) throw new Error('后端 8080 未启动');
  if (!(await waitFor(5173, 90000))) throw new Error('前端 5173 未启动');
  const health = await fetch('http://127.0.0.1:8080/health');
  if (!health.ok) throw new Error('健康检查失败 HTTP ' + health.status);
  const list = await fetch('http://127.0.0.1:5173/api/items');
  const type = list.headers.get('content-type') || '';
  if (!list.ok || !type.includes('application/json')) {
    throw new Error('前端 /api 代理未返回 JSON：' + list.status + ' ' + type);
  }
  console.log('\\nverify ok：后端、前端、代理、CRUD 均可用');
} catch (error) {
  failed = true;
  console.error('verify failed：' + (error instanceof Error ? error.message : String(error)));
} finally {
  stop(web);
  stop(api);
}
process.exit(failed ? 1 : 0);
`;
}

function packageJson() {
  return (
    JSON.stringify(
      {
        name: 'specgate-workspace',
        private: true,
        type: 'module',
        scripts: {
          dev: 'node scripts/dev.mjs',
          'dev:api': 'node scripts/dev.mjs api',
          'dev:web': 'node scripts/dev.mjs web',
          build: 'npm run build:api && npm run build:web',
          'build:api': 'node scripts/mvn.mjs -B -ntp -DskipTests package',
          'build:web': 'npm --prefix web run build',
          test: 'npm run test:api && npm run test:web',
          'test:api': 'node scripts/mvn.mjs -B -ntp test',
          'test:web': 'npm --prefix web test',
          verify: 'node scripts/verify.mjs',
        },
      },
      null,
      2,
    ) + '\n'
  );
}

function gitignore() {
  return [
    '# 构建产物与依赖',
    'node_modules/',
    'dist/',
    'target/',
    'coverage/',
    'data/',
    '*.mv.db',
    '*.trace.db',
    '.venv/',
    '__pycache__/',
    '',
    '# SpecGate 本机工具链与运行态',
    '.specgate/toolchains/',
    '.specgate/m2repo/',
    '.specgate/mirrors/',
    '.specgate/repos/',
    '.specgate/worktrees/',
    '.specgate/state.json',
    '.specgate/env-report.md',
    '**/.specgate/state.json',
    '**/.specgate/worktrees/',
    '**/.specgate/backups/',
    '**/.specgate/evidence/',
    '**/.specgate/gates/',
    '**/.specgate/runs/',
    '',
    '# 本地环境',
    '.env',
    '.env.local',
    '.tmp/',
    '',
  ].join('\n');
}

export function rootFiles(selection = {}) {
  const backend = selection.backend || 'java';
  const frontend = selection.frontend || 'react';
  return {
    'README.md': readme({ backend, frontend }),
    'package.json': packageJson(),
    'scripts/dev.mjs': devScript(),
    'scripts/mvn.mjs': mvnScript(),
    'scripts/verify.mjs': verifyScript(),
    '.env.example':
      '# real：请求真实后端；mock：内存模拟（仅离线演示）\nVITE_API_MODE=real\nVITE_API_BASE=/api\n',
    '.gitignore': gitignore(),
  };
}
