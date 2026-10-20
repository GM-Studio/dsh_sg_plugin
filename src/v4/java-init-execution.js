import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { scanEnvironment } from './environment.js';
import { planProvisioning, provisionToolchain, toolchainEnv } from './provision.js';

const FLAGS = ['test', 'format', 'lint', 'review', 'verify', 'installToolchain'];
const STAGES = [
  'installToolchain',
  'preflight',
  'dependencies',
  'format',
  'lint',
  'test',
  'review',
  'verify',
];

/** Strict, side-effect-free validation; omitted flags never authorize execution. */
export function normalizeInitExecution(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['execution must be an object'] };
  }
  const errors = [];
  for (const key of Reflect.ownKeys(input)) {
    if (!FLAGS.includes(key)) errors.push('Unknown execution flag: ' + String(key));
    else if (typeof input[key] !== 'boolean') errors.push(key + ' must be a boolean');
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    execution: Object.fromEntries(
      FLAGS.map((key) => [key, Object.hasOwn(input, key) ? input[key] : false]),
    ),
  };
}

function aborted(signal) {
  if (signal?.aborted) throw new Error('Execution aborted');
}

function executable(command, env) {
  if (path.isAbsolute(command)) return command;
  const names =
    process.platform === 'win32'
      ? [command + '.exe', command + '.cmd', command + '.bat', command]
      : [command];
  for (const dir of String(env.PATH || env.Path || '').split(path.delimiter)) {
    for (const name of names) {
      const file = path.join(dir.replace(/^"|"$/g, ''), name);
      if (fs.existsSync(file)) return file;
    }
  }
  return command;
}

// Resolve npm's Node entry instead of depending on a Unix-only executable or shell.
function commandSpec(command, args, env) {
  const resolved = executable(command, env);
  if (/npm(?:\.cmd|\.exe)?$/i.test(path.basename(resolved))) {
    const candidates = [
      path.join(path.dirname(resolved), 'node_modules/npm/bin/npm-cli.js'),
      path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
      path.join(path.dirname(path.dirname(resolved)), 'lib/node_modules/npm/bin/npm-cli.js'),
    ];
    const cli = candidates.find((file) => fs.existsSync(file));
    if (cli) return { command: process.execPath, args: [cli, ...args], shell: false };
  }
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
  if (shell && [resolved, ...args].some((value) => /["\r\n&|<>^%!]/.test(value))) {
    throw new Error('Unsafe Windows shell command argument');
  }
  if (shell) {
    const quoted = [resolved, ...args].map((value) => '"' + value + '"').join(' ');
    return {
      command: env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', '"' + quoted + '"'],
      shell: false,
      windowsVerbatimArguments: true,
    };
  }
  return { command: resolved, args, shell: false };
}

/** Injectable runner protocol: command requests return {exitCode,stdout,stderr};
 * start requests return {stop():Promise, output():string, exited():boolean}.
 * No implicit success: absent/nonzero exit codes fail command stages.
 */
async function defaultRunner(request) {
  const { command, args, shell, windowsVerbatimArguments } = commandSpec(
    request.command,
    request.args || [],
    request.env,
  );
  aborted(request.signal);
  const child = spawn(command, args, {
    cwd: request.cwd,
    env: request.env,
    shell,
    windowsVerbatimArguments,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '',
    finished = false;
  child.stdout.on('data', (chunk) => {
    stdout = (stdout + chunk).slice(-2 * 1024 * 1024);
  });
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-2 * 1024 * 1024);
  });
  const completion = new Promise((resolve) => {
    child.once('error', (error) => {
      stderr += error.message;
      finished = true;
      resolve({ exitCode: 1, stdout, stderr });
    });
    child.once('close', (exitCode) => {
      finished = true;
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
  let stopping;
  const stop = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (finished) return;
      if (process.platform === 'win32') {
        await new Promise((resolve) => {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          killer.once('error', () => {
            child.kill();
            resolve();
          });
          killer.once('close', resolve);
        });
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill();
        }
        const timer = setTimeout(() => {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }, 2000);
        timer.unref();
        await completion;
        clearTimeout(timer);
      }
      await completion;
    })();
    return stopping;
  };
  const onAbort = () => {
    void stop();
  };
  request.signal?.addEventListener('abort', onAbort, { once: true });
  if (request.kind === 'start') {
    // Surface asynchronous spawn errors before handing ownership to verification.
    await new Promise((resolve) => setImmediate(resolve));
    if (finished) {
      request.signal?.removeEventListener('abort', onAbort);
      throw new Error(stderr || 'Server exited before startup');
    }
    return {
      stop: async () => {
        try {
          await stop();
        } finally {
          request.signal?.removeEventListener('abort', onAbort);
        }
      },
      output: () => stdout + stderr,
      exited: () => finished,
    };
  }
  const timer = setTimeout(() => {
    stderr += '\nCommand timeout';
    void stop();
  }, request.timeoutMs || 600000);
  try {
    return await completion;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onAbort);
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function reviewSources(root) {
  const findings = [],
    repairs = [];
  const skip = new Set(['node_modules', 'target', 'dist', '.git', '.specgate']);
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(item.name) || item.isSymbolicLink()) continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(file);
        continue;
      }
      if (!/\.(java|ts|js|vue|xml|properties|json)$/.test(item.name)) continue;
      const text = fs.readFileSync(file, 'utf8');
      // JSON cannot contain raw newlines in strings: trimming trailing line whitespace
      // is safe after validating JSON. Do not touch Java/TS/Vue multiline literals.
      if (item.name.endsWith('.json')) {
        JSON.parse(text);
        const repaired = text.replace(/[\t ]+$/gm, '');
        if (repaired !== text) {
          fs.writeFileSync(file, repaired);
          repairs.push(path.relative(root, file));
        }
      }
      text.split(/\r?\n/).forEach((line, index) => {
        if (
          /\b(?:TODO|FIXME|XXX)\b/.test(line) ||
          /(?:password|secret)\s*[:=]\s*["'][^"']+["']/i.test(line)
        ) {
          findings.push(
            path.relative(root, file) + ':' + (index + 1) + ': requires human inspection',
          );
        }
      });
    }
  }
  for (const side of ['backend', 'frontend']) walk(path.join(root, side));
  const pom = fs.readFileSync(path.join(root, 'backend/pom.xml'), 'utf8');
  if (!/<java\.version>[^<]+<\/java\.version>/.test(pom))
    findings.push('backend/pom.xml: java.version missing');
  return {
    ok: findings.length === 0,
    findings,
    repairs,
    logs: [
      'Deterministic source checks only; no AI review, security audit, or manual signoff.',
      ...findings,
      ...repairs.map((file) => 'Trimmed trailing whitespace: ' + file),
    ],
  };
}

/** Read-only toolchain probes for callers before generating any project files.
 * Explicit installation defers these probes until after provisioning.
 */
export async function preflightJavaInit(options = {}) {
  const javaVersion = String(options.javaVersion || '8');
  const javaToken = javaVersion === '8' ? '1.8' : javaVersion;
  const javaPattern = new RegExp(
    '(?:version\\s+["\']?)' + javaToken.replace('.', '\\.') + '(?:[._\\s"\']|$)',
  );
  const normalized = normalizeInitExecution(options.execution);
  if (!normalized.ok) return normalized;
  const flags = normalized.execution;
  if (flags.installToolchain || !(flags.test || flags.format || flags.lint || flags.verify)) {
    return { ok: true, status: 'skipped', logs: [] };
  }
  const tools = options.toolchain || {};
  const env = toolchainEnv(tools, { ...process.env, ...(options.env || {}) });
  const home = tools.java?.home || env.JAVA_HOME;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const checks = [
    [
      tools.java?.path || (home ? path.join(home, 'bin', 'java' + suffix) : 'java'),
      ['-version'],
      javaPattern,
      'Java',
    ],
    [
      home ? path.join(home, 'bin', 'javac' + suffix) : 'javac',
      ['-version'],
      new RegExp('javac\\s+' + javaToken.replace('.', '\\.') + '(?:[._\\s"\']|$)'),
      'javac',
    ],
    [
      tools.maven?.path || env.MAVEN_CMD || 'mvn',
      ['-version'],
      new RegExp('Java version:\\s*' + javaToken.replace('.', '\\.') + '(?:[._\\s,]|$)'),
      'Maven',
    ],
    [tools.npm?.path || 'npm', ['--version'], /\d+\.\d+/, 'npm'],
  ];
  const logs = [];
  try {
    let cwd = path.resolve(options.root || process.cwd());
    while (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      const parent = path.dirname(cwd);
      if (parent === cwd) throw new Error('No existing directory for toolchain preflight');
      cwd = parent;
    }
    for (const [command, args, pattern, label] of checks) {
      aborted(options.signal);
      const result = await (options.runner || defaultRunner)({
        stage: 'preflight',
        kind: 'command',
        command,
        args,
        cwd,
        env,
        signal: options.signal,
        timeoutMs: options.commandTimeoutMs || 15000,
      });
      const output = String(result?.stdout || '') + String(result?.stderr || '');
      logs.push([command, ...args].join(' '), output);
      if (result?.ok === false || (result?.exitCode ?? result?.status) !== 0)
        throw new Error(label + ' probe failed: ' + (result?.error || output));
      if (!pattern.test(output))
        throw new Error(
          label === 'npm'
            ? 'npm version unavailable'
            : label + ' must actually use Java ' + javaVersion + ' (not a different JDK)',
        );
    }
    aborted(options.signal);
    return { ok: true, status: 'passed', logs };
  } catch (error) {
    return { ok: false, status: 'failed', errors: [error.message], logs };
  }
}

async function installDefault({ root, env, signal, disclose, jdk = '8' }) {
  aborted(signal);
  const environment = await scanEnvironment({ root, env, skipNetwork: true });
  const plan = planProvisioning({
    environment,
    selection: {
      sides: [
        { stack: 'java', jdk: String(jdk), buildTool: 'maven' },
        { stack: 'vue', packageManager: 'npm' },
      ],
    },
    allowDownload: true,
  });
  if (!plan.ok) return plan;
  for (const action of plan.actions)
    disclose('Toolchain download/install: ' + (action.url || action.tool));
  const result = await provisionToolchain({ root, plan });
  aborted(signal);
  return result;
}

/** Reports only phases actually run. Preflight failures do not write to the project.
 * Network attempts are disclosed; observed downloads are distinct from cache hits.
 */
export async function executeJavaInit(options = {}) {
  const normalized = normalizeInitExecution(options.execution);
  const report = {
    ok: normalized.ok,
    execution: normalized.execution,
    stages: STAGES.map((name) => ({ name, status: 'skipped', logs: [] })),
    network: { attempted: false, observed: false, disclosures: [] },
    limitations: [
      'Review is deterministic, not AI/manual signoff; no automatic semantic repair.',
      'Runtime verification exercises HTTP APIs and frontend serving, not a browser UI.',
      'Network evidence distinguishes disclosed repository attempts from observed download logs; cache hits are not downloads.',
      'Existing toolchain provisioning helpers check cancellation between operations, not during their internal download/extraction.',
    ],
    logs: [],
  };
  if (!normalized.ok) {
    report.errors = normalized.errors;
    return report;
  }
  const flags = normalized.execution;
  if (!Object.values(flags).some(Boolean)) return report;
  if (
    typeof options.root !== 'string' ||
    !options.root.trim() ||
    !fs.existsSync(options.root) ||
    !fs.statSync(options.root).isDirectory()
  ) {
    report.ok = false;
    report.errors = ['root must be an existing project directory'];
    return report;
  }
  const root = path.resolve(options.root),
    runner = options.runner || defaultRunner;
  let javaVersion = '8';
  try {
    javaVersion = String(
      JSON.parse(fs.readFileSync(path.join(root, '.specgate', 'monorepo.json'), 'utf8')).jdk || '8',
    );
  } catch {
    javaVersion = '8';
  }
  const signal = options.signal;
  let env = { ...process.env, ...(options.env || {}) },
    tools = options.toolchain || {};
  let writeReport = false;
  const needsDependencies = flags.test || flags.format || flags.lint || flags.verify;
  const disclose = (text) => {
    report.network.attempted = true;
    report.network.disclosures.push(text);
    report.logs.push(text);
    options.onLog?.(text);
  };
  const stageByName = (name) => report.stages.find((stage) => stage.name === name);
  async function stage(name, fn) {
    const evidence = stageByName(name),
      start = Date.now();
    try {
      aborted(signal);
      const result = await fn(evidence);
      aborted(signal);
      if (result?.logs) evidence.logs.push(...result.logs);
      if (result?.ok === false)
        throw new Error(
          result.message ||
            result.errors?.join('; ') ||
            result.findings?.join('; ') ||
            name + ' failed',
        );
      evidence.status = 'passed';
      return result;
    } catch (error) {
      evidence.status = 'failed';
      evidence.logs.push(error.message || String(error));
      report.ok = false;
      throw error;
    } finally {
      evidence.durationMs = Date.now() - start;
    }
  }
  async function command(stageName, commandName, args, cwd, network = false) {
    if (network)
      disclose(
        stageName +
          ': ' +
          [commandName, ...args].join(' ') +
          ' may contact configured dependency repositories (including plugin resolution).',
      );
    aborted(signal);
    const result = await runner({
      stage: stageName,
      kind: 'command',
      command: commandName,
      args,
      cwd,
      env,
      signal,
      timeoutMs: options.commandTimeoutMs || 600000,
    });
    const text = [result?.stdout, result?.stderr, result?.error].filter(Boolean).join('\n');
    stageByName(stageName).logs.push([commandName, ...args].join(' '), text);
    if (
      /Downloading(?: from)?|Downloaded(?: from)?|https?:\/\/.*(?:GET|download)|npm http fetch/i.test(
        text,
      )
    )
      report.network.observed = true;
    const exitCode = result?.exitCode ?? result?.status;
    if (result?.ok === false || exitCode !== 0)
      throw new Error(
        commandName + ' exited with ' + String(exitCode) + (text ? ': ' + text.slice(-2000) : ''),
      );
    aborted(signal);
    return result;
  }
  const backend = path.join(root, 'backend'),
    frontend = path.join(root, 'frontend');
  const mvn = () => tools.maven?.path || env.MAVEN_CMD || 'mvn';
  const java = () =>
    tools.java?.path ||
    (env.JAVA_HOME
      ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      : 'java');
  try {
    if (flags.installToolchain) {
      writeReport = true; // Explicit provisioning can mutate the project even on failure.
      const result = await stage('installToolchain', () =>
        (options.installer || installDefault)({
          root,
          env,
          signal,
          disclose,
          runner,
          jdk: javaVersion,
        }),
      );
      if (result?.completed?.some((action) => action.url && action.reused === false))
        report.network.observed = true;
      stageByName('installToolchain').logs.push(
        ...(result?.completed || []).map(
          (action) =>
            (action.reused ? 'Reused ' : 'Installed ') +
            action.tool +
            ': ' +
            (action.path || action.target),
        ),
      );
      tools = { ...tools, ...(result?.tools || {}) };
      env = toolchainEnv(tools, env);
    } else env = toolchainEnv(tools, env);
    await stage('preflight', async () => {
      for (const file of ['backend/pom.xml', 'frontend/package.json'])
        if (!fs.existsSync(path.join(root, file)))
          throw new Error('Missing generated file: ' + file);
      if (needsDependencies) {
        // Provisioned tools must also pass actual Java 8 probes.
        const result = await preflightJavaInit({
          root,
          execution: { ...flags, installToolchain: false },
          javaVersion,
          env,
          toolchain: tools,
          runner,
          signal,
          commandTimeoutMs: options.commandTimeoutMs,
        });
        stageByName('preflight').logs.push(...result.logs);
        if (!result.ok) throw new Error(result.errors.join('; '));
      }
    });
    writeReport = true;
    if (needsDependencies)
      await stage('dependencies', async () => {
        await command(
          'dependencies',
          tools.npm?.path || 'npm',
          ['install', '--package-lock=false', '--no-audit', '--no-fund', '--loglevel=http'],
          frontend,
          true,
        );
        await command('dependencies', mvn(), ['-B', 'dependency:resolve'], backend, true);
      });
    for (const [name, goal, script] of [
      [
        'format',
        options.formatCheck ? 'spotless:check' : 'spotless:apply',
        options.formatCheck ? 'format:check' : 'format',
      ],
      ['lint', 'checkstyle:check', 'lint'],
      ['test', 'test', 'test'],
    ]) {
      if (flags[name])
        await stage(name, async () => {
          await command(name, mvn(), ['-B', goal], backend, true);
          await command(name, tools.npm?.path || 'npm', ['run', script], frontend);
        });
    }
    if (flags.review) await stage('review', () => reviewSources(root));
    if (flags.verify)
      await stage('verify', async (evidence) => {
        await command('verify', mvn(), ['-B', '-DskipTests', 'package'], backend, true);
        await command('verify', tools.npm?.path || 'npm', ['run', 'build'], frontend);
        return verifyRuntime({
          ...options,
          root,
          backend,
          frontend,
          runner,
          env,
          java: java(),
          signal,
          evidence,
        });
      });
  } catch (error) {
    report.ok = false;
    report.errors = [error.message || String(error)];
  }
  for (const evidence of report.stages)
    report.logs.push(...evidence.logs.map((line) => evidence.name + ': ' + line));
  if (writeReport) {
    try {
      const file = path.join(root, '.specgate', 'java-init-execution.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
      report.reportPath = file;
    } catch (error) {
      report.ok = false;
      report.errors = [...(report.errors || []), 'Cannot write execution report: ' + error.message];
    }
  }
  return report;
}

async function verifyRuntime(options) {
  const { root, backend, frontend, runner, env, java, signal, evidence } = options;
  const ports = {
    backend: options.backendPort || (await freePort()),
    frontend: options.frontendPort || (await freePort()),
  };
  const base = 'http://127.0.0.1:' + ports.backend;
  const front = 'http://127.0.0.1:' + ports.frontend;
  const endpoint = options.crudPath || '/api/tasks';
  const payload = options.crudPayload || {
    title: 'SpecGate runtime ' + randomUUID(),
    completed: false,
  };
  const updated = { ...payload, title: payload.title + ' updated', completed: true };
  const handles = new Set();
  const http = options.fetch || globalThis.fetch;
  let backendHandle, createdId;
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  const dbDir = fs.mkdtempSync(path.join(root, '.specgate', 'verify-db-'));
  // Separate file DB protects user data while proving persistence across actual restarts.
  const dbUrl = 'jdbc:h2:file:' + path.join(dbDir, 'tasks').replace(/\\/g, '/');
  async function request(url, method = 'GET', body) {
    aborted(signal);
    const response = await http(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(options.httpTimeoutMs || 5000)])
        : AbortSignal.timeout(options.httpTimeoutMs || 5000),
    });
    const text = await response.text();
    evidence.logs.push(method + ' ' + url + ' -> ' + response.status);
    return {
      status: response.status,
      text,
      json: text
        ? (() => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          })()
        : null,
    };
  }
  function expect(condition, message) {
    if (!condition) throw new Error(message);
  }
  async function ready(url, handle) {
    const deadline = Date.now() + (options.startupTimeoutMs || 60000);
    while (Date.now() < deadline) {
      aborted(signal);
      if (handle.exited?.()) throw new Error('Server exited: ' + (handle.output?.() || ''));
      try {
        const response = await request(url);
        if (response.status === 200) return response;
      } catch (error) {
        if (signal?.aborted) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Server readiness timeout: ' + url + '\n' + (handle.output?.() || ''));
  }
  async function start(side) {
    const target = fs.existsSync(path.join(backend, 'target'))
      ? fs
          .readdirSync(path.join(backend, 'target'))
          .filter(
            (name) =>
              name.endsWith('.jar') &&
              !name.endsWith('-sources.jar') &&
              !name.endsWith('-javadoc.jar'),
          )
      : [];
    if (side === 'backend' && !options.backendJar && target.length !== 1)
      throw new Error('Expected exactly one executable backend jar');
    const request =
      side === 'backend'
        ? {
            command: java,
            args: [
              '-jar',
              options.backendJar || path.join(backend, 'target', target[0]),
              '--server.address=127.0.0.1',
              '--server.port=' + ports.backend,
              '--spring.datasource.url=' + dbUrl,
            ],
            cwd: backend,
          }
        : {
            command: process.execPath,
            args: [
              path.join(frontend, 'node_modules/vite/bin/vite.js'),
              '--host',
              '127.0.0.1',
              '--port',
              String(ports.frontend),
              '--strictPort',
            ],
            cwd: frontend,
          };
    const handle = await runner({
      stage: 'verify',
      kind: 'start',
      side,
      ...request,
      env: {
        ...env,
        BACKEND_PORT: String(ports.backend),
        FRONTEND_PORT: String(ports.frontend),
        DB_URL: dbUrl,
        DB_USER: 'sa',
        DB_PASSWORD: '',
        SPEC_GATE_BACKEND_PORT: String(ports.backend),
      },
      signal,
    });
    if (!handle || typeof handle.stop !== 'function')
      throw new Error('Start runner must return a stoppable process handle');
    handles.add(handle);
    return handle;
  }
  async function stop(handle) {
    if (!handle) return;
    await handle.stop();
    handles.delete(handle);
    if (handle.output?.()) evidence.logs.push(handle.output());
  }
  let runtimeError;
  const cleanupFailures = [];
  try {
    backendHandle = await start('backend');
    const frontendHandle = await start('frontend');
    const list = await ready(base + endpoint, backendHandle);
    expect(Array.isArray(list.json), 'List must return an array');
    const html = await ready(front + '/', frontendHandle);
    expect(/<html|<!doctype html/i.test(html.text), 'Frontend must serve actual HTML');
    const proxied = await request(front + endpoint);
    expect(
      proxied.status === 200 && Array.isArray(proxied.json),
      'Frontend API proxy must reach backend',
    );
    const invalid = await request(base + endpoint, 'POST', {});
    expect(invalid.status === 400, 'Invalid create must return 400');
    const created = await request(base + endpoint, 'POST', payload);
    expect(created.status === 201 && created.json?.id != null, 'Create must return 201 and id');
    createdId = created.json.id;
    const itemUrl = base + endpoint + '/' + encodeURIComponent(createdId);
    const read = await request(itemUrl);
    expect(
      read.status === 200 && read.json?.title === payload.title,
      'Read must return created task',
    );
    const update = await request(itemUrl, 'PUT', updated);
    expect(
      update.status === 200 &&
        update.json?.title === updated.title &&
        update.json?.completed === true,
      'Update must persist fields',
    );
    await stop(backendHandle);
    backendHandle = await start('backend');
    await ready(base + endpoint, backendHandle);
    const persisted = await request(itemUrl);
    expect(
      persisted.status === 200 &&
        persisted.json?.title === updated.title &&
        persisted.json?.completed === true,
      'Task must persist across backend restart',
    );
    evidence.logs.push('File database persistence verified across backend restart.');
    const deleted = await request(itemUrl, 'DELETE');
    expect(deleted.status === 204, 'Delete must return 204');
    const missing = await request(itemUrl);
    expect(missing.status === 404, 'Deleted task must return 404');
  } catch (error) {
    runtimeError = error;
  } finally {
    const failures = cleanupFailures;
    for (const handle of [...handles].reverse()) {
      try {
        await stop(handle);
      } catch (error) {
        failures.push(error.message);
      }
    }
    // Keep diagnostic DB only if cleanup itself fails; do not hide leaked processes.
    if (!failures.length) {
      try {
        fs.rmSync(dbDir, { recursive: true, force: true });
      } catch (error) {
        failures.push('Scratch database cleanup: ' + error.message);
      }
    }
    evidence.logs.push(
      'Runtime process cleanup ' +
        (failures.length ? 'failed: ' + failures.join('; ') : 'completed'),
    );
  }
  if (runtimeError && cleanupFailures.length) {
    throw new AggregateError(
      [runtimeError, ...cleanupFailures.map((message) => new Error(message))],
      runtimeError.message + '; Runtime cleanup failed: ' + cleanupFailures.join('; '),
    );
  }
  if (runtimeError) throw runtimeError;
  if (cleanupFailures.length)
    throw new Error('Runtime cleanup failed: ' + cleanupFailures.join('; '));
  return { ok: true };
}
