import fs from 'node:fs';
import path from 'node:path';
import {
  git,
  ensureIntegration,
  ensureTask,
  worktreePath,
  removeWorktree,
  diffCheck,
  mergeIntoIntegration,
  headOf,
} from './worktrees.js';
import { discoverCommand, loadPlan } from './plan.js';
import { runTaskSuites, persistRuntime } from './suites.js';
import { runTestCommand } from './testrunner.js';
import { collectKnownAcs } from './phase.js';
import { appendEvidence } from './evidence.js';
import { loadSkillPayload } from './skills.js';

function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

let mergeQueue = Promise.resolve();

async function withMergeLock(task) {
  const run = mergeQueue.then(task, task);
  mergeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function changedFiles(root, base, head) {
  try {
    return git(root, ['diff', '--name-only', `${base}..${head}`])
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function extractJson(text) {
  const start = String(text).indexOf('{');
  const end = String(text).lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(String(text).slice(start, end + 1));
  } catch {
    return null;
  }
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

function implementerPrompt(change, task) {
  return [
    `change: ${change}`,
    `task: ${task.id} ${task.title}`,
    `ac: ${task.ac.join(', ')}`,
    '只实现源码，不要改 tests/、openspec/specs/ 或 change 包。',
    '完成后在工作区 git add -A && git commit，并回复 commit hash。',
  ].join('\n');
}

function testerPrompt(change, task, extra = '') {
  return [
    `change: ${change}`,
    `task: ${task.id} ${task.title}`,
    `ac: ${task.ac.join(', ')}`,
    extra,
    '只新增 openspec/changes/<change>/tests/automation/** 或修改 H2 清单内测试；不要改源码。',
    '完成后 git add -A && git commit。',
  ]
    .filter(Boolean)
    .join('\n');
}

async function verifyAndFinish({
  root,
  state,
  task,
  worktree,
  integration,
  base,
  dispatcher,
  command,
  parent,
}) {
  const change = state.change;
  const plan = loadPlan(root, change);
  const { knownAcs } = collectKnownAcs({ root, state, change });
  const head = headOf(worktree.path, 'HEAD');
  const suiteResult = runTaskSuites({
    root,
    state,
    worktree: worktree.path,
    change,
    task,
    plan,
    knownAcs,
    changedFiles: changedFiles(root, base, head),
    fallbackCommand: command,
    requireChangedFiles: state.type !== 'remove',
  });
  persistRuntime(root, suiteResult.results);
  if (!suiteResult.ok) {
    return failure(
      'SUITE_FAILED',
      `suite ${suiteResult.failedSuite} 失败：${suiteResult.message}`,
      { suiteResult },
    );
  }
  const validation = { ok: true, stats: suiteResult.stats };

  const reviewerSkills = loadSkillPayload({ role: 'reviewer' });
  const review = await dispatcher({
    role: 'reviewer',
    task,
    worktree: worktree.path,
    root,
    change,
    prompt: [
      `审查 change ${change} 的任务 ${task.id}。`,
      `AC: ${task.ac.join(', ')}`,
      `测试结果: passed=${validation.stats.passed} failed=${validation.stats.failed}`,
      '只输出 JSON：{"verdict":"pass|fail","blocking":[{"file":"","line":0,"reason":""}],"nonBlocking":[]}',
    ].join('\n'),
    skills: reviewerSkills,
    parent,
  });
  if (!review.ok) return failure(review.code || 'REVIEW_FAILED', review.message);

  const verdict = extractJson(review.text);
  if (!verdict || !verdict.verdict) return failure('REVIEW_INVALID', 'reviewer 未返回合法 JSON');
  const blocking = Array.isArray(verdict.blocking) ? verdict.blocking : [];
  if (verdict.verdict !== 'pass' || blocking.length > 0) {
    return failure(
      'REVIEW_BLOCKED',
      `reviewer 判定 ${verdict.verdict}，blocking ${blocking.length} 项`,
      {
        verdict,
      },
    );
  }

  const reviewDiff = diffCheck({
    root,
    branch: worktree.branch,
    baseCommit: head,
    role: 'reviewer',
    change,
    touched: state.touched,
  });
  if (!reviewDiff.ok) {
    return failure('DIFF_VIOLATION', reviewDiff.violations.map((item) => item.reason).join('; '));
  }

  const reviewDir = path.join(worktree.path, 'openspec', 'changes', change, 'reviews');
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(
    path.join(reviewDir, `${task.id}.json`),
    `${JSON.stringify({ ...verdict, task: task.id, at: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
  git(worktree.path, ['add', '-A']);
  git(worktree.path, ['commit', '-q', '-m', `review ${task.id}`]);
  const finalHead = headOf(worktree.path, 'HEAD');
  const merged = await withMergeLock(async () => {
    const result = mergeIntoIntegration({
      integrationPath: integration.path,
      branch: worktree.branch,
      expectedCommit: finalHead,
      message: `merge ${task.id}`,
    });
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    markTaskDone(integration.path, change, task.id);
    const injected = [
      ...new Set([
        ...loadSkillPayload({ role: 'implementer', parallel: task.parallel }).map(
          (item) => item.id,
        ),
        ...loadSkillPayload({ role: 'tester' }).map((item) => item.id),
        ...reviewerSkills.map((item) => item.id),
      ]),
    ];
    const evidence = appendEvidence(root, change, {
      task: task.id,
      event: 'task',
      decision: 'merged',
      refs: { commit: finalHead, integration: result.commit, report: validation.stats },
      skills: { suggested: [], injected },
    });
    return {
      ok: true,
      commit: finalHead,
      integrationCommit: result.commit,
      report: validation.stats,
      evidence: { seq: evidence.seq, hash: evidence.hash },
    };
  });
  if (!merged.ok) return failure(merged.code || 'MERGE_FAILED', merged.message);
  return merged;
}

async function executeFeatureTask({ root, state, task, dispatcher, config, parent }) {
  const change = state.change;
  const integrationBase = state.integration?.base || state.baseCommit;
  const integration = ensureIntegration(root, change, integrationBase);
  if (!integration.ok)
    return failure(integration.code || 'INTEGRATION_FAILED', integration.message);

  const base = headOf(integration.path, 'HEAD');
  const worktree = ensureTask(root, change, task.id, base);
  if (!worktree.ok) return failure(worktree.code || 'WORKTREE_FAILED', worktree.message);

  const implementer = await dispatcher({
    role: 'implementer',
    task,
    worktree: worktree.path,
    root,
    change,
    prompt: implementerPrompt(change, task),
    skills: loadSkillPayload({
      role: 'implementer',
      retry: (task.attempts || 0) > 0,
      parallel: task.parallel,
    }),
    parent,
  });
  if (!implementer.ok)
    return failure(implementer.code || 'IMPLEMENTER_FAILED', implementer.message);

  const implHead = headOf(worktree.path, 'HEAD');
  if (!implHead || implHead === base) return failure('NO_COMMIT', 'implementer 没有产生提交');
  const implDiff = diffCheck({
    root,
    branch: worktree.branch,
    baseCommit: base,
    role: 'implementer',
    change,
    touched: state.touched,
  });
  if (!implDiff.ok) {
    return failure('DIFF_VIOLATION', implDiff.violations.map((item) => item.reason).join('; '), {
      violations: implDiff.violations,
    });
  }

  const tester = await dispatcher({
    role: 'tester',
    task,
    worktree: worktree.path,
    root,
    change,
    prompt: testerPrompt(change, task),
    skills: loadSkillPayload({ role: 'tester', retry: (task.attempts || 0) > 0 }),
    parent,
  });
  if (!tester.ok) return failure(tester.code || 'TESTER_FAILED', tester.message);

  const testHead = headOf(worktree.path, 'HEAD');
  if (!testHead || testHead === implHead)
    return failure('NO_TEST_COMMIT', 'tester 没有产生测试提交');
  const testDiff = diffCheck({
    root,
    branch: worktree.branch,
    baseCommit: implHead,
    role: 'tester',
    change,
    touched: state.touched,
  });
  if (!testDiff.ok) {
    return failure('DIFF_VIOLATION', testDiff.violations.map((item) => item.reason).join('; '), {
      violations: testDiff.violations,
    });
  }

  const command = discoverCommand(root, config);
  const hasSuites = Array.isArray(state.plan?.suites) && state.plan.suites.length > 0;
  if (!command.ok && !hasSuites) {
    return failure(command.code || 'TEST_COMMAND_MISSING', command.message);
  }

  return verifyAndFinish({
    root,
    state,
    task,
    worktree,
    integration,
    base,
    dispatcher,
    command,
    parent,
  });
}

async function executeFixTask({ root, state, task, dispatcher, config, parent }) {
  const change = state.change;
  const integrationBase = state.integration?.base || state.baseCommit;
  const integration = ensureIntegration(root, change, integrationBase);
  if (!integration.ok)
    return failure(integration.code || 'INTEGRATION_FAILED', integration.message);

  const base = headOf(integration.path, 'HEAD');
  const worktree = ensureTask(root, change, task.id, base);
  if (!worktree.ok) return failure(worktree.code || 'WORKTREE_FAILED', worktree.message);

  const command = discoverCommand(root, config);
  const hasSuites = Array.isArray(state.plan?.suites) && state.plan.suites.length > 0;
  if (!command.ok && !hasSuites) {
    return failure(command.code || 'TEST_COMMAND_MISSING', command.message);
  }

  const tester = await dispatcher({
    role: 'tester',
    task,
    worktree: worktree.path,
    root,
    change,
    prompt: testerPrompt(change, task, '先写一个能复现缺陷的用例；它必须在当前代码上失败。'),
    skills: loadSkillPayload({ role: 'tester', retry: (task.attempts || 0) > 0 }),
    parent,
  });
  if (!tester.ok) return failure(tester.code || 'TESTER_FAILED', tester.message);

  const testHead = headOf(worktree.path, 'HEAD');
  if (!testHead || testHead === base) return failure('NO_TEST_COMMIT', 'tester 没有提交复现用例');
  const testDiff = diffCheck({
    root,
    branch: worktree.branch,
    baseCommit: base,
    role: 'tester',
    change,
    touched: state.touched,
  });
  if (!testDiff.ok) {
    return failure('DIFF_VIOLATION', testDiff.violations.map((item) => item.reason).join('; '), {
      violations: testDiff.violations,
    });
  }

  const automation = changedFiles(root, base, testHead).filter((filePath) =>
    filePath.startsWith(`openspec/changes/${change}/tests/automation/`),
  );
  if (automation.length === 0) {
    return failure('REPRO_MISSING', 'tester 没有新增复现用例（automation）');
  }

  const reproPath = worktreePath(root, change, `${task.id}-repro`);
  const added = git(root, ['worktree', 'add', '--detach', reproPath, base]);
  void added;
  try {
    git(reproPath, ['checkout', testHead, '--', ...automation]);
    const reproRun = runTestCommand({
      argv: command.argv,
      cwd: path.join(reproPath, command.cwd || '.'),
    });
    if (reproRun.exitCode === 0) {
      return failure('REPRO_PASSED_ON_BASE', '复现用例在 base 上就通过，无法证明缺陷被复现');
    }
  } finally {
    removeWorktree(root, reproPath);
  }

  const implementer = await dispatcher({
    role: 'implementer',
    task,
    worktree: worktree.path,
    root,
    change,
    prompt: implementerPrompt(change, task),
    skills: loadSkillPayload({
      role: 'implementer',
      retry: (task.attempts || 0) > 0,
      parallel: task.parallel,
    }),
    parent,
  });
  if (!implementer.ok)
    return failure(implementer.code || 'IMPLEMENTER_FAILED', implementer.message);

  const implHead = headOf(worktree.path, 'HEAD');
  if (!implHead || implHead === testHead)
    return failure('NO_COMMIT', 'implementer 没有产生修复提交');
  const implDiff = diffCheck({
    root,
    branch: worktree.branch,
    baseCommit: testHead,
    role: 'implementer',
    change,
    touched: state.touched,
  });
  if (!implDiff.ok) {
    return failure('DIFF_VIOLATION', implDiff.violations.map((item) => item.reason).join('; '), {
      violations: implDiff.violations,
    });
  }

  return verifyAndFinish({
    root,
    state,
    task,
    worktree,
    integration,
    base,
    dispatcher,
    command,
    parent,
  });
}

export async function executeTask(args) {
  if (args.state.type === 'fix') return executeFixTask(args);
  return executeFeatureTask(args);
}

export function pickNextTask(state) {
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

export function revertWave({ root, state, waveStart }) {
  const integration = ensureIntegration(root, state.change, state.integration?.base);
  if (!integration.ok) return { ok: false, message: integration.message };
  try {
    git(integration.path, ['reset', '--hard', waveStart]);
  } catch (error) {
    return { ok: false, message: String(error.stderr || error.message) };
  }
  const reverted = Object.entries(state.tasks || {})
    .filter(([, task]) => task.status === 'merged' || task.status === 'failed')
    .map(([id]) => id);
  appendEvidence(root, state.change, {
    event: 'revertWave',
    decision: 'reverted',
    refs: { to: waveStart, tasks: reverted },
  });
  return { ok: true, reverted, commit: headOf(integration.path, 'HEAD') };
}
