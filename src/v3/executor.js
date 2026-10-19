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
import { runTestCommand } from './testrunner.js';
import { validateReport } from './report.js';
import { collectKnownAcs } from './phase.js';
import { appendEvidence } from './evidence.js';

function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function changedFiles(root, base, head) {
  try {
    return git(root, ['diff', '--name-only', `${base}..${head}`]).split('\n').filter(Boolean);
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
  const run = runTestCommand({
    argv: command.argv,
    cwd: path.join(worktree.path, command.cwd || '.'),
  });
  if (run.exitCode !== 0) {
    return failure('TESTS_FAILED', `测试退出码 ${run.exitCode}：${(run.stderr || '').slice(-400)}`, {
      run,
    });
  }

  const plan = loadPlan(root, change);
  const { deltaAcs, knownAcs } = collectKnownAcs({ root, state, change });
  const head = headOf(worktree.path, 'HEAD');
  const validation = validateReport({
    report: run.report,
    deltaAcs,
    knownAcs,
    mapping: plan.mapping,
    worktree: worktree.path,
    changedFiles: changedFiles(root, base, head),
  });
  if (!validation.ok) {
    return failure('REPORT_INVALID', validation.errors.join('; '), { validation, run });
  }

  const review = await dispatcher({
    role: 'reviewer',
    task,
    worktree: worktree.path,
    prompt: [
      `审查 change ${change} 的任务 ${task.id}。`,
      `AC: ${task.ac.join(', ')}`,
      `测试结果: passed=${validation.stats.passed} failed=${validation.stats.failed}`,
      '只输出 JSON：{"verdict":"pass|fail","blocking":[{"file":"","line":0,"reason":""}],"nonBlocking":[]}',
    ].join('\n'),
    parent,
  });
  if (!review.ok) return failure(review.code || 'REVIEW_FAILED', review.message);

  const verdict = extractJson(review.text);
  if (!verdict || !verdict.verdict) return failure('REVIEW_INVALID', 'reviewer 未返回合法 JSON');
  const blocking = Array.isArray(verdict.blocking) ? verdict.blocking : [];
  if (verdict.verdict !== 'pass' || blocking.length > 0) {
    return failure('REVIEW_BLOCKED', `reviewer 判定 ${verdict.verdict}，blocking ${blocking.length} 项`, {
      verdict,
    });
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

  const merged = mergeIntoIntegration({
    integrationPath: integration.path,
    branch: worktree.branch,
    expectedCommit: finalHead,
    message: `merge ${task.id}`,
  });
  if (!merged.ok) return failure(merged.code || 'MERGE_FAILED', merged.message);

  markTaskDone(integration.path, change, task.id);
  const evidence = appendEvidence(root, change, {
    task: task.id,
    event: 'task',
    decision: 'merged',
    refs: { commit: finalHead, integration: merged.commit, report: validation.stats },
  });

  return {
    ok: true,
    commit: finalHead,
    integrationCommit: merged.commit,
    report: validation.stats,
    evidence: { seq: evidence.seq, hash: evidence.hash },
  };
}

async function executeFeatureTask({ root, state, task, dispatcher, config, parent }) {
  const change = state.change;
  const integrationBase = state.integration?.base || state.baseCommit;
  const integration = ensureIntegration(root, change, integrationBase);
  if (!integration.ok) return failure(integration.code || 'INTEGRATION_FAILED', integration.message);

  const base = headOf(integration.path, 'HEAD');
  const worktree = ensureTask(root, change, task.id, base);
  if (!worktree.ok) return failure(worktree.code || 'WORKTREE_FAILED', worktree.message);

  const implementer = await dispatcher({
    role: 'implementer',
    task,
    worktree: worktree.path,
    prompt: implementerPrompt(change, task),
    parent,
  });
  if (!implementer.ok) return failure(implementer.code || 'IMPLEMENTER_FAILED', implementer.message);

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
    prompt: testerPrompt(change, task),
    parent,
  });
  if (!tester.ok) return failure(tester.code || 'TESTER_FAILED', tester.message);

  const testHead = headOf(worktree.path, 'HEAD');
  if (!testHead || testHead === implHead) return failure('NO_TEST_COMMIT', 'tester 没有产生测试提交');
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
  if (!command.ok) return failure(command.code || 'TEST_COMMAND_MISSING', command.message);

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
  if (!integration.ok) return failure(integration.code || 'INTEGRATION_FAILED', integration.message);

  const base = headOf(integration.path, 'HEAD');
  const worktree = ensureTask(root, change, task.id, base);
  if (!worktree.ok) return failure(worktree.code || 'WORKTREE_FAILED', worktree.message);

  const command = discoverCommand(root, config);
  if (!command.ok) return failure(command.code || 'TEST_COMMAND_MISSING', command.message);

  const tester = await dispatcher({
    role: 'tester',
    task,
    worktree: worktree.path,
    prompt: testerPrompt(change, task, '先写一个能复现缺陷的用例；它必须在当前代码上失败。'),
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
    prompt: implementerPrompt(change, task),
    parent,
  });
  if (!implementer.ok) return failure(implementer.code || 'IMPLEMENTER_FAILED', implementer.message);

  const implHead = headOf(worktree.path, 'HEAD');
  if (!implHead || implHead === testHead) return failure('NO_COMMIT', 'implementer 没有产生修复提交');
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
