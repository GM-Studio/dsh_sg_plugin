/**
 * Host Codex capability detection, explicit degradation policy and version gate hint.
 *
 * `detectCapabilities({ exec })` is a pure, injectable probe: it performs no host
 * access of its own beyond the injected command runner, so tests can simulate any
 * host. A capability is never derived from a version string — only from what the
 * injected runner observes. Probes are read-only (help surfaces only),
 * non-interactive (stdin is never attached) and bounded by a timeout, so a hung or
 * prompting host cannot block the command and the host is never mutated.
 *
 * Capability states are exactly `available`, `missing` or `not-probed`.
 */

import { spawn } from 'node:child_process';

export const CAPABILITY_NAMES = Object.freeze([
  'plugin',
  'execJson',
  'nativeAgents',
  'elicitation',
]);

export const CAPABILITY_STATES = Object.freeze(['available', 'missing', 'not-probed']);

export const DEFAULT_PROBE_TIMEOUT_MS = 4000;
const MAX_CAPTURE = 64 * 1024;

/**
 * Read-only probe contract, expressed as data. Every probe runs a `--help` surface
 * only; no mutating subcommand is ever issued and no stdin is attached. `signal`
 * is matched against the probe output so an existing subcommand that does not
 * advertise the feature is reported as `missing` rather than guessed.
 */
export const CAPABILITY_PROBES = Object.freeze({
  plugin: Object.freeze({
    capability: 'plugin',
    args: Object.freeze(['plugin', '--help']),
    signal: /plugin/i,
    readOnly: true,
  }),
  execJson: Object.freeze({
    capability: 'execJson',
    args: Object.freeze(['exec', '--help']),
    signal: /--json\b/,
    readOnly: true,
  }),
  nativeAgents: Object.freeze({
    capability: 'nativeAgents',
    args: Object.freeze(['agents', '--help']),
    signal: /agent/i,
    readOnly: true,
  }),
  elicitation: Object.freeze({
    capability: 'elicitation',
    args: Object.freeze(['mcp', '--help']),
    signal: /elicit/i,
    readOnly: true,
  }),
});

export const DEGRADATION_MODE = Object.freeze({
  NATIVE: 'native',
  PROJECT_ROUTE: 'project-mcp-skill',
});

/**
 * Degradation policy as data. A capability is "usable" only when `available`; an
 * unconfirmed (`not-probed`) or absent (`missing`) capability degrades
 * conservatively so behavior is never silently wrong.
 */
export const DEGRADATION_POLICY = Object.freeze([
  Object.freeze({
    capability: 'plugin',
    unusableStates: Object.freeze(['missing', 'not-probed']),
    mode: DEGRADATION_MODE.PROJECT_ROUTE,
    degradation: 'plugin-unavailable',
  }),
  Object.freeze({
    capability: 'execJson',
    unusableStates: Object.freeze(['missing', 'not-probed']),
    mode: DEGRADATION_MODE.PROJECT_ROUTE,
    degradation: 'exec-json-unavailable',
  }),
  Object.freeze({
    capability: 'nativeAgents',
    unusableStates: Object.freeze(['missing', 'not-probed']),
    blocked: 'subagents',
    degradation: 'subagent-dispatch-unavailable',
  }),
  Object.freeze({
    capability: 'elicitation',
    unusableStates: Object.freeze(['missing', 'not-probed']),
    blocked: 'interactive-gates',
    degradation: 'interactive-gates-pending',
  }),
]);

/** Capabilities whose absence forces an explicit refusal rather than a degraded run. */
export const REQUIRED_CAPABILITIES = Object.freeze(['execJson']);

function normalizeState(value) {
  return CAPABILITY_STATES.includes(value) ? value : 'not-probed';
}

function normalizeReport(capabilities = {}) {
  const source = capabilities && typeof capabilities === 'object' ? capabilities : {};
  return Object.fromEntries(CAPABILITY_NAMES.map((name) => [name, normalizeState(source[name])]));
}

function interpretProbe(result, probe) {
  if (result === undefined || result === null) return 'not-probed';
  if (result.timedOut) return 'not-probed';
  if (result.error) return result.error.code === 'ENOENT' ? 'missing' : 'not-probed';
  // A probe terminated by a signal (no exit status) is inconclusive, not absent.
  if ((result.status === null || result.status === undefined) && result.signal) return 'not-probed';
  const status =
    result.status === undefined || result.status === null
      ? result.ok === true
        ? 0
        : 1
      : result.status;
  if (status !== 0) return 'missing';
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (probe.signal && !probe.signal.test(text)) return 'missing';
  return 'available';
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true });
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ probeError: error });
      },
    );
  });
}

async function runProbe({ exec, capability, timeoutMs }) {
  const probe = CAPABILITY_PROBES[capability];
  let outcome;
  try {
    outcome = await withTimeout(
      exec({ capability, args: [...probe.args], timeoutMs, readOnly: true }),
      timeoutMs,
    );
  } catch (error) {
    return error?.code === 'ENOENT' ? 'missing' : 'not-probed';
  }
  if (outcome && outcome.probeError) {
    return outcome.probeError.code === 'ENOENT' ? 'missing' : 'not-probed';
  }
  return interpretProbe(outcome, probe);
}

/**
 * Probe host Codex capabilities with an injectable command runner.
 *
 * @param {object} [options]
 * @param {(request: { capability: string, args: string[], timeoutMs: number }) => Promise<object>} [options.exec]
 *   Injected runner. When omitted every capability is reported `not-probed` and the
 *   host is never touched.
 * @param {number} [options.timeoutMs] Hard per-probe timeout ceiling.
 * @returns {Promise<{plugin: string, execJson: string, nativeAgents: string, elicitation: string}>}
 */
export async function detectCapabilities({ exec, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  const report = normalizeReport();
  if (typeof exec !== 'function') return report;
  const bound =
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_PROBE_TIMEOUT_MS;
  await Promise.all(
    CAPABILITY_NAMES.map(async (capability) => {
      report[capability] = await runProbe({ exec, capability, timeoutMs: bound });
    }),
  );
  return report;
}

/**
 * Map a capability report to the runtime mode, the explicit degradations and the
 * capabilities that are blocked. Never throws and never fails silently: an
 * unconfirmed capability degrades conservatively.
 *
 * @returns {{mode: string, degradations: string[], blocked: string[], versionGateHint: string}}
 */
export function describeDegradation(capabilities = {}) {
  const states = normalizeReport(capabilities);
  let mode = DEGRADATION_MODE.NATIVE;
  const degradations = [];
  const blocked = [];
  for (const rule of DEGRADATION_POLICY) {
    if (!rule.unusableStates.includes(states[rule.capability])) continue;
    degradations.push(rule.degradation);
    if (rule.mode) mode = rule.mode;
    if (rule.blocked) blocked.push(rule.blocked);
  }
  return {
    mode,
    degradations,
    blocked,
    versionGateHint: versionGateHint(states),
  };
}

/**
 * Version gate hint: explicit refusal or degradation notice with upgrade guidance.
 * Always a string; the host version is never used as the decision input.
 */
export function versionGateHint(capabilities = {}) {
  const states = normalizeReport(capabilities);
  const missing = CAPABILITY_NAMES.filter((name) => states[name] === 'missing');
  const unprobed = CAPABILITY_NAMES.filter((name) => states[name] === 'not-probed');

  if (missing.length === 0 && unprobed.length === 0) {
    return 'Host Codex reports every required capability; no upgrade is required.';
  }

  const parts = [];
  if (REQUIRED_CAPABILITIES.some((name) => missing.includes(name))) {
    parts.push(
      'Codex must provide `exec --json`; upgrade the Codex CLI before delivery can start.',
    );
  }
  if (missing.includes('plugin')) {
    parts.push('Native plugin support is absent; run through the project-level MCP + skill path.');
  }
  if (missing.includes('nativeAgents')) {
    parts.push('Native subagent dispatch is absent; subagents are blocked.');
  }
  if (missing.includes('elicitation')) {
    parts.push('MCP elicitation is absent; interactive gates stay pending.');
  }
  if (unprobed.length > 0) {
    parts.push(
      `Capabilities (${unprobed.join(', ')}) could not be confirmed and are treated as unavailable; re-run after checking the host.`,
    );
  }
  return parts.join(' ');
}

/**
 * Bounded, non-interactive, read-only probe runner built on an injectable
 * `spawnSync`-style implementation. Used by `doctor` so the probe honors the same
 * sync seam as the existing Codex version check.
 */
export function createSyncProbeRunner({
  command = 'codex',
  spawnSyncImpl,
  cwd = process.cwd(),
  env = {},
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
} = {}) {
  if (typeof spawnSyncImpl !== 'function') throw new TypeError('spawnSyncImpl must be a function');
  return async function exec({ args = [], timeoutMs: perCall } = {}) {
    const bound = Number.isSafeInteger(perCall) && perCall > 0 ? perCall : Math.max(1, timeoutMs);
    let result;
    try {
      result = spawnSyncImpl(command, args, {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        timeout: bound,
        // stdin is never attached: a prompting host cannot block the probe.
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        maxBuffer: MAX_CAPTURE,
      });
    } catch (error) {
      return { ok: false, error };
    }
    if (!result) return { ok: false, status: null };
    const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
    return {
      ok: result.status === 0,
      status: result.status ?? null,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error,
      signal: result.signal ?? null,
      timedOut,
    };
  };
}

/**
 * Bounded, non-interactive, read-only probe runner built on an injectable async
 * `spawn`. stdin is always `ignore`, the process tree is terminated on timeout and
 * output is capped, so a prompting or hung host cannot block or mutate anything.
 */
export function createBoundedRunner({
  command = 'codex',
  spawnImpl = spawn,
  cwd = process.cwd(),
  env = {},
  platform = process.platform,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
} = {}) {
  if (typeof spawnImpl !== 'function') throw new TypeError('spawnImpl must be a function');
  return function exec({ args = [], timeoutMs: perCall } = {}) {
    const bound = Number.isSafeInteger(perCall) && perCall > 0 ? perCall : Math.max(1, timeoutMs);
    return new Promise((resolve) => {
      let child;
      try {
        child = spawnImpl(command, args, {
          cwd,
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        resolve({ ok: false, error });
        return;
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, ...result });
      };
      timer = setTimeout(() => {
        if (platform === 'win32' && child?.pid) {
          try {
            spawnImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
          } catch {
            // The finish below still reports an inconclusive probe.
          }
        } else {
          try {
            child?.kill('SIGKILL');
          } catch {
            // The finish below still reports an inconclusive probe.
          }
        }
        finish({ ok: false, status: null, timedOut: true });
      }, bound);
      child?.stdout?.on?.('data', (chunk) => {
        stdout = `${stdout}${chunk}`.slice(-MAX_CAPTURE);
      });
      child?.stderr?.on?.('data', (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-MAX_CAPTURE);
      });
      child?.on?.('error', (error) => finish({ ok: false, error }));
      child?.on?.('close', (code) => finish({ ok: code === 0, status: code }));
    });
  };
}
