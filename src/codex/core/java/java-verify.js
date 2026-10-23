import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { exerciseAdminApi } from './java-runtime.js';
import { runBrowserSmoke } from './browser-e2e.js';
import { reconcileCoverage } from './coverage-evidence.js';
import { projectSourceHash } from '../template-style.js';
import { spawn, spawnSync } from 'node:child_process';
import { normalizeJavaPreset } from './java-versions.js';
import {
  discoverJava,
  discoverMaven,
  discoverNode,
  formatEnvironmentScan,
  installGuidance,
  javaRoots,
  mavenRoots,
  mergeEnvironment,
  readPersistentEnvironment,
  discoverArchives,
} from './java-env.js';
import { answerOf } from '../requirements.js';
import { createVerification, executeVerificationStage } from './verify-evidence.js';
import { collectJavaReports } from '../java-reports.js';
import { isProcessAlive, inspect as inspectRunLock } from '../lock.js';
import { provisionToolchain } from './provision.js';
import { jdkDownloadUrl, resolveMirrors } from './mirrors.js';
import { createTemporaryDirectory } from '../temp.js';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function toolchainRoots(root) {
  const roots = [];
  let current = path.resolve(root);
  for (let depth = 0; depth < 6; depth += 1) {
    roots.push(path.join(current, '.specgate', 'toolchains'));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

export function scanToolchains({
  root,
  env = process.env,
  platform = process.platform,
  scan = {},
}) {
  const homedir = scan.homedir;
  const toolchains = toolchainRoots(root);
  const java = discoverJava({
    env,
    platform,
    homedir,
    roots: [
      ...(scan.javaRoots || javaRoots({ env, platform, homedir })),
      ...(scan.extraJavaRoots || []),
      ...toolchains,
    ],
    probe: scan.probe,
  });
  const javaHome = pickJavaHome(java, scan.requestedJdk);
  const mavenEnv = javaHome
    ? {
        ...env,
        JAVA_HOME: javaHome,
        PATH:
          path.join(javaHome, 'bin') +
          (platform === 'win32' ? ';' : ':') +
          (env.PATH || env.Path || ''),
      }
    : env;
  const maven = discoverMaven({
    env: mavenEnv,
    platform,
    homedir,
    roots: [
      ...(scan.mavenRoots || mavenRoots({ env, platform, homedir })),
      ...(scan.extraMavenRoots || []),
      ...toolchains,
    ],
    probe: scan.probe,
  });
  const node = discoverNode({
    env,
    platform,
    homedir,
    fallbackNode: scan.node || process.execPath,
  });
  return { java, maven, node, npm: (node && node.npm) || null };
}

export function pickJavaHome(javaScan, major) {
  const found = (javaScan?.homes || []).find((item) => Number(item.major) === Number(major));
  return found ? found.home : null;
}

function npmPlan(npmPath, nodePath, args) {
  if (!npmPath) return process.platform === 'win32' ? ['npm.cmd', args] : ['npm', args];
  if (/\.(c?js|mjs)$/i.test(npmPath)) return [nodePath || process.execPath, [npmPath, ...args]];
  return [npmPath, args];
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

function waitExit(child, timeoutMs = 15000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitHealthy(url, timeoutMs = 60000, signal, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted || (child && child.exitCode !== null) || child?.spawnFailure) return false;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return true;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function runRuntimeSmoke({
  root,
  javaHome,
  env,
  signal,
  directory,
  full = false,
  npm = null,
  nodePath = null,
}) {
  const backend = path.join(root, 'backend');
  const target = path.join(backend, 'target');
  const jar = fs
    .readdirSync(target)
    .filter((name) => name.endsWith('.jar') && !name.endsWith('.original'))
    .map((name) => path.join(target, name))[0];
  if (!jar) return { name: 'runtime', status: 1, durationMs: 0, tail: ['No backend jar'] };
  const database = createTemporaryDirectory('verify-db-', { parent: path.join(root, '.specgate') });
  const dbDir = database.path;
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const childEnv = {
    ...env,
    BACKEND_PORT: String(port),
    APP_ADMIN_PASSWORD: randomUUID(),
    APP_VIEWER_PASSWORD: randomUUID(),
    FILE_DIRECTORY: path.join(dbDir, 'uploads'),
    MANAGEMENT_ENDPOINT_SHUTDOWN_ENABLED: 'true',
    MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE: 'health,shutdown',
    DB_URL:
      'jdbc:h2:file:' + path.join(dbDir, 'tasks').replace(/\\/g, '/') + ';DB_CLOSE_ON_EXIT=FALSE',
  };
  const java = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const logs = [];
  const logFile = path.join(directory, 'runtime.log');
  const fd = fs.openSync(logFile, 'w');
  const capture = (chunk) => {
    fs.writeSync(fd, chunk);
    logs.push(String(chunk));
    if (logs.length > 40) logs.shift();
  };
  let child = null;
  const startedAt = Date.now();
  const shutdown = async () => {
    const { sessionClient } = await import('./java-runtime.js');
    const admin = sessionClient(base);
    await admin.write('/api/auth/login', {
      username: 'admin',
      password: childEnv.APP_ADMIN_PASSWORD,
    });
    const csrf = await admin.json('/api/auth/csrf');
    await admin.send('/actuator/shutdown', {
      method: 'POST',
      headers: { 'X-CSRF-TOKEN': csrf.token },
    });
  };
  const restartBackend = async (shutdownFn) => {
    if (!(await stop(shutdownFn))) throw new Error('Backend did not shut down normally');
    if (signal?.aborted) throw new Error('Verification cancelled');
    start();
    if (!(await waitHealthy(base + '/actuator/health', 60000, signal, child)))
      throw new Error('Backend restart failed');
  };
  function start() {
    child = spawn(java, ['-jar', jar], {
      cwd: backend,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const launched = child;
    launched.once('error', (error) => {
      launched.spawnFailure = true;
      capture(Buffer.from(error.message));
    });
  }
  async function stop(shutdown) {
    const current = child;
    child = null;
    if (!current || current.exitCode !== null || !current.pid) return current?.exitCode === 0;
    try {
      if (shutdown) await shutdown();
      else
        await fetch(base + '/actuator/shutdown', {
          method: 'POST',
          signal: AbortSignal.timeout(5000),
        });
    } catch {
      // Fall back to terminating the process below.
    }
    await waitExit(current, 8000);
    const graceful = current.exitCode === 0;
    if (current.exitCode === null) {
      if (process.platform === 'win32') {
        const killed = spawnSync('taskkill', ['/pid', String(current.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 2000,
        });
        if (killed.status !== 0) current.kill('SIGKILL');
      } else current.kill('SIGKILL');
      await waitExit(current);
    }
    return graceful;
  }
  try {
    start();
    if (!(await waitHealthy(base + '/actuator/health', 60000, signal, child)))
      throw new Error('Backend did not become healthy');
    await exerciseAdminApi({
      base,
      env: childEnv,
      restart: restartBackend,
      log: (message) => fs.writeSync(fd, '\n' + message + '\n'),
    });
    let browser = null;
    if (full) {
      const frontendPort = await freePort();
      const frontendPlan = npmPlan(npm, nodePath, [
        'run',
        'dev',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        String(frontendPort),
      ]);
      browser = await runBrowserSmoke({
        root,
        backendPort: port,
        frontendPort,
        env: childEnv,
        frontendCommand: frontendPlan[0],
        frontendArgs: frontendPlan[1],
        restart: () => restartBackend(shutdown),
        signal,
        directory,
        log: (message) => fs.writeSync(fd, '\n' + message + '\n'),
      });
    }
    return {
      name: 'runtime',
      status: 0,
      durationMs: Date.now() - startedAt,
      log: path.relative(root, logFile).replace(/\\/g, '/'),
      tail: logs.join('').split(/\r?\n/).filter(Boolean).slice(-8),
      browser,
    };
  } catch (error) {
    return {
      name: 'runtime',
      status: 1,
      durationMs: Date.now() - startedAt,
      log: path.relative(root, logFile).replace(/\\/g, '/'),
      tail: [
        ...logs.join('').split(/\r?\n/).filter(Boolean).slice(-8),
        String(error.message || error),
      ],
    };
  } finally {
    await stop(shutdown);
    try {
      fs.closeSync(fd);
    } finally {
      try {
        database.cleanup();
      } catch (error) {
        process.stderr.write(`[specgate] runtime temp cleanup failed: ${error.message}\n`);
      }
    }
  }
}

async function verifyJavaProjectUnlocked({
  root,
  env = process.env,
  timeoutMs = 15 * 60 * 1000,
  install = false,
  scan = {},
  onProgress,
  signal,
  userQuestions,
  agent,
  javaHome: customJavaHome,
  mavenHome: customMavenHome,
  full = false,
} = {}) {
  root = path.resolve(root);
  const marker = path.join(root, '.specgate', 'monorepo.json');
  if (!fs.existsSync(marker)) {
    return { ok: false, code: 'E_NOT_JAVA_PROJECT', message: '不是 Java/Vue monorepo 初始化项目' };
  }
  let metadata;
  try {
    metadata = readJson(marker);
  } catch (error) {
    return { ok: false, code: 'E_METADATA_INVALID', message: error.message };
  }
  if (metadata.stack !== 'java-vue')
    return { ok: false, code: 'E_NOT_JAVA_PROJECT', message: '不是 Java/Vue monorepo 初始化项目' };
  const normalized = normalizeJavaPreset(metadata.preset);
  if (!normalized.ok) return normalized;
  const preset = normalized.preset;
  const platform = scan.platform || process.platform;
  const arch = scan.arch || process.arch;
  scan = { ...scan, requestedJdk: preset.jdk };
  const persistent = env === process.env ? readPersistentEnvironment({ platform, env }) : {};
  env = mergeEnvironment({ ...persistent, env, platform });
  // A stale inherited JAVA_HOME must not hide a newly installed persistent scope.
  const scoped = ['machine', 'user'].map((scope) =>
    mergeEnvironment({ env: { ...env, ...persistent[scope] }, platform }),
  );
  scan.extraJavaRoots = [
    ...(scan.extraJavaRoots || []),
    ...scoped.flatMap((scope) =>
      Object.entries(scope)
        .filter(([key]) => /^(?:SG_)?(?:JAVA.*HOME|JDK_HOME)$/i.test(key))
        .map(([, value]) => value),
    ),
  ];
  scan.extraMavenRoots = [
    ...(scan.extraMavenRoots || []),
    ...scoped.flatMap((scope) =>
      Object.entries(scope)
        .filter(([key]) => /^(?:SG_)?(?:MAVEN_HOME|M2_HOME)$/i.test(key))
        .map(([, value]) => value),
    ),
  ];
  const evidence = createVerification(root, preset, { full });
  const finish = (status, code, message, extra = {}) => {
    const phase =
      status === 'verified'
        ? 'VERIFIED'
        : status === 'smoke-passed'
          ? 'SMOKE_PASSED'
          : 'VERIFY_' + status.toUpperCase();
    const report = evidence.save({
      ...extra,
      phase,
      status,
      ok: status === 'smoke-passed' || status === 'verified',
      finishedAt: new Date().toISOString(),
    });
    return { ok: report.ok, code, message, report };
  };
  if (signal?.aborted)
    return finish('cancelled', 'VERIFY_CANCELLED', '用户取消验证；未执行质量命令。');
  let savedPaths = {};
  try {
    savedPaths = readJson(path.join(root, '.specgate', 'toolchain-paths.json'));
  } catch {
    /* First run. */
  }
  if (customJavaHome || savedPaths.javaHome)
    env.SG_JAVA_HOME = customJavaHome || savedPaths.javaHome;
  if (customMavenHome || savedPaths.mavenHome)
    env.SG_MAVEN_HOME = customMavenHome || savedPaths.mavenHome;
  const progress = (phase, message) => {
    try {
      if (typeof onProgress === 'function') onProgress({ phase, message });
    } catch {
      // 进度回调只是可见性增强，不能影响验证。
    }
  };

  progress('scan', '扫描 JDK / Maven / Node 环境…');
  let toolchains = scanToolchains({ root, env, platform, scan });
  const hasRequestedJdk = () => pickJavaHome(toolchains.java, preset.jdk) !== null;
  let provisioned = [];
  let provisionError = null;
  const customArchives = {};

  if ((!hasRequestedJdk() || !toolchains.maven) && userQuestions?.ask) {
    const missingTools = [
      !hasRequestedJdk() ? 'jdk' : null,
      !toolchains.maven ? 'maven' : null,
    ].filter(Boolean);
    try {
      const answer = await userQuestions.ask({
        questions: missingTools.map((tool) => ({
          id: 'sg-verify-' + tool + '-path',
          header: tool === 'jdk' ? 'JDK 路径' : 'Maven 路径',
          question:
            '未找到可用的 ' +
            (tool === 'jdk' ? 'JDK ' + preset.jdk : 'Maven 3.9.x') +
            '。可输入自定义安装目录、bin 目录、可执行文件或 ZIP/tar.gz 压缩包完整路径。留空或选择继续将' +
            (install
              ? '自动下载并安装到项目 .specgate/toolchains。'
              : '报告缺失（当前禁止自动安装）。'),
          options: [
            {
              label: '继续',
              description: install
                ? '没有自定义路径，使用项目内自动安装'
                : '保留代码并报告缺少环境',
            },
            { label: '取消', description: '终止本次验证，不下载安装' },
          ],
        })),
        agent,
        signal,
      });
      for (let index = 0; index < missingTools.length; index++) {
        const value = String(answerOf(answer, index) || '').trim();
        if (value === '取消' || signal?.aborted)
          return finish('cancelled', 'VERIFY_CANCELLED', '用户取消验证；未下载安装。');
        if (!value || value === '继续') continue;
        const tool = missingTools[index];
        let location = value.replace(/^["']|["']$/g, '');
        if (/^~(?:[/\\]|$)/.test(location))
          location = path.join(
            env.USERPROFILE || env.HOME || scan.homedir || '',
            location.slice(1),
          );
        location = path.resolve(root, location);
        if (/\.(zip|tar\.gz|tgz)$/i.test(location)) {
          customArchives[tool] = location;
          continue;
        }
        if (/^(?:java(?:c)?(?:\.exe)?|mvn(?:\.(?:cmd|bat|exe))?)$/i.test(path.basename(location)))
          location = path.dirname(location);
        if (path.basename(location).toLowerCase() === 'bin') location = path.dirname(location);
        if (tool === 'jdk') env.SG_JAVA_HOME = location;
        else env.SG_MAVEN_HOME = location;
      }
      toolchains = scanToolchains({ root, env, platform, scan });
      const validated = {};
      const selectedJava = pickJavaHome(toolchains.java, preset.jdk);
      if (selectedJava && selectedJava === env.SG_JAVA_HOME) validated.javaHome = selectedJava;
      if (toolchains.maven?.home === env.SG_MAVEN_HOME) validated.mavenHome = toolchains.maven.home;
      if (Object.keys(validated).length)
        fs.writeFileSync(
          path.join(root, '.specgate/toolchain-paths.json'),
          JSON.stringify({ ...savedPaths, ...validated }, null, 2) + '\n',
        );
    } catch (error) {
      return finish(
        signal?.aborted ? 'cancelled' : 'blocked',
        signal?.aborted ? 'VERIFY_CANCELLED' : 'VERIFY_BLOCKED',
        '自定义路径对话框未完成：' + error.message,
      );
    }
  }

  if (install && (!hasRequestedJdk() || !toolchains.maven)) {
    const mirrors = resolveMirrors(env);
    const actions = [];
    if (!hasRequestedJdk()) {
      const url = jdkDownloadUrl(mirrors, preset.jdk, platform, arch);
      if (url) {
        actions.push({
          tool: 'jdk',
          version: String(preset.jdk),
          kind: 'download',
          url,
          target: '.specgate/toolchains/jdk-' + preset.jdk,
          requiresElevation: false,
          archive: customArchives.jdk,
        });
      }
    }
    if (!toolchains.maven) {
      actions.push({
        tool: 'maven',
        version: '3.9.11',
        kind: 'download',
        url:
          platform !== 'win32' && !env.SG_MAVEN_DIST
            ? mirrors.mavenDist.replace(/\.zip$/, '.tar.gz')
            : mirrors.mavenDist,
        target: '.specgate/toolchains/apache-maven-3.9.11',
        requiresElevation: false,
        archive: customArchives.maven,
      });
    }
    if (actions.length) {
      progress(
        'provision',
        '自动安装到项目内：' + actions.map((item) => item.tool + ' ' + item.version).join('、'),
      );
      const result = await provisionToolchain({
        root,
        platform,
        signal,
        plan: { ok: true, tools: {}, actions, warnings: [], mirrors },
      });
      if (!result.ok) provisionError = result.message;
      provisioned = result.completed || [];
      toolchains = scanToolchains({
        root,
        env,
        platform,
        scan: {
          ...scan,
          javaRoots: [...(scan.javaRoots || javaRoots({ env, platform })), ...toolchainRoots(root)],
          mavenRoots: [
            ...(scan.mavenRoots || mavenRoots({ env, platform })),
            ...toolchainRoots(root),
          ],
        },
      });
    }
  }

  const javaHome = pickJavaHome(toolchains.java, preset.jdk);
  const maven = toolchains.maven ? toolchains.maven.path : null;
  const npm = toolchains.npm;
  const missing = [];
  if (!javaHome) missing.push('JDK ' + preset.jdk);
  if (!maven) missing.push('Maven 3.9.x');
  if (!toolchains.node) missing.push('Node 22.12+ / 24');
  if (!npm) missing.push('npm');
  const environment = {
    platform,
    arch,
    java: (toolchains.java.homes || []).map((item) => ({
      home: item.home,
      version: item.version,
      major: item.major,
      source: item.source,
    })),
    maven: toolchains.maven
      ? { path: toolchains.maven.path, version: toolchains.maven.version }
      : null,
    node: toolchains.node ? { path: toolchains.node.node, version: toolchains.node.version } : null,
    npm,
    provisioned: provisioned.map((item) => ({
      tool: item.tool,
      version: item.version,
      path: item.path || null,
      reused: item.reused === true,
    })),
    provisionError,
    scannedAt: new Date().toISOString(),
    archives: discoverArchives({
      roots: [
        path.join(root, '.specgate/toolchains/.downloads'),
        path.join(env.USERPROFILE || env.HOME || scan.homedir || root, 'Downloads'),
      ],
    }),
  };
  evidence.save({ environment });
  if (signal?.aborted) return finish('cancelled', 'VERIFY_CANCELLED', '用户取消验证。');
  if (missing.length) {
    const guidance = installGuidance({
      jdk: missing.includes('JDK ' + preset.jdk) ? preset.jdk : null,
      needMaven: !maven,
      platform,
    }).join('\n');
    const message = [
      formatEnvironmentScan({
        java: toolchains.java,
        maven: toolchains.maven,
        node: toolchains.node,
        npm,
      }),
      '缺少本地验证前置条件：' + missing.join('、') + '（生成代码已保留）。',
      provisionError ? '自动安装未能完成：' + provisionError : null,
      'JDK 8/17/21 与 Maven 支持项目内自动安装；可通过自定义路径或 JAVA_HOME/MAVEN_HOME 复用。',
      guidance,
    ]
      .filter(Boolean)
      .join('\n');
    return finish('blocked', 'VERIFY_BLOCKED', message, { missing, environment, guidance });
  }

  const commandEnv = {
    ...env,
    JAVA_HOME: javaHome,
    PATH: [
      path.dirname(toolchains.node.node),
      path.join(javaHome, 'bin'),
      path.dirname(maven),
      env.PATH || env.Path || '',
    ].join(path.delimiter),
    MAVEN_CMD: maven,
  };
  commandEnv.Path = commandEnv.PATH;
  const stages = [];
  const initialCodeHash = projectSourceHash(root, { ignoreLocks: true });
  evidence.save({ codeSourceHash: initialCodeHash });
  const npmCommand = (args) =>
    npmPlan(npm, toolchains.node ? toolchains.node.node : process.execPath, args);
  const plan = [
    ['backend-verify', maven, ['-B', '-ntp', 'clean', 'verify'], path.join(root, 'backend')],
    [
      'frontend-install',
      ...npmCommand([
        fs.existsSync(path.join(root, 'frontend', 'package-lock.json')) ? 'ci' : 'install',
        '--no-audit',
        '--no-fund',
      ]),
      path.join(root, 'frontend'),
    ],
    ['frontend-build', ...npmCommand(['run', 'build']), path.join(root, 'frontend')],
    [
      'frontend-test',
      ...npmCommand([
        'run',
        'test',
        '--',
        '--reporter=json',
        '--outputFile=' + path.join(evidence.directory, 'frontend-tests.json'),
      ]),
      path.join(root, 'frontend'),
    ],
    ['frontend-lint', ...npmCommand(['run', 'lint']), path.join(root, 'frontend')],
    ['frontend-format', ...npmCommand(['run', 'format:check']), path.join(root, 'frontend')],
  ];
  evidence.save({
    plan: plan.map(([name, command, args, cwd]) => ({ name, command, args, cwd })),
    toolchain: { javaHome, maven },
  });
  let failed = null;
  for (const [name, command, args, cwd] of plan) {
    if (signal?.aborted) {
      const cancelled = {
        name: 'cancelled',
        status: 1,
        durationMs: 0,
        tail: ['用户取消：剩余阶段未执行'],
      };
      failed = cancelled;
      break;
    }
    progress('stage', '执行 ' + name + '：' + command + ' ' + args.join(' '));
    const stage = await executeVerificationStage({
      name,
      command,
      args,
      cwd,
      env: commandEnv,
      timeoutMs,
      signal,
      directory: evidence.directory,
      root,
    });
    if (stage.status === 0 && name === 'backend-verify') {
      const collected = collectJavaReports(cwd, { suiteId: 'backend', worktree: root });
      const cases = collected.report?.cases || [];
      stage.tests = {
        total: cases.length,
        passed: cases.filter((item) => item.status === 'pass').length,
        skipped: cases.filter((item) => item.status === 'skip').length,
      };
      if (
        !collected.ok ||
        !cases.length ||
        stage.tests.passed !== cases.length ||
        collected.files.some(
          (file) => fs.statSync(file).mtimeMs < Date.parse(stage.startedAt) - 2000,
        )
      ) {
        stage.status = 1;
        stage.tail.push('JUnit 对账失败：必须有本次运行生成且全部通过的真实用例，不能跳过测试。');
      }
      if (collected.ok)
        for (const file of collected.files)
          fs.copyFileSync(file, path.join(evidence.directory, path.basename(file)));
    }
    if (stage.status === 0 && name === 'frontend-test') {
      try {
        const tests = readJson(path.join(evidence.directory, 'frontend-tests.json'));
        stage.tests = {
          total: tests.numTotalTests,
          passed: tests.numPassedTests,
          failed: tests.numFailedTests,
          skipped: tests.numPendingTests,
        };
        if (
          !tests.numTotalTests ||
          tests.numTotalTests !== tests.numPassedTests ||
          tests.success !== true
        )
          throw new Error('测试必须实际执行且全部通过');
      } catch (error) {
        stage.status = 1;
        stage.tail.push('Vitest 对账失败：' + error.message);
      }
    }
    stages.push(stage);
    if (name === 'frontend-install' && stage.status === 0)
      evidence.save({ sourceHash: projectSourceHash(root) });
    evidence.save({ stages });
    progress(
      stage.status === 0 ? 'stage-done' : 'stage-failed',
      name + (stage.status === 0 ? ' 通过' : ' 失败（exit ' + stage.status + '）'),
    );
    if (stage.status !== 0) {
      failed = stage;
      break;
    }
  }

  if (!failed) {
    const startedAt = new Date().toISOString();
    const coverage = reconcileCoverage(root, {
      since: Date.parse(evidence.report.startedAt),
      directory: evidence.directory,
    });
    const log = path.join(evidence.directory, 'coverage.log');
    fs.writeFileSync(log, JSON.stringify(coverage, null, 2) + '\n');
    const stage = {
      name: 'coverage',
      status: coverage.ok ? 0 : 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - Date.parse(startedAt),
      command: 'internal:coverage-reconciliation',
      log: path.relative(root, log).replace(/\\/g, '/'),
      coverage,
      tail: [coverage.ok ? 'Backend/frontend coverage thresholds passed' : coverage.message],
    };
    stages.push(stage);
    evidence.save({ stages });
    if (!coverage.ok) failed = stage;
  }

  if (!failed) {
    if (signal?.aborted) {
      failed = {
        name: 'cancelled',
        status: 1,
        durationMs: 0,
        tail: ['用户取消：运行时冒烟未执行'],
      };
    } else {
      progress('stage', '执行 runtime：启动后端、HTTP CRUD、重启持久化');
      let runtime;
      try {
        runtime = await runRuntimeSmoke({
          root,
          javaHome,
          env: commandEnv,
          signal,
          directory: evidence.directory,
          full,
          npm,
          nodePath: toolchains.node?.node || null,
        });
      } catch (error) {
        runtime = { name: 'runtime', status: 1, tail: [error.message], durationMs: 0 };
      }
      stages.push(runtime);
      if (full && runtime.browser) {
        stages.push(runtime.browser);
        if (runtime.browser.status !== 0) failed = runtime.browser;
      }
      evidence.save({ stages });
      progress(
        runtime.status === 0 && (!full || runtime.browser?.status === 0)
          ? 'stage-done'
          : 'stage-failed',
        'runtime ' +
          (runtime.status === 0 ? '通过' : '失败') +
          (full && runtime.browser
            ? '；browser ' + (runtime.browser.status === 0 ? '通过' : '失败')
            : ''),
      );
      if (runtime.status !== 0) failed = runtime;
    }
  }
  if (
    !failed &&
    (evidence.report.sourceHash !== projectSourceHash(root) ||
      initialCodeHash !== projectSourceHash(root, { ignoreLocks: true }))
  ) {
    failed = {
      name: 'source-changed',
      status: 1,
      tail: ['源码在验证期间变化；先前证据不能标记最终内容通过'],
    };
  }
  const ok = !failed;
  return finish(
    signal?.aborted ? 'cancelled' : ok ? (full ? 'verified' : 'smoke-passed') : 'failed',
    signal?.aborted
      ? 'VERIFY_CANCELLED'
      : ok
        ? full
          ? 'VERIFIED'
          : 'SMOKE_PASSED'
        : 'VERIFY_FAILED',
    ok
      ? [
          full
            ? '完整本地验证通过：后端 verify、前端 build/test/lint/format、HTTP CRUD、浏览器 CRUD 与重启持久化全部通过。'
            : '本地验证通过：后端 verify、前端 build/test/lint/format、启动/CRUD/重启持久化全部通过。',
          'JDK：' + javaHome,
          'Maven：' + maven,
          '报告：.specgate/verify-report.json',
        ].join('\n')
      : [
          '本地验证失败于 ' + failed.name + '；代码已保留，可修复后重试。',
          ...(failed.tail || []).slice(-6).map((line) => '  ' + line),
          '报告：.specgate/verify-report.json',
        ].join('\n'),
    { stages, failedStage: failed ? failed.name : null },
  );
}

/** Serialize verification so installs, builds and the latest report cannot race. */
export async function verifyJavaProject(options = {}) {
  const root = path.resolve(options.root || '.');
  const lock = path.join(root, '.specgate', 'verify.lock');
  if (!fs.existsSync(path.join(root, '.specgate', 'monorepo.json')))
    return verifyJavaProjectUnlocked({ ...options, root });
  if (inspectRunLock(root).locked)
    return {
      ok: false,
      code: 'VERIFY_LOCKED',
      message: '已有 sg-run 正在执行，请等待结束后验证。',
    };
  let fd;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fd = fs.openSync(lock, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid }));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder;
      try {
        holder = readJson(lock);
      } catch {
        return {
          ok: false,
          code: 'VERIFY_LOCKED',
          message: '验证锁损坏，请确认没有运行中的验证后移除 .specgate/verify.lock。',
        };
      }
      if (isProcessAlive(holder.pid))
        return {
          ok: false,
          code: 'VERIFY_LOCKED',
          message: '当前项目已有正在执行的验证，请等待结束。',
        };
      fs.unlinkSync(lock);
    }
  }
  if (fd === undefined) return { ok: false, code: 'VERIFY_LOCKED', message: '无法获取验证锁。' };
  try {
    return await verifyJavaProjectUnlocked({ ...options, root });
  } catch (error) {
    let report = null;
    try {
      report = readJson(path.join(root, '.specgate/verify-report.json'));
      report.ok = false;
      report.status = 'failed';
      report.error = error.message;
      report.finishedAt = new Date().toISOString();
      const text = JSON.stringify(report, null, 2) + '\n';
      fs.writeFileSync(path.join(root, '.specgate/verify-report.json'), text);
      if (/^[\w-]+$/.test(report.runId))
        fs.writeFileSync(
          path.join(root, '.specgate/verify-runs', report.runId, 'report.json'),
          text,
        );
    } catch {
      /* Preserve original error when reporting storage is unavailable. */
    }
    return {
      ok: false,
      code: 'VERIFY_FAILED',
      message: '验证异常，未通过：' + error.message,
      report,
    };
  } finally {
    try {
      fs.closeSync(fd);
    } finally {
      fs.unlinkSync(lock);
    }
  }
}
