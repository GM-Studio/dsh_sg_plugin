import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { verifyJavaProject } from './core/java/java-verify.js';
import { VERIFY_STAGES } from './core/java/verify-evidence.js';
import { javaFullstackFiles } from './core/java/java-fullstack-template.js';
import { normalizeJavaPreset } from './core/java/java-versions.js';
import { mavenRoots } from './core/java/java-env.js';
import { projectSourceHash } from './core/template-style.js';
import { patchState } from './core/state.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const EXPECTED_STAGES = [...VERIFY_STAGES, 'frontend-runtime'];
const PUBLIC_KEYS = new Set(['root', 'javaHome', 'mavenHome', 'timeoutMs']);

function failure(code, message) {
  return { ok: false, code, message, v1Complete: false };
}

function within(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
}

function assertOrdinaryParents(root, target) {
  if (!within(root, target)) throw new Error('Verification storage escapes the project');
  let current = path.dirname(target);
  while (within(root, current)) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error('Verification storage traverses an unsafe directory');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current === root) break;
    current = path.dirname(current);
  }
}

function verifyPath(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.split(/[\\/]/).includes('..'))
    return failure('UNSAFE_VERIFY_PATH', '验证路径必须为不含父目录跳转的绝对路径');
  root = path.resolve(root);
  if (root === path.parse(root).root)
    return failure('UNSAFE_VERIFY_PATH', '不能验证文件系统根目录');
  if (within(SOURCE_ROOT, root) || within(root, SOURCE_ROOT))
    return failure(
      'VERIFY_SOURCE_TARGET_FORBIDDEN',
      '不能在 SpecGate 插件源码目录或其父目录验证 Java 项目',
    );
  let ancestor = root;
  while (true) {
    try {
      const stat = fs.lstatSync(ancestor);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        return failure('UNSAFE_VERIFY_PATH', '项目路径不能经过符号链接或文件');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return { ok: true, root };
}

function inspectProject(input) {
  if (Object.keys(input).some((key) => !PUBLIC_KEYS.has(key)))
    return failure(
      'VERIFY_ARGUMENTS_INVALID',
      '验证参数仅允许 root/javaHome/mavenHome/timeoutMs，SDK 自动安装和任意命令不可通过工具参数启用',
    );
  const checked = verifyPath(input.root);
  if (!checked.ok) return checked;
  const root = checked.root;
  if (!fs.existsSync(path.join(root, '.specgate', 'monorepo.json')))
    return failure('E_NOT_JAVA_PROJECT', '不是已初始化的 Java/Vue 项目');
  for (const key of ['javaHome', 'mavenHome']) {
    if (
      input[key] !== undefined &&
      (typeof input[key] !== 'string' ||
        !path.isAbsolute(input[key]) ||
        /[\r\n\0]/.test(input[key]))
    )
      return failure('VERIFY_ARGUMENTS_INVALID', key + ' 必须为已有安装目录的绝对路径');
  }
  if (
    input.timeoutMs !== undefined &&
    (!Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < 1000 ||
      input.timeoutMs > 30 * 60 * 1000)
  )
    return failure('VERIFY_ARGUMENTS_INVALID', 'timeoutMs 必须为 1000–1800000 毫秒');
  const excluded = new Set([
    '.git',
    'frontend/node_modules',
    'frontend/dist',
    'frontend/coverage',
    'backend/target',
  ]);
  let inspected = 0;
  function visit(directory) {
    for (const name of fs.readdirSync(directory)) {
      if (++inspected > 25000) throw new Error('项目路径扫描超过 25000 项上限');
      const target = path.join(directory, name);
      const relative = path.relative(root, target).split(path.sep).join('/');
      const stat = fs.lstatSync(target);
      if (
        stat.isSymbolicLink() ||
        (stat.isFile() && stat.nlink > 1) ||
        (!stat.isDirectory() && !stat.isFile())
      ) {
        const error = new Error('项目包含符号链接、硬链接或非常规文件：' + relative);
        error.code = 'UNSAFE_VERIFY_PATH';
        throw error;
      }
      if (stat.isDirectory() && !excluded.has(relative)) visit(target);
    }
  }
  visit(root);
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(path.join(root, '.specgate/monorepo.json'), 'utf8'));
  } catch {
    return failure('E_INIT_INCOMPLETE', 'Java/Vue 初始化元数据不可读');
  }
  if (metadata.stack !== 'java-vue')
    return failure('E_NOT_JAVA_PROJECT', '不是 Java/Vue 初始化项目');
  const normalized = normalizeJavaPreset(metadata.preset);
  if (!normalized.ok) return normalized;
  const required = [
    ...Object.keys(
      javaFullstackFiles({
        preset: normalized.preset,
        company: metadata.company,
        business: metadata.business,
        frontend: metadata.frontendFramework === 'react' ? 'react' : 'vue',
      }),
    ),
    '.specgate/config.yaml',
    '.specgate/state.json',
    '.specgate/init-report.json',
    '.specgate/golden.json',
    'openspec/REQ.md',
    'openspec/history/v1.0/REQ.md',
  ];
  if (
    required.some(
      (relative) =>
        !fs.existsSync(path.join(root, relative)) ||
        !fs.lstatSync(path.join(root, relative)).isFile(),
    )
  )
    return failure('E_INIT_INCOMPLETE', 'Java/Vue 初始化产物不完整，尚未执行验证');
  const initial = JSON.parse(
    fs.readFileSync(path.join(root, '.specgate/init-report.json'), 'utf8'),
  );
  if (
    initial.generated !== true ||
    initial.gitBaseline?.status !== 'passed' ||
    initial.version?.id !== metadata.preset
  )
    return failure('E_INIT_INCOMPLETE', '缺少完整初始化报告或 Git 基线记录');
  return { ok: true, root, preset: normalized.preset };
}

/** Bounded read-only search; verification subsequently probes Maven and reuses valid installations. */
export function discoverIdeMavenRoots({
  env = process.env,
  platform = process.platform,
  roots,
  maxEntries = 256,
} = {}) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const bases =
    roots ||
    (platform === 'win32'
      ? [
          ...mavenRoots({ env, platform })
            .filter((base) => /program files/i.test(base))
            .map((base) => path.join(base, 'JetBrains')),
          path.join(
            env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
            'Programs',
            'JetBrains',
          ),
          path.join(
            env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
            'JetBrains',
            'Toolbox',
            'apps',
          ),
        ]
      : platform === 'darwin'
        ? [
            '/Applications',
            path.join(home, 'Applications'),
            path.join(home, 'Library', 'Application Support', 'JetBrains', 'Toolbox', 'apps'),
          ]
        : ['/opt/jetbrains', '/opt', path.join(home, '.local/share/JetBrains/Toolbox/apps')]);
  const found = new Set();
  const queue = [...new Set(bases)].slice(0, 16).map((directory) => ({ directory, depth: 0 }));
  let inspected = 0;
  while (queue.length && inspected < maxEntries) {
    const { directory, depth } = queue.shift();
    inspected += 1;
    for (const suffix of ['plugins/maven/lib/maven3', 'Contents/plugins/maven/lib/maven3']) {
      const candidate = path.join(directory, ...suffix.split('/'));
      if (fs.existsSync(path.join(candidate, 'bin', platform === 'win32' ? 'mvn.cmd' : 'mvn')))
        found.add(candidate);
    }
    if (depth >= 3) continue;
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).slice(0, 64)) {
        if (entry.isDirectory())
          queue.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
      }
    } catch {
      // Missing standard installation roots are expected.
    }
  }
  return [...found];
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitClosed(closed, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      closed.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function stopChild(child, closed) {
  if (!child) return { terminated: true, closeObserved: false, exitCode: null, exitSignal: null };
  const stop = (signal) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 2000,
      });
      if (result.status !== 0) child.kill(signal);
    } else {
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    }
  };
  stop('SIGTERM');
  let closeObserved = await waitClosed(closed, 3000);
  if (!closeObserved) {
    stop('SIGKILL');
    closeObserved = await waitClosed(closed, 3000);
  }
  return {
    terminated:
      closeObserved && (!child.pid || child.exitCode !== null || child.signalCode !== null),
    closeObserved,
    exitCode: child.exitCode,
    exitSignal: child.signalCode,
  };
}

/** Actual process/HTTP evidence only. Test launch plans are explicitly marked fixture evidence. */
export async function runFrontendRuntime(
  { root, directory, timeoutMs = 60000, signal, nodePath = process.execPath, env = process.env },
  fixturePlan,
) {
  const startedAt = new Date().toISOString();
  const stage = {
    name: 'frontend-runtime',
    scope: 'frontend-runtime-only',
    fixture: Boolean(fixturePlan),
    status: 1,
    startedAt,
    pid: null,
    terminated: true,
    http: null,
    reason: null,
    tail: [],
  };
  let child;
  let closed;
  let fd;
  let timer;
  let timedOut = false;
  try {
    if (signal?.aborted) {
      stage.reason = 'cancelled';
      throw new Error('Frontend runtime cancelled');
    }
    if (!within(root, directory))
      throw new Error('Frontend evidence directory must remain within the project');
    assertOrdinaryParents(root, path.join(directory, 'frontend-runtime.log'));
    fs.mkdirSync(directory, { recursive: true });
    const logFile = path.join(directory, 'frontend-runtime.log');
    stage.log = path.relative(root, logFile).split(path.sep).join('/');
    fd = fs.openSync(logFile, 'wx');
    const vite = path.join(root, 'frontend/node_modules/vite/bin/vite.js');
    if (
      !fixturePlan &&
      (!fs.existsSync(vite) || !fs.existsSync(path.join(root, 'frontend/dist/index.html')))
    )
      throw new Error('Missing built frontend or installed Vite; runtime was not executed');
    const port = await freePort();
    const base = 'http://127.0.0.1:' + port;
    stage.command = fixturePlan?.command || nodePath;
    stage.args = fixturePlan
      ? fixturePlan.args.map((arg) => arg.replaceAll('{port}', String(port)))
      : [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
    stage.cwd = fixturePlan ? root : path.join(root, 'frontend');
    let output = '';
    child = spawn(stage.command, stage.args, {
      cwd: stage.cwd,
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    stage.pid = child.pid || null;
    closed = new Promise((resolve) => child.once('close', resolve));
    stage.terminated = false;
    const capture = (chunk) => {
      fs.writeSync(fd, chunk);
      output = (output + String(chunk)).slice(-12000);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    let spawnError;
    child.once('error', (error) => {
      spawnError = error;
    });
    const controller = new AbortController();
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let html;
    while (!combined.aborted) {
      if (spawnError || child.exitCode !== null)
        throw spawnError || new Error('Frontend process exited before readiness');
      try {
        const response = await fetch(base + '/', {
          signal: AbortSignal.any([combined, AbortSignal.timeout(1000)]),
        });
        const body = await response.text();
        if (
          response.status === 200 &&
          /<(?:!doctype|html)/i.test(body) &&
          body.length < 2 * 1024 * 1024
        ) {
          html = {
            url: base + '/',
            status: response.status,
            body,
            contentType: response.headers.get('content-type'),
          };
          break;
        }
      } catch {
        // A child can need a short period before listening.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!html) {
      stage.reason = signal?.aborted ? 'cancelled' : 'timeout';
      throw new Error('Frontend did not become ready');
    }
    const urls = [...html.body.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)]
      .map((match) => new URL(match[1], base))
      .filter((url) => /\.(?:js|css)(?:$|\?)/.test(url.pathname + url.search));
    if (!urls.some((url) => /\.js$/.test(url.pathname)))
      throw new Error('Frontend HTML contains no built JavaScript asset');
    if (urls.length > 16) throw new Error('Frontend asset count exceeds the bounded smoke limit');
    const assets = [];
    for (const url of urls.slice(0, 16)) {
      if (url.origin !== base)
        throw new Error('Frontend asset points outside the local verification server');
      const response = await fetch(url, {
        signal: AbortSignal.any([combined, AbortSignal.timeout(3000)]),
      });
      const body = new Uint8Array(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || '';
      const expectedType = /\.js$/.test(url.pathname) ? /(?:javascript|ecmascript)/i : /text\/css/i;
      if (
        response.status !== 200 ||
        !body.length ||
        body.length > 8 * 1024 * 1024 ||
        !expectedType.test(contentType)
      )
        throw new Error(
          'Frontend asset failed HTTP reconciliation: ' +
            url.pathname +
            ' (' +
            response.status +
            ')',
        );
      assets.push({
        url: url.href,
        status: response.status,
        bytes: body.length,
        contentType,
        sha256: createHash('sha256').update(body).digest('hex'),
      });
    }
    stage.http = {
      html: {
        url: html.url,
        status: html.status,
        contentType: html.contentType,
        sha256: createHash('sha256').update(html.body).digest('hex'),
      },
      assets,
    };
    fs.writeSync(fd, '\nHTTP evidence: ' + JSON.stringify(stage.http) + '\n');
    stage.status = 0;
    stage.tail = output.split(/\r?\n/).filter(Boolean).slice(-10);
  } catch (error) {
    if (signal?.aborted) stage.reason = 'cancelled';
    else if (timedOut) stage.reason = 'timeout';
    stage.error = error.message;
    stage.tail.push(error.message);
    if (fd !== undefined) fs.writeSync(fd, '\n' + error.message + '\n');
  } finally {
    clearTimeout(timer);
    stage.termination = await stopChild(child, closed);
    stage.terminated = stage.termination.terminated;
    if (!stage.terminated) stage.status = 1;
    if (fd !== undefined) fs.closeSync(fd);
    stage.finishedAt = new Date().toISOString();
    stage.durationMs = Date.now() - Date.parse(startedAt);
  }
  return stage;
}

function atomicReportWrite(root, target, text) {
  assertOrdinaryParents(root, target);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)
      throw new Error('Unsafe verification storage file: ' + target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = target + '.' + randomUUID() + '.tmp';
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx');
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Preserve the original write/rename failure; an orphan temporary file is not published.
    }
  }
}

function saveReport(root, report, directory) {
  report.checkedAt = new Date().toISOString();
  report.checks = EXPECTED_STAGES.map((name) => {
    const stages = report.stages.filter((stage) => stage.name === name);
    return {
      name,
      status: stages.length === 1 ? (stages[0].status === 0 ? 'passed' : 'failed') : 'not-run',
      ...(stages.length === 1 ? { log: stages[0].log, exitCode: stages[0].status } : {}),
    };
  });
  report.reconciliation = {
    expected: EXPECTED_STAGES.length,
    executed: report.stages.length,
    passed: report.checks.filter((check) => check.status === 'passed').length,
    failed: report.checks.filter((check) => check.status === 'failed').length,
    notRun: report.checks.filter((check) => check.status === 'not-run').length,
  };
  if (
    report.ok &&
    (report.checks.some((check) => check.status !== 'passed') ||
      report.stages.some((stage) => stage.fixture))
  )
    throw new Error('Codex verification evidence reconciliation incomplete');
  report.evidenceFiles = report.stages
    .filter((stage) => stage.log)
    .map((stage) => {
      const target = path.resolve(root, stage.log);
      if (
        !within(root, target) ||
        !fs.lstatSync(target).isFile() ||
        fs.lstatSync(target).isSymbolicLink() ||
        fs.lstatSync(target).nlink > 1
      )
        throw new Error('Invalid stage evidence path: ' + stage.name);
      return {
        stage: stage.name,
        path: stage.log,
        sha256: createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
      };
    });
  const text = JSON.stringify(report, null, 2) + '\n';
  const publish = () => {
    for (const file of [
      path.join(directory, 'report.json'),
      path.join(root, '.specgate/codex-verify-report.json'),
    ])
      atomicReportWrite(root, file, text);
  };
  // Revoke an earlier success before any compatibility-state writes. A successful
  // result is published only after both the initialization report and state persist.
  if (!report.ok) publish();
  const initFile = path.join(root, '.specgate/init-report.json');
  const init = JSON.parse(fs.readFileSync(initFile, 'utf8'));
  init.initializationComplete = report.ok;
  init.phase = report.ok ? 'VERIFIED' : 'VERIFY_' + report.status.toUpperCase();
  init.verification = {
    kind: 'codex-v1-local',
    ok: report.ok,
    runId: report.runId,
    report: path.relative(root, path.join(directory, 'report.json')).split(path.sep).join('/'),
    checkedAt: report.checkedAt,
    failedStage: report.failedStage || null,
  };
  init.execution = Object.fromEntries(report.checks.map((check) => [check.name, check.status]));
  atomicReportWrite(root, initFile, JSON.stringify(init, null, 2) + '\n');
  const saved = patchState(root, (draft) => {
    draft.initialization = {
      ...(draft.initialization || {}),
      phase: init.phase,
      initializationComplete: report.ok,
      verification: init.verification,
    };
  });
  if (!saved.ok)
    throw new Error('Unable to persist legacy compatibility verification state: ' + saved.message);
  if (report.ok) publish();
}

/** Read-only prerequisite for sg-change; never upgrades an incomplete or stale run. */
export function validateVerificationEvidence({ root } = {}) {
  try {
    const checked = inspectProject({ root });
    if (!checked.ok) return checked;
    root = checked.root;
    if (fs.existsSync(path.join(root, '.specgate/codex-verify.lock')))
      return failure('VERIFY_LOCKED', '验证仍在运行或先前存储失败尚待恢复，不能使用旧验证结果');
    const latestPath = path.join(root, '.specgate/codex-verify-report.json');
    if (!fs.existsSync(latestPath))
      return failure('VERIFY_EVIDENCE_MISSING', '缺少 Codex v1 真实验证证据');
    const latest = fs.readFileSync(latestPath, 'utf8');
    const report = JSON.parse(latest);
    if (
      report.kind !== 'codex-v1-local' ||
      report.root !== root ||
      report.preset !== checked.preset.id ||
      report.status !== 'verified' ||
      report.ok !== true ||
      report.v1Complete !== true
    )
      return failure('VERIFY_EVIDENCE_INCOMPLETE', '最新验证尚未完整通过');
    if (typeof report.runId !== 'string' || !/^[\w-]+$/.test(report.runId))
      return failure('VERIFY_EVIDENCE_INVALID', '验证 runId 不合法');
    const runPath = path.join(root, '.specgate/codex-verify-runs', report.runId, 'report.json');
    if (!fs.existsSync(runPath) || fs.readFileSync(runPath, 'utf8') !== latest)
      return failure('VERIFY_EVIDENCE_INVALID', '最新验证报告与本次运行报告不一致');
    const sourceHash = projectSourceHash(root);
    if (!/^[a-f\d]{64}$/.test(report.sourceHash || '') || report.sourceHash !== sourceHash)
      return failure('VERIFY_SOURCE_CHANGED', '当前源码已变化，先前验证不适用于当前内容');
    const startedAt = Date.parse(report.startedAt);
    const finishedAt = Date.parse(report.finishedAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt)
      return failure('VERIFY_EVIDENCE_INVALID', '缺少本次运行起止时间');
    if (
      !Array.isArray(report.expectedStages) ||
      JSON.stringify(report.expectedStages) !== JSON.stringify(EXPECTED_STAGES) ||
      !Array.isArray(report.stages) ||
      report.stages.length !== EXPECTED_STAGES.length
    )
      return failure('VERIFY_EVIDENCE_INCOMPLETE', '验证阶段清单不完整');
    for (const name of EXPECTED_STAGES) {
      const stages = report.stages.filter((stage) => stage.name === name);
      if (stages.length !== 1 || stages[0].status !== 0 || stages[0].fixture)
        return failure('VERIFY_EVIDENCE_INCOMPLETE', '验证阶段未通过或含模拟证据：' + name);
      const stage = stages[0];
      if (
        !Number.isFinite(stage.durationMs) ||
        stage.durationMs < 0 ||
        typeof stage.log !== 'string'
      )
        return failure('VERIFY_EVIDENCE_INVALID', '验证阶段缺少真实日志或耗时：' + name);
      const external = !['coverage', 'runtime'].includes(name);
      if (
        external &&
        (typeof stage.command !== 'string' ||
          !stage.command ||
          !Array.isArray(stage.args) ||
          !stage.args.every((arg) => typeof arg === 'string'))
      )
        return failure('VERIFY_EVIDENCE_INVALID', '验证阶段缺少执行命令：' + name);
      const target = path.resolve(root, stage.log);
      if (
        !within(root, target) ||
        path.isAbsolute(stage.log) ||
        stage.log.split(/[\\/]/).includes('..') ||
        !fs.existsSync(target)
      )
        return failure('VERIFY_EVIDENCE_INVALID', '验证日志路径越界或缺失：' + name);
      const stat = fs.lstatSync(target);
      const files = (report.evidenceFiles || []).filter(
        (entry) => entry.stage === name && entry.path === stage.log,
      );
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        !stat.size ||
        stat.size > 64 * 1024 * 1024 ||
        files.length !== 1 ||
        files[0].sha256 !== createHash('sha256').update(fs.readFileSync(target)).digest('hex')
      )
        return failure('VERIFY_EVIDENCE_INVALID', '验证日志内容缺失或摘要漂移：' + name);
    }
    const backend = report.stages.find((stage) => stage.name === 'backend-verify');
    const frontend = report.stages.find((stage) => stage.name === 'frontend-test');
    if (
      !backend.tests?.total ||
      backend.tests.passed !== backend.tests.total ||
      !frontend.tests?.total ||
      frontend.tests.passed !== frontend.tests.total ||
      frontend.tests.failed !== 0
    )
      return failure('VERIFY_EVIDENCE_INCOMPLETE', '真实前后端用例未全部执行并通过');
    const runtime = report.stages.find((stage) => stage.name === 'frontend-runtime');
    if (
      !(runtime.pid > 0) ||
      runtime.terminated !== true ||
      runtime.http?.html?.status !== 200 ||
      !runtime.http?.assets?.length ||
      runtime.http.assets.some(
        (asset) =>
          asset.status !== 200 || !asset.bytes || !/^[a-f\d]{64}$/.test(asset.sha256 || ''),
      )
    )
      return failure('VERIFY_EVIDENCE_INCOMPLETE', '缺少真实前端进程与 HTTP 资源证据');
    const legacyFile = path.join(
      root,
      '.specgate/verify-runs',
      report.legacyRunId || '',
      'report.json',
    );
    if (
      typeof report.legacyRunId !== 'string' ||
      !/^[\w-]+$/.test(report.legacyRunId) ||
      !fs.existsSync(legacyFile)
    )
      return failure('VERIFY_EVIDENCE_INVALID', '缺少本次验证的原始运行报告');
    const legacyText = fs.readFileSync(legacyFile, 'utf8');
    const latestLegacy = path.join(root, '.specgate/verify-report.json');
    if (!fs.existsSync(latestLegacy) || fs.readFileSync(latestLegacy, 'utf8') !== legacyText)
      return failure(
        'VERIFY_EVIDENCE_INVALID',
        '最新验证运行已变化，旧 Codex 验证证据不能继续使用',
      );
    const legacy = JSON.parse(legacyText);
    if (
      legacy.ok !== true ||
      legacy.preset !== report.preset ||
      legacy.sourceHash !== sourceHash ||
      VERIFY_STAGES.some(
        (name) =>
          legacy.stages?.filter((stage) => stage.name === name && stage.status === 0).length !== 1,
      )
    )
      return failure('VERIFY_EVIDENCE_INVALID', '原始运行报告未通过或与当前源码不一致');
    const init = JSON.parse(fs.readFileSync(path.join(root, '.specgate/init-report.json'), 'utf8'));
    if (
      init.initializationComplete !== true ||
      init.phase !== 'VERIFIED' ||
      init.verification?.kind !== 'codex-v1-local' ||
      init.verification?.runId !== report.runId ||
      init.verification?.ok !== true
    )
      return failure('VERIFY_EVIDENCE_INVALID', '初始化状态与本次 Codex 验证结果不一致');
    return { ok: true, report, sourceHash, runId: report.runId, reportPath: runPath };
  } catch (error) {
    return failure('VERIFY_EVIDENCE_INVALID', error.message);
  }
}

/** Public args are constrained; execution dependencies and environment stay server-owned. */
export async function verifyProject(
  input = {},
  { signal, onProgress, env = process.env, scan = {}, ideRoots } = {},
) {
  let checked;
  try {
    checked = inspectProject(input);
  } catch (error) {
    return failure(error.code || 'VERIFY_PREFLIGHT_FAILED', error.message);
  }
  if (!checked.ok) return checked;
  const root = checked.root;
  const lock = path.join(root, '.specgate/codex-verify.lock');
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid }));
  } catch (error) {
    return failure(
      error.code === 'EEXIST' ? 'VERIFY_LOCKED' : 'VERIFY_STORAGE_FAILED',
      error.message,
    );
  }
  let report;
  let directory;
  let legacy;
  let retainLock = false;
  try {
    const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
    directory = path.join(root, '.specgate/codex-verify-runs', runId);
    fs.mkdirSync(directory, { recursive: true });
    report = {
      schemaVersion: 1,
      kind: 'codex-v1-local',
      root,
      runId,
      preset: checked.preset.id,
      startedAt: new Date().toISOString(),
      status: 'running',
      ok: false,
      v1Complete: false,
      expectedStages: EXPECTED_STAGES,
      stages: [],
      policy: { installSdk: false, browserRequired: false, dependenciesAndBuildMayRun: true },
    };
    saveReport(root, report, directory);
    const ideMaven = discoverIdeMavenRoots({ env, roots: ideRoots });
    legacy = await verifyJavaProject({
      root,
      javaHome: input.javaHome,
      mavenHome: input.mavenHome,
      timeoutMs: input.timeoutMs,
      env,
      scan: { ...scan, extraMavenRoots: [...(scan.extraMavenRoots || []), ...ideMaven] },
      signal,
      onProgress,
      install: false,
      full: false,
    });
    report.legacyRunId = legacy.report?.runId || null;
    report.stages = [...(legacy.report?.stages || [])];
    report.environment = legacy.report?.environment || null;
    report.status = signal?.aborted ? 'cancelled' : legacy.report?.status || 'failed';
    report.failedStage = legacy.report?.failedStage || null;
    saveReport(root, report, directory);
    if (!legacy.ok) return { ...legacy, report, legacyReport: legacy.report, v1Complete: false };
    const sourceHash = projectSourceHash(root);
    const legacyComplete = VERIFY_STAGES.every(
      (name) =>
        report.stages.filter((stage) => stage.name === name && stage.status === 0).length === 1,
    );
    if (!legacyComplete || legacy.report?.sourceHash !== sourceHash) {
      report.status = 'failed';
      report.failedStage = 'legacy-reconciliation';
      saveReport(root, report, directory);
      return {
        ...failure('VERIFY_INCOMPLETE', '实际证据与当前源码未完成对账'),
        report,
        legacyReport: legacy.report,
      };
    }
    const frontend = await runFrontendRuntime({
      root,
      directory,
      signal,
      env,
      nodePath: legacy.report.environment?.node?.path || process.execPath,
      timeoutMs: Math.min(input.timeoutMs || 60000, 60000),
    });
    report.stages.push(frontend);
    const unchanged = sourceHash === projectSourceHash(root);
    report.ok = frontend.status === 0 && unchanged && !signal?.aborted;
    report.v1Complete = report.ok;
    report.sourceHash = sourceHash;
    report.status = signal?.aborted ? 'cancelled' : report.ok ? 'verified' : 'failed';
    report.failedStage = !unchanged
      ? 'source-changed'
      : frontend.status !== 0
        ? 'frontend-runtime'
        : null;
    report.finishedAt = new Date().toISOString();
    saveReport(root, report, directory);
    return {
      ok: report.ok,
      code: signal?.aborted ? 'VERIFY_CANCELLED' : report.ok ? 'VERIFIED' : 'VERIFY_FAILED',
      message: report.ok
        ? '真实本地验证通过，包含前端进程启动与 HTTP 静态资源检查。'
        : '验证未通过：前端运行时或源码一致性检查失败。',
      report,
      legacyReport: legacy.report,
      v1Complete: report.ok,
    };
  } catch (error) {
    if (report && directory) {
      report.ok = false;
      report.v1Complete = false;
      report.status = signal?.aborted ? 'cancelled' : 'failed';
      report.error = error.message;
      try {
        saveReport(root, report, directory);
      } catch (storageError) {
        retainLock = true;
        report.persistenceError = storageError.message;
      }
    } else retainLock = true;
    return {
      ...failure(signal?.aborted ? 'VERIFY_CANCELLED' : 'VERIFY_FAILED', error.message),
      report: report || null,
      legacyReport: legacy?.report || null,
      ...(retainLock ? { recoveryRequired: true, lockPath: lock } : {}),
    };
  } finally {
    fs.closeSync(fd);
    if (!retainLock) fs.unlinkSync(lock);
  }
}
