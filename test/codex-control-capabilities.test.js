import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  CAPABILITY_NAMES,
  CAPABILITY_PROBES,
  CAPABILITY_STATES,
  DEGRADATION_MODE,
  createBoundedRunner,
  describeDegradation,
  detectCapabilities,
  versionGateHint,
} from '../src/codex/control/capabilities.js';
import { runControlCli } from '../scripts/specgate-control.mjs';

const ADVERTISED = {
  plugin: 'codex plugin --help',
  execJson: 'codex exec --json',
  nativeAgents: 'native agents',
  elicitation: 'mcp elicitation',
};

const ALL_AVAILABLE = Object.freeze({
  plugin: 'available',
  execJson: 'available',
  nativeAgents: 'available',
  elicitation: 'available',
});

function availableResult(capability) {
  return { status: 0, stdout: ADVERTISED[capability] };
}

function runnerFor(byCapability) {
  const calls = [];
  const exec = async (request) => {
    calls.push(request);
    const value = byCapability[request.capability];
    return typeof value === 'function' ? value(request) : value;
  };
  return { exec, calls };
}

function allAvailableMap() {
  return Object.fromEntries(CAPABILITY_NAMES.map((name) => [name, availableResult(name)]));
}

function fakeSpawn({ code = 0, stdout = '', stderr = '', autoClose = true } = {}) {
  const calls = [];
  const children = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.signals = [];
    child.kill = (signal) => {
      child.signals.push(signal);
      return true;
    };
    children.push(child);
    if (autoClose) {
      queueMicrotask(() => {
        if (stdout) child.stdout.emit('data', stdout);
        if (stderr) child.stderr.emit('data', stderr);
        child.emit('close', code);
      });
    }
    return child;
  };
  return { spawnImpl, calls, children };
}

test('detectCapabilities reports available for every capability a host advertises', async () => {
  const { exec } = runnerFor(allAvailableMap());
  const report = await detectCapabilities({ exec });
  assert.deepEqual(report, {
    plugin: 'available',
    execJson: 'available',
    nativeAgents: 'available',
    elicitation: 'available',
  });
});

test('each capability is reported missing independently when its probe is absent', async () => {
  for (const name of CAPABILITY_NAMES) {
    const map = allAvailableMap();
    map[name] = { status: 1, stdout: '', stderr: 'unknown subcommand' };
    const { exec } = runnerFor(map);
    const report = await detectCapabilities({ exec });
    assert.equal(report[name], 'missing', `${name} should be missing`);
    for (const other of CAPABILITY_NAMES.filter((candidate) => candidate !== name)) {
      assert.equal(report[other], 'available', `${other} should stay available`);
    }
  }
});

test('an existing subcommand that does not advertise its feature is reported missing', async () => {
  const map = allAvailableMap();
  map.execJson = { status: 0, stdout: 'codex exec --help without machine output' };
  const { exec } = runnerFor(map);
  const report = await detectCapabilities({ exec });
  assert.equal(report.execJson, 'missing');
});

test('inconclusive probes are reported not-probed and never assumed available', async () => {
  const map = allAvailableMap();
  map.nativeAgents = { timedOut: true };
  map.elicitation = { status: null, signal: 'SIGTERM' };
  const { exec } = runnerFor(map);
  const report = await detectCapabilities({ exec });
  assert.equal(report.nativeAgents, 'not-probed');
  assert.equal(report.elicitation, 'not-probed');
  assert.equal(report.plugin, 'available');
  for (const name of CAPABILITY_NAMES) assert.ok(CAPABILITY_STATES.includes(report[name]));
});

test('detectCapabilities never touches the host when no runner is injected', async () => {
  const report = await detectCapabilities();
  assert.deepEqual(report, {
    plugin: 'not-probed',
    execJson: 'not-probed',
    nativeAgents: 'not-probed',
    elicitation: 'not-probed',
  });
  assert.deepEqual(await detectCapabilities({ exec: undefined, timeoutMs: 5 }), report);
});

test('an unavailable host command is reported missing rather than guessed', async () => {
  const exec = async () => {
    const error = new Error('spawn codex ENOENT');
    error.code = 'ENOENT';
    throw error;
  };
  const report = await detectCapabilities({ exec });
  assert.deepEqual(report, {
    plugin: 'missing',
    execJson: 'missing',
    nativeAgents: 'missing',
    elicitation: 'missing',
  });
});

test('capability probes are read-only help surfaces that never mutate the host', async () => {
  for (const name of CAPABILITY_NAMES) {
    assert.equal(CAPABILITY_PROBES[name].readOnly, true);
    assert.ok(CAPABILITY_PROBES[name].args.includes('--help'));
  }
  const { exec, calls } = runnerFor(allAvailableMap());
  await detectCapabilities({ exec });
  assert.equal(calls.length, CAPABILITY_NAMES.length);
  const mutating = ['apply', 'login', 'auth', 'install', 'remove', 'delete', 'setup'];
  for (const call of calls) {
    assert.ok(call.args.includes('--help'), `${call.capability} must probe a help surface`);
    assert.equal(call.readOnly, true);
    assert.equal(
      call.args.some((arg) => mutating.includes(arg)),
      false,
      `${call.capability} must not issue a mutating subcommand`,
    );
  }
});

test('a hanging probe is bounded by the timeout and reported not-probed', async () => {
  let release;
  const hang = new Promise((resolve) => {
    release = resolve;
  });
  const exec = () => hang;
  const started = Date.now();
  const report = await detectCapabilities({ exec, timeoutMs: 30 });
  const elapsed = Date.now() - started;
  assert.deepEqual(report, {
    plugin: 'not-probed',
    execJson: 'not-probed',
    nativeAgents: 'not-probed',
    elicitation: 'not-probed',
  });
  assert.ok(elapsed < 2000, `probe should return quickly, took ${elapsed}ms`);
  release({ status: 0, stdout: 'late' });
});

test('the bounded runner ignores stdin and terminates a hung probe', async () => {
  const { spawnImpl, calls, children } = fakeSpawn({ autoClose: false });
  const exec = createBoundedRunner({
    command: 'codex',
    spawnImpl,
    platform: 'linux',
    timeoutMs: 20,
  });
  const result = await exec({ args: ['plugin', '--help'], timeoutMs: 20 });
  assert.equal(result.timedOut, true);
  assert.equal(calls[0].options.stdio[0], 'ignore');
  assert.deepEqual(calls[0].args, ['plugin', '--help']);
  assert.deepEqual(children[0].signals, ['SIGKILL']);
});

test('the bounded runner reports capabilities observed from a read-only probe', async () => {
  const { spawnImpl, calls } = fakeSpawn({ code: 0, stdout: 'plugin surface' });
  const exec = createBoundedRunner({ command: 'codex', spawnImpl, timeoutMs: 500 });
  const report = await detectCapabilities({ exec });
  assert.equal(report.plugin, 'available');
  assert.equal(calls[0].options.stdio[0], 'ignore');
});

test('a fully capable host runs natively with no degradation', () => {
  const described = describeDegradation(ALL_AVAILABLE);
  assert.equal(described.mode, DEGRADATION_MODE.NATIVE);
  assert.deepEqual(described.degradations, []);
  assert.deepEqual(described.blocked, []);
  assert.match(described.versionGateHint, /no upgrade is required/i);
});

test('a missing plugin degrades to the project-level MCP + skill path', () => {
  const described = describeDegradation({ ...ALL_AVAILABLE, plugin: 'missing' });
  assert.equal(described.mode, DEGRADATION_MODE.PROJECT_ROUTE);
  assert.ok(described.degradations.includes('plugin-unavailable'));
  assert.equal(described.blocked.includes('subagents'), false);
  assert.match(described.versionGateHint, /project-level MCP \+ skill/i);
});

test('a missing exec --json degrades to the project-level MCP + skill path', () => {
  const described = describeDegradation({ ...ALL_AVAILABLE, execJson: 'missing' });
  assert.equal(described.mode, DEGRADATION_MODE.PROJECT_ROUTE);
  assert.ok(described.degradations.includes('exec-json-unavailable'));
  assert.match(described.versionGateHint, /exec --json/);
  assert.match(described.versionGateHint, /upgrade the Codex CLI/i);
});

test('missing native agents block subagent dispatch without changing the execution mode', () => {
  const described = describeDegradation({ ...ALL_AVAILABLE, nativeAgents: 'missing' });
  assert.equal(described.mode, DEGRADATION_MODE.NATIVE);
  assert.ok(described.blocked.includes('subagents'));
  assert.ok(described.degradations.includes('subagent-dispatch-unavailable'));
});

test('missing elicitation keeps interactive gates pending', () => {
  const described = describeDegradation({ ...ALL_AVAILABLE, elicitation: 'missing' });
  assert.ok(described.blocked.includes('interactive-gates'));
  assert.ok(described.degradations.includes('interactive-gates-pending'));
  assert.match(described.versionGateHint, /interactive gates stay pending/i);
});

test('an unprobed capability degrades conservatively and is never assumed available', () => {
  const described = describeDegradation({ ...ALL_AVAILABLE, plugin: 'not-probed' });
  assert.equal(described.mode, DEGRADATION_MODE.PROJECT_ROUTE);
  assert.ok(described.degradations.includes('plugin-unavailable'));
  assert.match(described.versionGateHint, /could not be confirmed/i);
});

test('describeDegradation tolerates an empty or malformed report', () => {
  const empty = describeDegradation();
  assert.equal(empty.mode, DEGRADATION_MODE.PROJECT_ROUTE);
  assert.deepEqual(empty.blocked, ['subagents', 'interactive-gates']);
  assert.equal(empty.versionGateHint, versionGateHint({}));
  const junk = describeDegradation({ plugin: 'weird', execJson: 7 });
  assert.equal(junk.mode, DEGRADATION_MODE.PROJECT_ROUTE);
  assert.equal(typeof junk.versionGateHint, 'string');
});

test('versionGateHint gives upgrade guidance when a required capability is absent', () => {
  const hint = versionGateHint({ ...ALL_AVAILABLE, execJson: 'missing' });
  assert.match(hint, /exec --json/);
  assert.match(hint, /upgrade the Codex CLI/i);
});

test('doctor surfaces the capability report, degradation mode and blocked capabilities', async () => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cap-doctor-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cap-doctor-project-'));
  const calls = [];
  const result = await runControlCli({
    args: ['doctor', '--project', projectRoot],
    env: { ...process.env, SPECGATE_CONTROL_HOME: controlRoot },
    platform: 'linux',
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      const joined = args.join(' ');
      if (joined.includes('--version')) {
        return { status: 0, stdout: 'codex-cli 9.9.9\n', stderr: '' };
      }
      if (joined.includes('plugin')) return { status: 0, stdout: 'plugin surface', stderr: '' };
      if (joined.includes('exec')) return { status: 0, stdout: 'exec --json', stderr: '' };
      if (joined.includes('agents')) return { status: 0, stdout: 'native agents', stderr: '' };
      if (joined.includes('mcp')) return { status: 0, stdout: 'elicitation', stderr: '' };
      return { status: 1, stdout: '', stderr: 'unknown' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.codex.version, 'codex-cli 9.9.9');
  assert.equal(result.isolation.controlSecretsExcluded, true);
  assert.deepEqual(result.capabilities.states, {
    plugin: 'available',
    execJson: 'available',
    nativeAgents: 'available',
    elicitation: 'available',
  });
  assert.equal(result.capabilities.mode, DEGRADATION_MODE.NATIVE);
  assert.deepEqual(result.capabilities.blocked, []);
  assert.equal(typeof result.capabilities.versionGateHint, 'string');
  assert.equal(calls[0].args.join(' '), '--version');
});

test('doctor does not fail when a capability probe is not-probed', async () => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cap-doctor-timeout-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cap-doctor-timeout-project-'));
  const result = await runControlCli({
    args: ['doctor', '--project', projectRoot],
    env: { ...process.env, SPECGATE_CONTROL_HOME: controlRoot },
    platform: 'linux',
    spawnSyncImpl(command, args) {
      if (args.join(' ').includes('--version'))
        return { status: 0, stdout: 'codex-cli 9.9.9\n', stderr: '' };
      const error = new Error('probe timed out');
      error.code = 'ETIMEDOUT';
      return { status: null, signal: 'SIGTERM', stdout: '', stderr: '', error };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.capabilities.states, {
    plugin: 'not-probed',
    execJson: 'not-probed',
    nativeAgents: 'not-probed',
    elicitation: 'not-probed',
  });
  assert.equal(result.capabilities.mode, DEGRADATION_MODE.PROJECT_ROUTE);
  assert.ok(result.capabilities.blocked.includes('subagents'));
  assert.ok(result.capabilities.blocked.includes('interactive-gates'));
});
