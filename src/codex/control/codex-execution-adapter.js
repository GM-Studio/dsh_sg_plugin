import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const MAX_CAPTURE = 2 * 1024 * 1024;
const DEFAULT_SERVER_PATH = fileURLToPath(new URL('../server.js', import.meta.url));
const FORBIDDEN_CHILD_ENV = new Set(['SPECGATE_FEISHU_WEBHOOK_URL', 'SPECGATE_MFA_SECRET']);

export function extractSessionId(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  for (const key of ['session_id', 'sessionId', 'thread_id', 'threadId']) {
    if (typeof value[key] === 'string' && value[key].length <= 256) return value[key];
  }
  if (value.thread && typeof value.thread === 'object') {
    if (typeof value.thread.id === 'string' && value.thread.id.length <= 256)
      return value.thread.id;
    const nested = extractSessionId(value.thread, seen);
    if (nested) return nested;
  }
  for (const entry of Object.values(value)) {
    const nested = extractSessionId(entry, seen);
    if (nested) return nested;
  }
  return null;
}

function redact(value) {
  return String(value || '')
    .replace(/[A-Za-z]:[\\/][^\s"'`]+/g, '<local-path>')
    .replace(/\/(?:tmp|home|Users|opt|var|private)\/[^\s"'`]+/g, '<local-path>')
    .replace(
      /(?:\bBearer\s+[A-Za-z0-9._~+/-]{12,}|\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]{6,})/gi,
      '<redacted>',
    )
    .slice(-16000);
}

function controlConfigArgs(projectRoot, serverPath, childEnvironment = {}) {
  const serverEnvironment = {
    SPECGATE_NATIVE_AGENTS: '1',
    SPECGATE_INTERACTIVE_APPROVAL: '1',
    ...(childEnvironment.SPECGATE_WORK_ITEM_ID
      ? { SPECGATE_WORK_ITEM_ID: childEnvironment.SPECGATE_WORK_ITEM_ID }
      : {}),
    ...(childEnvironment.SPECGATE_CONTROL_HOME
      ? { SPECGATE_CONTROL_HOME: childEnvironment.SPECGATE_CONTROL_HOME }
      : {}),
  };
  const serverEnvToml = `{ ${Object.entries(serverEnvironment)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join(', ')} }`;
  return [
    '--config',
    'approval_policy="never"',
    '--config',
    'mcp_servers={}',
    '--config',
    'plugins={}',
    '--config',
    `mcp_servers.specgate_control.command=${JSON.stringify(process.execPath)}`,
    '--config',
    `mcp_servers.specgate_control.args=${JSON.stringify([
      serverPath,
      '--project-root',
      projectRoot,
    ])}`,
    '--config',
    `mcp_servers.specgate_control.env=${serverEnvToml}`,
    '--config',
    'mcp_servers.specgate_control.startup_timeout_sec=20',
  ];
}

function commandArgs({ mode, projectRoot, sessionId, serverPath, childEnvironment }) {
  if (mode === 'resume')
    return [
      'exec',
      'resume',
      sessionId,
      '--json',
      ...controlConfigArgs(projectRoot, serverPath, childEnvironment),
    ];
  return [
    'exec',
    '--json',
    '--color',
    'never',
    ...controlConfigArgs(projectRoot, serverPath, childEnvironment),
    '--sandbox',
    'workspace-write',
    '--cd',
    projectRoot,
  ];
}

function terminateProcessTree(child, platform = process.platform) {
  if (!child?.pid) return;
  if (platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on?.('error', () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // The close event or timeout remains the observable failure.
      }
    });
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // The close event or timeout remains the observable failure.
  }
}

export function createCodexExecutionAdapter({
  command = 'codex',
  spawnImpl = spawn,
  clock = Date.now,
  timeoutMs = 2 * 60 * 60 * 1000,
  env = process.env,
  serverPath = DEFAULT_SERVER_PATH,
  terminate = terminateProcessTree,
  platform = process.platform,
} = {}) {
  if (typeof command !== 'string' || !command) throw new TypeError('Codex command is required');
  if (typeof spawnImpl !== 'function') throw new TypeError('spawnImpl must be a function');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new TypeError('timeoutMs must be a positive integer');

  async function run({
    mode = 'start',
    projectRoot,
    sessionId = null,
    prompt,
    onEvent,
    onSession,
    signal,
    environment = {},
  } = {}) {
    if (!['start', 'resume'].includes(mode))
      return failure('INVALID_ARGUMENT', 'Execution mode must be start or resume');
    if (typeof projectRoot !== 'string' || !projectRoot || !path.isAbsolute(projectRoot))
      return failure('INVALID_ARGUMENT', 'An absolute project root is required');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 64000)
      return failure('INVALID_ARGUMENT', 'A bounded execution prompt is required');
    if (mode === 'resume' && (typeof sessionId !== 'string' || !sessionId))
      return failure('INVALID_ARGUMENT', 'A persisted Codex session id is required');
    if (signal?.aborted) return failure('CANCELLED', 'Execution was cancelled before start');

    const args = [
      ...commandArgs({
        mode,
        projectRoot,
        sessionId,
        serverPath: path.resolve(serverPath),
        childEnvironment: environment,
      }),
      prompt,
    ];
    const boundedEnv = Object.fromEntries(
      Object.entries(env).filter(([key]) => !FORBIDDEN_CHILD_ENV.has(key)),
    );
    return new Promise((resolve) => {
      let child;
      try {
        child = spawnImpl(command, args, {
          cwd: projectRoot,
          env: {
            ...boundedEnv,
            ...environment,
            SPECGATE_PROJECT_ROOT: projectRoot,
            SPECGATE_CONTROL_MODE: '1',
          },
          detached: platform !== 'win32',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        resolve(failure('CODEX_START_FAILED', 'Codex execution could not start'));
        return;
      }
      let stdoutBuffer = '';
      let stderr = '';
      let eventOutput = '';
      let parsedEvents = 0;
      let sessionIdFound = mode === 'resume' ? sessionId : null;
      let settled = false;
      let timedOut = false;
      const startedAt = new Date(clock()).toISOString();
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve({
          mode,
          startedAt,
          finishedAt: new Date(clock()).toISOString(),
          stdoutTail: redact(eventOutput),
          stderrTail: redact(stderr),
          sessionId: sessionIdFound,
          parsedEvents,
          ...result,
        });
      };
      const abort = () => {
        terminate(child, platform);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        abort();
      }, timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      const consumeLine = (line) => {
        if (!line.trim()) return;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          stderr = `${stderr}\nInvalid JSONL from Codex`.slice(-MAX_CAPTURE);
          return;
        }
        parsedEvents += 1;
        eventOutput = `${eventOutput}${line}\n`.slice(-MAX_CAPTURE);
        const extractedSession = extractSessionId(event);
        if (extractedSession && extractedSession !== sessionIdFound) {
          sessionIdFound = extractedSession;
          try {
            onSession?.(extractedSession);
          } catch {
            // Session persistence is retried through the final execution result.
          }
        }
        try {
          onEvent?.(event);
        } catch {
          // Projection failures do not corrupt the execution protocol.
        }
      };
      child.stdout?.on('data', (chunk) => {
        stdoutBuffer += String(chunk);
        let newline;
        while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
          consumeLine(stdoutBuffer.slice(0, newline));
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
        }
        if (stdoutBuffer.length > MAX_CAPTURE) stdoutBuffer = stdoutBuffer.slice(-MAX_CAPTURE);
      });
      child.stderr?.on('data', (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-MAX_CAPTURE);
      });
      child.on?.('error', (error) => {
        finish({
          ok: false,
          code: 'CODEX_START_FAILED',
          message: redact(error?.message || 'Codex process failed'),
          exitCode: null,
        });
      });
      child.on?.('close', (code, signalName) => {
        if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
        if (timedOut) {
          finish({
            ok: false,
            code: 'CODEX_TIMEOUT',
            message: 'Codex execution exceeded its time limit',
            exitCode: code,
            signal: signalName,
          });
          return;
        }
        if (signal?.aborted) {
          finish({
            ok: false,
            code: 'CANCELLED',
            message: 'Codex execution was cancelled',
            exitCode: code,
            signal: signalName,
          });
          return;
        }
        finish({
          ok: code === 0 && parsedEvents > 0,
          code: code === 0 && parsedEvents > 0 ? undefined : 'CODEX_EXECUTION_FAILED',
          message:
            code === 0 && parsedEvents > 0
              ? undefined
              : 'Codex execution failed or produced no machine events',
          exitCode: code,
          signal: signalName,
        });
      });
    });
  }

  return Object.freeze({
    run,
    start: (input) => run({ ...input, mode: 'start' }),
    resume: (input) => run({ ...input, mode: 'resume' }),
  });
}
