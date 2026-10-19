import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists, readText } from './util/fsx.js';
import { runTestCommand } from './testrunner.js';
import { validateReport } from './report.js';
import { resolveNode } from './env/node.js';
import { ensureVenv } from './env/python.js';
import { installForSuite } from './env/install.js';
import { patchState } from './state.js';

/** Frozen suites from state; falls back to the v3.0 single command. */
export function suitesFromState(state, fallbackCommand) {
  if (Array.isArray(state?.plan?.suites) && state.plan.suites.length > 0) {
    return state.plan.suites.map((suite) => ({
      id: suite.id,
      kind: suite.kind || 'node-test',
      argv: Array.isArray(suite.argv) ? suite.argv : [],
      cwd: suite.cwd || '.',
      pytestArgs: Array.isArray(suite.pytestArgs) ? suite.pytestArgs : [],
      python: suite.python || null,
      node: suite.node || null,
      install: suite.install === undefined ? false : suite.install,
    }));
  }
  if (fallbackCommand && fallbackCommand.ok) {
    return [
      {
        id: 'default',
        kind: 'node-test',
        argv: fallbackCommand.argv,
        cwd: fallbackCommand.cwd || '.',
        pytestArgs: [],
        python: null,
      },
    ];
  }
  return [];
}

/** Advisory suggestions only; nothing is written to config. */
export function suggestSuites(root) {
  const suggestions = [];
  const seen = new Set();
  const add = (item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    suggestions.push(item);
  };

  const pkgPath = path.join(root, 'package.json');
  if (exists(pkgPath)) {
    try {
      const pkg = JSON.parse(readText(pkgPath));
      const workspaces = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : Array.isArray(pkg.workspaces?.packages)
          ? pkg.workspaces.packages
          : null;
      if (workspaces) {
        for (const pattern of workspaces) {
          if (String(pattern).includes('*')) {
            const base = String(pattern).split('*')[0].replace(/\/$/, '');
            const dir = path.join(root, base);
            if (!exists(dir)) continue;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (!entry.isDirectory()) continue;
              const cwd = path.join(base, entry.name).replace(/\\/g, '/');
              if (exists(path.join(root, cwd, 'package.json'))) {
                add({ id: entry.name, kind: 'node-test', cwd, command: ['npm', 'run', 'test:json'] });
              }
            }
          } else if (exists(path.join(root, pattern, 'package.json'))) {
            add({
              id: String(pattern).split('/').filter(Boolean).pop() || 'app',
              kind: 'node-test',
              cwd: pattern,
              command: ['npm', 'run', 'test:json'],
            });
          }
        }
      } else if (pkg?.scripts?.['test:json']) {
        add({ id: 'default', kind: 'node-test', cwd: '.', command: ['npm', 'run', 'test:json'] });
      }
    } catch {
      // ignore invalid package.json
    }
  }

  if (
    exists(path.join(root, 'pyproject.toml')) ||
    exists(path.join(root, 'pytest.ini')) ||
    exists(path.join(root, 'requirements.txt'))
  ) {
    add({ id: 'api', kind: 'pytest', cwd: '.', pytestArgs: ['-q', 'tests'] });
  }

  for (const config of ['playwright.config.ts', 'playwright.config.js', 'cypress.config.ts', 'cypress.config.js']) {
    if (exists(path.join(root, config))) {
      add({ id: 'e2e', kind: 'command', cwd: '.', command: ['npm', 'run', 'test:e2e'] });
      break;
    }
  }

  return suggestions;
}

export function suiteIdForAc(mapping, suites, ac) {
  const entry = (mapping?.requirements || []).find((item) => item.ac === ac);
  if (entry?.suite && suites.some((suite) => suite.id === entry.suite)) return entry.suite;
  return suites[0]?.id || 'default';
}

export function groupAcsBySuite(acs, mapping, suites) {
  const groups = new Map();
  for (const ac of acs || []) {
    const suiteId = suiteIdForAc(mapping, suites, ac);
    if (!groups.has(suiteId)) groups.set(suiteId, new Set());
    groups.get(suiteId).add(ac);
  }
  return groups;
}

function attr(attrs, key) {
  const match = new RegExp(`(?:^|\\s)${key}="([^"]*)"`).exec(attrs);
  if (!match) return '';
  return match[1]
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function resolvePytestFile(cwd, worktree, classname) {
  const relative = `${String(classname || '').replace(/\./g, '/')}.py`;
  const candidates = [path.join(cwd, relative), path.join(cwd, path.basename(relative))];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.relative(worktree, candidate).replace(/\\/g, '/');
  }
  return relative;
}

export function parseJunitXml(text, { suiteId, cwd, worktree }) {
  const cases = [];
  const pattern = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let match;
  let index = 0;
  while ((match = pattern.exec(String(text ?? '')))) {
    const attrs = match[1];
    const body = match[3] || '';
    const name = attr(attrs, 'name');
    const classname = attr(attrs, 'classname');
    const status = /<(failure|error)\b/.test(body)
      ? 'fail'
      : /<skipped\b/.test(body)
        ? 'skip'
        : 'pass';
    const ac = [...name.matchAll(/\[(AC-\d{3,})\]/g)].map((item) => item[1]);
    index += 1;
    cases.push({
      id: `TC-${String(index).padStart(3, '0')}`,
      ac,
      status,
      file: resolvePytestFile(cwd, worktree, classname),
    });
  }
  return { schemaVersion: 1, runner: 'pytest', suite: suiteId, cases };
}



function installMeta(installed) {
  return {
    state: installed.skipped ? 'skipped' : 'done',
    reason: installed.reason || null,
    reused: installed.reused === true,
    command: installed.command ? [installed.command.bin, ...installed.command.args] : null,
  };
}

export function runPytestSuite({ suite, worktree, root }) {
  const venv = ensureVenv({ root: root || worktree, suite });
  if (!venv.ok) {
    return {
      exitCode: -1,
      stderr: venv.message,
      report: null,
      reportError: venv.message,
      code: venv.code,
      python: null,
      install: null,
    };
  }
  const installed = installForSuite({
    root: root || worktree,
    suite,
    pythonBin: venv.python,
    env: {
      ...process.env,
      VIRTUAL_ENV: venv.venv,
      PATH: `${path.dirname(venv.python)}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  if (!installed.ok) {
    return {
      exitCode: -1,
      stderr: installed.message,
      report: null,
      reportError: installed.message,
      code: 'INSTALL_FAILED',
      python: { version: venv.version, venv: venv.venv, created: !!venv.created, reused: !!venv.reused },
      install: null,
    };
  }
  const cwd = path.join(worktree, suite.cwd || '.');
  const junit = path.join(
    os.tmpdir(),
    `sg-junit-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.xml`,
  );
  const env = {
    ...process.env,
    VIRTUAL_ENV: venv.venv,
    PATH: `${path.dirname(venv.python)}${path.delimiter}${process.env.PATH || ''}`,
  };
  const result = spawnSync(
    venv.python,
    ['-m', 'pytest', `--junitxml=${junit}`, ...(suite.pytestArgs || [])],
    { cwd, encoding: 'utf8', windowsHide: true, env },
  );
  let report = null;
  let reportError = null;
  if (fs.existsSync(junit)) {
    report = parseJunitXml(fs.readFileSync(junit, 'utf8'), {
      suiteId: suite.id,
      cwd,
      worktree,
    });
    try {
      fs.unlinkSync(junit);
    } catch {
      // ignore cleanup failure
    }
  } else {
    reportError = 'pytest 没有生成 junit xml';
  }
  return {
    exitCode: typeof result.status === 'number' ? result.status : -1,
    stderr: String(result.stderr || ''),
    report,
    reportError,
    python: { version: venv.version, venv: venv.venv, created: !!venv.created, reused: !!venv.reused },
    install: installMeta(installed),
  };
}

export function runOneSuite({
  suite,
  root,
  worktree,
  acs,
  plan,
  knownAcs,
  changedFiles,
  requireChangedFiles = true,
}) {
  const cwd = path.join(worktree, suite.cwd || '.');
  const runtime = {
    suiteId: suite.id,
    at: new Date().toISOString(),
    node: null,
    python: null,
    install: null,
    lastRun: null,
  };
  const done = (payload) => ({
    ...payload,
    suiteId: suite.id,
    runtime: {
      ...runtime,
      lastRun: {
        ok: payload.ok === true,
        exitCode: payload.exitCode ?? null,
        at: new Date().toISOString(),
      },
    },
  });
  let env = process.env;
  let run;
  if (suite.kind === 'pytest') {
    run = runPytestSuite({ suite, worktree, root });
    runtime.python = run.python || null;
    runtime.install = run.install || null;
  } else {
    const nodeEnv = resolveNode({ root, suite, env: process.env });
    if (!nodeEnv.ok) {
      return done({
        ok: false,
        code: nodeEnv.code,
        message: nodeEnv.message,
      });
    }
    runtime.node = { version: nodeEnv.version, tool: nodeEnv.tool, dir: nodeEnv.dir };
    env = nodeEnv.env;
    const installed = installForSuite({ root, suite, env });
    runtime.install = installMeta(installed);
    if (!installed.ok) {
      return done({
        ok: false,
        code: 'INSTALL_FAILED',
        message: installed.message,
      });
    }
    run = runTestCommand({ argv: suite.argv, cwd, env });
  }

  if (run.exitCode !== 0) {
    return done({
      ok: false,
      exitCode: run.exitCode,
      report: run.report,
      message: `suite ${suite.id} 退出码 ${run.exitCode}：${(run.stderr || '').slice(-300)}`,
    });
  }
  if (!run.report) {
    return done({
      ok: false,
      exitCode: run.exitCode,
      message: `suite ${suite.id} 没有报告：${run.reportError || 'unknown'}`,
    });
  }

  const validation = validateReport({
    report: run.report,
    deltaAcs: acs,
    knownAcs,
    mapping: plan.mapping,
    worktree,
    changedFiles,
    requireChangedFiles,
  });
  return done({
    ok: validation.ok,
    exitCode: run.exitCode,
    report: run.report,
    validation,
    message: validation.ok ? null : validation.errors.join('; '),
  });
}

export function persistRuntime(root, results) {
  const suites = {};
  for (const result of results || []) {
    if (result?.runtime) suites[result.suiteId] = result.runtime;
  }
  if (Object.keys(suites).length === 0) return { ok: true, updated: 0 };
  const saved = patchState(root, (draft) => {
    draft.runtime = {
      updatedAt: new Date().toISOString(),
      suites: { ...(draft.runtime?.suites || {}), ...suites },
    };
  });
  return { ok: saved.ok, updated: Object.keys(suites).length };
}

function mergeStats(results) {
  const stats = { total: 0, passed: 0, failed: 0, skipped: 0, suites: results.length };
  for (const result of results) {
    const current = result.validation?.stats;
    if (!current) continue;
    stats.total += current.total || 0;
    stats.passed += current.passed || 0;
    stats.failed += current.failed || 0;
    stats.skipped += current.skipped || 0;
  }
  return stats;
}

/** Run only the suites that own this task's ACs. */
export function runTaskSuites({
  root,
  state,
  worktree,
  task,
  plan,
  knownAcs,
  changedFiles,
  fallbackCommand,
  requireChangedFiles = true,
}) {
  const suites = suitesFromState(state, fallbackCommand);
  const groups = groupAcsBySuite(task.ac || [], plan.mapping, suites);
  const results = [];
  for (const [suiteId, acs] of groups) {
    const suite = suites.find((item) => item.id === suiteId) || suites[0];
    const result = runOneSuite({
      suite,
      root,
      worktree,
      acs,
      plan,
      knownAcs,
      changedFiles,
      requireChangedFiles,
    });
    results.push(result);
    if (!result.ok) {
      return { ok: false, failedSuite: suiteId, results, stats: mergeStats(results), message: result.message };
    }
  }
  return { ok: true, results, stats: mergeStats(results) };
}

/** Run every frozen suite (integration regression). */
export function runAllSuites({
  root,
  state,
  worktree,
  plan,
  knownAcs,
  changedFiles,
  fallbackCommand,
}) {
  const suites = suitesFromState(state, fallbackCommand);
  const owners = new Map();
  for (const entry of plan.mapping?.requirements || []) {
    if (entry.suite) owners.set(entry.suite, owners.get(entry.suite) || new Set());
    if (entry.suite) owners.get(entry.suite).add(entry.ac);
  }
  const results = [];
  for (const suite of suites) {
    const acs = owners.get(suite.id) || new Set();
    const result = runOneSuite({
      suite,
      root,
      worktree,
      acs,
      plan,
      knownAcs,
      changedFiles,
      requireChangedFiles: false,
    });
    results.push(result);
    if (!result.ok) {
      return { ok: false, failedSuite: suite.id, results, stats: mergeStats(results), message: result.message };
    }
  }
  return { ok: true, results, stats: mergeStats(results) };
}
