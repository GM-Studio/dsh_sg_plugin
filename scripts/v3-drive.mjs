#!/usr/bin/env node
// Drives the v3 engine one step at a time so a human/agent dispatcher can run
// real subagents in between. Not part of the plugin runtime.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initProject, createChange, readConfig } from '../src/v3/change.js';
import { load, patchState } from '../src/v3/state.js';
import {
  checkM1,
  checkM2,
  checkFrozenH1,
  computeArtifactHash,
  collectKnownAcs,
} from '../src/v3/phase.js';
import { issueApproval } from '../src/v3/approvals.js';
import {
  commitChangePackage,
  ensureIntegration,
  ensureTask,
  worktreePath,
  removeWorktree,
  diffCheck,
  mergeIntoIntegration,
  headOf,
  git,
  integrationBranch,
} from '../src/v3/worktrees.js';
import { discoverCommand, loadPlan } from '../src/v3/plan.js';
import { runTestCommand } from '../src/v3/testrunner.js';
import { validateReport } from '../src/v3/report.js';
import { runAllSuites, runTaskSuites } from '../src/v3/suites.js';
import { appendEvidence, verifyEvidence } from '../src/v3/evidence.js';
import { generateAcceptance } from '../src/v3/acceptance.js';
import { archiveChange, nextTag } from '../src/v3/archive.js';
import { loadSkillPayload } from '../src/v3/skills.js';
import { digest } from '../src/v3/util/hash.js';

const root = path.resolve(process.argv[2] || '.');
const command = process.argv[3] || 'status';
const arg1 = process.argv[4];
const arg2 = process.argv[5];

function out(payload, code = 0) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

function fail(message, extra = {}) {
  out({ ok: false, message, ...extra }, 1);
}

function mustState() {
  const loaded = load(root);
  if (!loaded.ok) fail(loaded.message, { code: loaded.code });
  return loaded.state;
}

function markTaskDone(integrationPath, change, taskId) {
  const file = path.join(integrationPath, 'openspec', 'changes', change, 'tasks.md');
  if (!fs.existsSync(file)) return false;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const marker = new RegExp(`"id"\\s*:\\s*"${taskId}"`);
  const metaIndex = lines.findIndex((line) => marker.test(line));
  if (metaIndex < 0) return false;
  for (let index = metaIndex; index < lines.length; index += 1) {
    if (/^\s*-\s*\[ \]/.test(lines[index])) {
      lines[index] = lines[index].replace('[ ]', '[x]');
      fs.writeFileSync(file, lines.join('\n'), 'utf8');
      break;
    }
  }
  git(integrationPath, ['add', file]);
  git(integrationPath, ['commit', '-q', '-m', `mark ${taskId} done`]);
  return true;
}

function pickTask(state) {
  const tasks = Object.values(state.tasks || {});
  const merged = new Set(tasks.filter((task) => task.status === 'merged').map((task) => task.id));
  return (
    tasks.find(
      (task) =>
        (task.status === 'pending' || (task.status === 'failed' && (task.attempts || 0) < 3)) &&
        (task.deps || []).every((dep) => merged.has(dep)),
    ) || null
  );
}

switch (command) {
  case 'init': {
    const result = initProject(root);
    if (!result.ok) fail(result.message, result);
    out({ ok: true, created: result.created });
    break;
  }
  case 'change': {
    const baseCommit = headOf(root, 'HEAD');
    const result = createChange(root, {
      name: arg1,
      type: arg2 || 'feature',
      baseCommit,
      changeKey: process.argv[6] || null,
    });
    if (!result.ok) fail(result.message, result);
    out({ ok: true, change: arg1, type: arg2 || 'feature', baseCommit });
    break;
  }
  case 'm1': {
    const state = mustState();
    const result = checkM1({ root, state });
    out({ ok: result.ok, errors: result.errors, counts: result.counts });
    break;
  }
  case 'approve-h1': {
    const state = mustState();
    const m1 = checkM1({ root, state });
    if (!m1.ok) fail('M1 failed', m1);
    const specsBase = state.baseCommit || 'no-commit';
    const artifactHash = computeArtifactHash({ root, change: state.change, specsBase });
    const saved = patchState(root, (draft) => {
      issueApproval(draft, 'H1', artifactHash);
      draft.baseline = { specsBase, artifactHash, approvedAt: new Date().toISOString() };
      draft.phase = 'PLAN';
    });
    if (!saved.ok) fail(saved.message, saved);
    out({ ok: true, artifactHash, phase: 'PLAN' });
    break;
  }
  case 'm2': {
    const state = mustState();
    const config = readConfig(root);
    const m2 = checkM2({ root, state, config });
    if (!m2.ok) fail('M2 failed', m2);
    const saved = patchState(root, (draft) => {
      draft.plan = {
        designHash: m2.hashes.designHash,
        casesHash: m2.hashes.casesHash,
        mappingHash: m2.hashes.mappingHash,
        touchedHash: m2.hashes.touchedHash,
        planHash: m2.planHash,
        cmdHash: m2.cmdHash,
        argv: m2.command.argv,
        cwd: m2.command.cwd,
        suites: m2.suites.map((suite) => ({
          id: suite.id,
          kind: suite.kind,
          argv: suite.argv,
          cwd: suite.cwd,
          pytestArgs: suite.pytestArgs,
          python: suite.python,
          node: suite.node,
          cmdHash: suite.cmdHash,
        })),
        approvedAt: null,
      };
      draft.tasks = Object.fromEntries(
        m2.plan.tasks.map((task) => [
          task.id,
          {
            id: task.id,
            title: task.title,
            ac: task.ac,
            deps: task.deps,
            parallel: task.parallel,
            status: 'pending',
            attempts: 0,
            commit: null,
          },
        ]),
      );
      draft.touched = {
        modify: m2.plan.touched?.modify || [],
        delete: m2.plan.touched?.delete || [],
        bootstrap: m2.plan.touched?.bootstrap || [],
      };
      draft.phase = 'H2_PENDING';
    });
    if (!saved.ok) fail(saved.message, saved);
    out({ ok: true, planHash: m2.planHash, cmdHash: m2.cmdHash, tasks: m2.plan.tasks.map((t) => t.id) });
    break;
  }
  case 'approve-h2': {
    const state = mustState();
    const config = readConfig(root);
    const m2 = checkM2({ root, state, config });
    if (!m2.ok) fail('M2 failed', m2);
    const frozen = checkFrozenH1({ root, state });
    if (!frozen.ok) fail(frozen.message, frozen);
    const committed = commitChangePackage(root, state.change, `docs(${state.change}): 冻结 H2 方案`);
    if (!committed.ok) fail(committed.message, committed);
    const base = headOf(root, 'HEAD');
    const saved = patchState(root, (draft) => {
      issueApproval(draft, 'H2', m2.planHash);
      draft.plan.approvedAt = new Date().toISOString();
      draft.integration = { branch: integrationBranch(state.change), base, lastGreen: null };
      draft.phase = 'EXECUTING';
    });
    if (!saved.ok) fail(saved.message, saved);
    out({ ok: true, planHash: m2.planHash, integrationBase: base, phase: 'EXECUTING' });
    break;
  }
  case 'prepare': {
    const state = mustState();
    const task = pickTask(state);
    if (!task) fail('no runnable task');
    const integration = ensureIntegration(root, state.change, state.integration?.base);
    if (!integration.ok) fail(integration.message, integration);
    const base = headOf(integration.path, 'HEAD');
    const worktree = ensureTask(root, state.change, task.id, base);
    if (!worktree.ok) fail(worktree.message, worktree);
    const saved = patchState(root, (draft) => {
      draft.tasks[task.id].baseCommit = base;
      draft.tasks[task.id].status = 'running';
    });
    if (!saved.ok) fail(saved.message, saved);
    out({
      ok: true,
      task: { id: task.id, title: task.title, ac: task.ac, deps: task.deps },
      base,
      worktree: worktree.path,
      branch: worktree.branch,
      skills: loadSkillPayload({ role: 'implementer' }).map((item) => item.id),
    });
    break;
  }
  case 'impl-done': {
    const state = mustState();
    const task = state.tasks[arg1];
    if (!task) fail(`unknown task ${arg1}`);
    const worktree = path.join(root, '.specgate', 'worktrees', state.change, arg1);
    const base = state.type === 'fix' ? task.testHead || task.baseCommit : task.baseCommit;
    const head = headOf(worktree, 'HEAD');
    if (!head || head === base) fail('implementer did not commit');
    const diff = diffCheck({
      root,
      branch: `sg/${state.change}/${arg1}`,
      baseCommit: base,
      role: 'implementer',
      change: state.change,
      touched: state.touched,
    });
    if (!diff.ok) fail('implementer diff rejected', diff);
    patchState(root, (draft) => {
      draft.tasks[arg1].implHead = head;
    });
    out({ ok: true, implHead: head, files: diff.entries.map((e) => `${e.status} ${e.path}`) });
    break;
  }
  case 'test-done': {
    const state = mustState();
    const task = state.tasks[arg1];
    const worktree = path.join(root, '.specgate', 'worktrees', state.change, arg1);
    const head = headOf(worktree, 'HEAD');
    if (!head || head === task.implHead) fail('tester did not commit');
    const diff = diffCheck({
      root,
      branch: `sg/${state.change}/${arg1}`,
      baseCommit: task.implHead,
      role: 'tester',
      change: state.change,
      touched: state.touched,
    });
    if (!diff.ok) fail('tester diff rejected', diff);
    patchState(root, (draft) => {
      draft.tasks[arg1].testHead = head;
    });
    out({ ok: true, testHead: head, files: diff.entries.map((e) => `${e.status} ${e.path}`) });
    break;
  }
  case 'test-first': {
    const state = mustState();
    const task = state.tasks[arg1];
    const worktree = path.join(root, '.specgate', 'worktrees', state.change, arg1);
    const head = headOf(worktree, 'HEAD');
    if (!head || head === task.baseCommit) fail('tester did not commit repro');
    const diff = diffCheck({
      root,
      branch: `sg/${state.change}/${arg1}`,
      baseCommit: task.baseCommit,
      role: 'tester',
      change: state.change,
      touched: state.touched,
    });
    if (!diff.ok) fail('tester diff rejected', diff);
    patchState(root, (draft) => {
      draft.tasks[arg1].testHead = head;
    });
    out({ ok: true, testHead: head, files: diff.entries.map((e) => `${e.status} ${e.path}`) });
    break;
  }
  case 'repro': {
    const state = mustState();
    const task = state.tasks[arg1];
    if (!task.testHead) fail('no tester commit recorded');
    const automation = git(root, ['diff', '--name-only', `${task.baseCommit}..${task.testHead}`])
      .split('\n')
      .filter((file) => file.startsWith(`openspec/changes/${state.change}/tests/automation/`));
    if (automation.length === 0) fail('tester added no automation file');
    const reproPath = worktreePath(root, state.change, `${arg1}-repro`);
    git(root, ['worktree', 'add', '--detach', reproPath, task.baseCommit]);
    try {
      spawnSync(
        'npm',
        ['install', '--no-save', '--no-package-lock', '--ignore-scripts', '--omit=dev'],
        { cwd: reproPath, stdio: 'ignore', shell: true, windowsHide: true },
      );
      git(reproPath, ['checkout', task.testHead, '--', ...automation]);
      const config = readConfig(root);
      const commandInfo = discoverCommand(root, config);
      if (!commandInfo.ok) fail(commandInfo.message, commandInfo);
      const run = runTestCommand({
        argv: commandInfo.argv,
        cwd: path.join(reproPath, commandInfo.cwd || '.'),
      });
      if (run.exitCode === 0) fail('repro passed on base — 用例没有鉴别力', { run });
      const failedCases = (run.report?.cases || []).filter((item) => item.status === 'fail');
      if (failedCases.length === 0) {
        fail('repro 在 base 上没有产生失败用例（可能是依赖或环境问题）', { run });
      }
      out({ ok: true, exitCode: run.exitCode, failed: failedCases, report: run.report });
    } finally {
      removeWorktree(root, reproPath);
    }
    break;
  }
  case 'check': {
    const state = mustState();
    const task = state.tasks[arg1];
    const worktree = path.join(root, '.specgate', 'worktrees', state.change, arg1);
    const config = readConfig(root);
    const commandInfo = discoverCommand(root, config);
    const plan = loadPlan(root, state.change);
    const { knownAcs } = collectKnownAcs({ root, state, change: state.change });
    const suiteResult = runTaskSuites({
      root,
      state,
      worktree,
      task,
      plan,
      knownAcs,
      changedFiles: git(root, ['diff', '--name-only', `${task.baseCommit}..HEAD`])
        .split('\n')
        .filter(Boolean),
      fallbackCommand: commandInfo.ok ? commandInfo : null,
      requireChangedFiles: state.type !== 'remove',
    });
    out(
      {
        ok: suiteResult.ok,
        failedSuite: suiteResult.failedSuite,
        message: suiteResult.message,
        stats: suiteResult.stats,
        suites: (suiteResult.results || []).map((item) => ({
          suite: item.suiteId,
          ok: item.ok,
          exitCode: item.exitCode,
        })),
      },
      suiteResult.ok ? 0 : 1,
    );
    break;
  }
  case 'finish': {
    const state = mustState();
    const task = state.tasks[arg1];
    const reviewFile = path.resolve(arg2);
    const verdict = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
    if (verdict.verdict !== 'pass' || (verdict.blocking || []).length > 0) {
      fail('reviewer blocked', verdict);
    }
    const integration = ensureIntegration(root, state.change, state.integration?.base);
    const worktree = path.join(root, '.specgate', 'worktrees', state.change, arg1);
    const config = readConfig(root);
    const commandInfo = discoverCommand(root, config);
    const plan = loadPlan(root, state.change);
    const { knownAcs } = collectKnownAcs({ root, state, change: state.change });
    const suiteResult = runTaskSuites({
      root,
      state,
      worktree,
      task,
      plan,
      knownAcs,
      changedFiles: git(root, ['diff', '--name-only', `${task.baseCommit}..HEAD`])
        .split('\n')
        .filter(Boolean),
      fallbackCommand: commandInfo.ok ? commandInfo : null,
      requireChangedFiles: state.type !== 'remove',
    });
    if (!suiteResult.ok) fail('tests failed at finish', { suiteResult });
    const validation = { ok: true, stats: suiteResult.stats };

    const reviewDir = path.join(worktree, 'openspec', 'changes', state.change, 'reviews');
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.writeFileSync(
      path.join(reviewDir, `${arg1}.json`),
      `${JSON.stringify({ ...verdict, task: arg1, at: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
    git(worktree, ['add', '-A']);
    git(worktree, ['commit', '-q', '-m', `review ${arg1}`]);
    const finalHead = headOf(worktree, 'HEAD');
    const merged = mergeIntoIntegration({
      integrationPath: integration.path,
      branch: `sg/${state.change}/${arg1}`,
      expectedCommit: finalHead,
      message: `merge ${arg1}`,
    });
    if (!merged.ok) fail(merged.message, merged);
    markTaskDone(integration.path, state.change, arg1);
    const evidence = appendEvidence(root, state.change, {
      task: arg1,
      event: 'task',
      decision: 'merged',
      refs: { commit: finalHead, integration: merged.commit, report: validation.stats },
      skills: { suggested: [], injected: [] },
    });
    patchState(root, (draft) => {
      draft.tasks[arg1].status = 'merged';
      draft.tasks[arg1].commit = finalHead;
      draft.evidence = { headSeq: evidence.seq, headHash: evidence.hash };
    });
    out({ ok: true, task: arg1, commit: finalHead, integration: merged.commit, evidence: evidence.seq });
    break;
  }
  case 'integrate': {
    const state = mustState();
    const integration = ensureIntegration(root, state.change, state.integration?.base);
    const config = readConfig(root);
    const commandInfo = discoverCommand(root, config);
    const plan = loadPlan(root, state.change);
    const { deltaAcs, knownAcs } = collectKnownAcs({ root, state, change: state.change });
    const base = state.integration?.base;
    const changedFiles = git(integration.path, ['diff', '--name-only', `${base}..HEAD`])
      .split('\n')
      .filter(Boolean);
    const suiteResult = runAllSuites({
      root,
      state,
      worktree: integration.path,
      plan,
      knownAcs,
      changedFiles,
      fallbackCommand: commandInfo.ok ? commandInfo : null,
    });
    if (!suiteResult.ok) fail('integration regression failed', suiteResult);
    const report = {
      schemaVersion: 1,
      cases: suiteResult.results.flatMap((item) => item.report?.cases || []),
    };
    const commit = headOf(integration.path, 'HEAD');
    const headEvidence = verifyEvidence(root, state.change);
    const acceptance = generateAcceptance({
      change: state.change,
      type: state.type,
      changeKey: state.changeKey || null,
      acs: deltaAcs,
      report,
      exitCode: 0,
      evidence: headEvidence,
      commit,
      validator: 'builtin',
    });
    const acceptanceFile = path.join(integration.path, 'openspec', 'changes', state.change, 'acceptance.md');
    fs.writeFileSync(acceptanceFile, acceptance.text, 'utf8');
    git(integration.path, ['add', 'openspec/changes']);
    git(integration.path, ['commit', '-q', '-m', `acceptance(${state.change}): 生成验收报告`]);
    const finalCommit = headOf(integration.path, 'HEAD');
    const evidence = appendEvidence(root, state.change, {
      event: 'acceptance',
      decision: 'pass',
      refs: { commit: finalCommit },
    });
    patchState(root, (draft) => {
      draft.phase = 'H3_PENDING';
      draft.integration.lastGreen = finalCommit;
      draft.acceptanceHash = digest(acceptance.text);
      draft.evidence = { headSeq: evidence.seq, headHash: evidence.hash };
    });
    out({ ok: true, commit: finalCommit, rows: acceptance.rows, acceptance: acceptance.text });
    break;
  }
  case 'approve-h3': {
    const state = mustState();
    const integration = ensureIntegration(root, state.change, state.integration?.base);
    const text = fs.readFileSync(
      path.join(integration.path, 'openspec', 'changes', state.change, 'acceptance.md'),
      'utf8',
    );
    const hash = digest(text);
    if (state.acceptanceHash !== hash) fail('acceptance changed');
    const saved = patchState(root, (draft) => {
      issueApproval(draft, 'H3', hash);
      draft.phase = 'ARCHIVING';
    });
    if (!saved.ok) fail(saved.message, saved);
    out({ ok: true, acceptanceHash: hash });
    break;
  }
  case 'archive': {
    const state = mustState();
    const tag = nextTag(root);
    const result = archiveChange({
      root,
      change: state.change,
      integrationBranch: state.integration?.branch,
      tag,
    });
    if (!result.ok) fail(result.message, result);
    const evidence = appendEvidence(root, state.change, {
      event: 'archive',
      decision: 'done',
      refs: { tag: result.tag },
    });
    patchState(root, (draft) => {
      draft.phase = 'DONE';
      draft.evidence = { headSeq: evidence.seq, headHash: evidence.hash };
    });
    out({ ok: true, tag: result.tag, archived: result.archivedPath });
    break;
  }
  case 'status': {
    const state = mustState();
    out({
      ok: true,
      change: state.change,
      type: state.type,
      phase: state.phase,
      tasks: Object.fromEntries(
        Object.entries(state.tasks || {}).map(([id, task]) => [id, task.status]),
      ),
      evidence: state.evidence,
    });
    break;
  }
  default:
    fail(`unknown command: ${command}`);
}
