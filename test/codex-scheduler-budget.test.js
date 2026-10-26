import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_PHASES,
  BUDGET_ACTIONS,
  emptyBudget,
  consume,
  checkBoundary,
  saveProgress,
  resumeProgress,
  recordCost,
  timeReport,
} from '../src/codex/core/scheduler-budget.js';

test('the six time phases and two budget actions are closed sets', () => {
  assert.deepEqual([...TIME_PHASES].sort(), [
    'execute',
    'integrate',
    'prepare',
    'queue',
    'rework',
    'scan',
  ]);
  assert.deepEqual([...BUDGET_ACTIONS].sort(), ['continue', 'save-and-stop']);
});

test('a fresh budget has zero consumption and explicitly unknown cost', () => {
  const budget = emptyBudget();
  assert.deepEqual(budget.consumed, { milliseconds: 0, tasks: 0 });
  assert.equal(budget.cost.known, false, '费用未知不得填 0');
  assert.equal(budget.cost.amount, null);
  assert.equal(budget.stopped, false);
});

test('reaching the time limit stops new tasks and requires adjustment', () => {
  // AC-28
  let budget = emptyBudget({ limits: { maxMilliseconds: 1000 } });
  budget = consume(budget, { milliseconds: 900, phase: 'execute' }).budget;
  assert.equal(checkBoundary(budget).action, 'continue');
  budget = consume(budget, { milliseconds: 200, phase: 'execute' }).budget;
  const checked = checkBoundary(budget);
  assert.equal(checked.action, 'save-and-stop');
  assert.deepEqual(checked.reasons, ['time-limit-reached']);
  assert.equal(checked.requiresBudgetAdjustment, true);
});

test('reaching the task limit also stops', () => {
  let budget = emptyBudget({ limits: { maxTasks: 2 } });
  budget = consume(budget, { tasks: 1 }).budget;
  assert.equal(checkBoundary(budget).action, 'continue');
  budget = consume(budget, { tasks: 1 }).budget;
  assert.equal(checkBoundary(budget).action, 'save-and-stop');
});

test('progress is saved with completed work intact', () => {
  let budget = emptyBudget({ limits: { maxMilliseconds: 100 } });
  budget = consume(budget, { milliseconds: 150, phase: 'execute' }).budget;
  const saved = saveProgress({ budget, completed: ['a', 'b'], pending: ['c', 'd'] });
  assert.equal(saved.ok, true);
  assert.equal(saved.budget.stopped, true);
  assert.equal(saved.budget.stopReason, 'time-limit-reached');
  assert.deepEqual(saved.completed, ['a', 'b'], '已完成结果必须保留');
  assert.deepEqual(saved.pending, ['c', 'd']);
  assert.deepEqual(saved.consumedAtStop, { milliseconds: 150, tasks: 0 });
});

test('resuming keeps the consumed budget so restarts cannot reset it', () => {
  // AC-28 的关键反例：反复重启不得隐性突破预算。
  let budget = emptyBudget({ limits: { maxMilliseconds: 100 } });
  budget = consume(budget, { milliseconds: 150, phase: 'execute' }).budget;
  const saved = saveProgress({ budget });
  const resumed = resumeProgress({ saved });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.budget.consumed.milliseconds, 150, '重启后剩余预算不得回升');
  assert.equal(checkBoundary(resumed.budget).action, 'save-and-stop', '恢复后仍在边界外');
});

test('a chain of restarts still accumulates consumption', () => {
  let budget = emptyBudget({ limits: { maxMilliseconds: 1000 } });
  let saved = null;
  for (let round = 0; round < 5; round += 1) {
    budget = saved ? resumeProgress({ saved }).budget : budget;
    budget = consume(budget, { milliseconds: 300, phase: 'execute' }).budget;
    saved = saveProgress({ budget });
  }
  assert.equal(saved.budget.consumed.milliseconds, 1500, '五轮各 300ms 必须累计');
  assert.equal(checkBoundary(saved.budget).reasons.includes('time-limit-reached'), true);
});

test('an unknown cost never claims to be within a cost limit', () => {
  const budget = emptyBudget({ limits: { maxCost: 10 } });
  const recorded = recordCost(budget, { amount: null, currency: null });
  assert.equal(recorded.ok, true);
  assert.equal(recorded.budget.cost.known, false);
  assert.equal(recorded.claimsWithinCostLimit, false, '未知费用不得声称满足金额上限');
  assert.equal(checkBoundary(recorded.budget).costAccountingKnown, false);
  // 费用未知时即使超了金额上限也不触发 cost-limit-reached。
  assert.equal(checkBoundary(recorded.budget).reasons.includes('cost-limit-reached'), false);
});

test('a known cost over the limit does trigger the cost boundary', () => {
  let budget = emptyBudget({ limits: { maxCost: 10 } });
  budget = recordCost(budget, { amount: 12, currency: 'USD' }).budget;
  assert.equal(budget.cost.known, true);
  assert.equal(checkBoundary(budget).reasons.includes('cost-limit-reached'), true);
});

test('all six time phases are recorded separately', () => {
  let budget = emptyBudget();
  for (const phase of TIME_PHASES) budget = consume(budget, { milliseconds: 10, phase }).budget;
  const report = timeReport(budget);
  assert.equal(report.ok, true);
  for (const phase of TIME_PHASES) assert.equal(report.phases[phase], 10, phase);
  assert.equal(report.total, 60);
  assert.equal(report.recorded, true);
});

test('an unrecorded time report says so rather than showing a fast zero', () => {
  const report = timeReport(emptyBudget());
  assert.equal(report.recorded, false, '未记录时必须如实说明');
  assert.equal(report.total, 0);
});

test('consumption is cumulative and never replaced', () => {
  const budget = emptyBudget();
  const first = consume(budget, { milliseconds: 100, tasks: 1 }).budget;
  const second = consume(first, { milliseconds: 50, tasks: 1 }).budget;
  assert.equal(second.consumed.milliseconds, 150);
  assert.equal(second.consumed.tasks, 2);
  // 原账本不被就地修改。
  assert.equal(budget.consumed.milliseconds, 0, '输入账本必须不可变');
});

test('invalid input is refused', () => {
  assert.equal(consume(null, {}).code, 'BUDGET_INVALID');
  assert.equal(consume(emptyBudget(), { milliseconds: -1 }).code, 'BUDGET_INVALID');
  assert.equal(consume(emptyBudget(), { tasks: 1.5 }).code, 'BUDGET_INVALID');
  assert.equal(consume(emptyBudget(), { phase: 'nope' }).code, 'BUDGET_INVALID');
  assert.equal(checkBoundary(null).code, 'BUDGET_INVALID');
  assert.equal(resumeProgress({}).code, 'BUDGET_INVALID');
  assert.equal(timeReport(null).code, 'BUDGET_INVALID');
});
