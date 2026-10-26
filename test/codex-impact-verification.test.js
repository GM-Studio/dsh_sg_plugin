import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KERNEL_PATHS,
  ACCEPTANCE_NATURES,
  isKernelChange,
  selectVerification,
  validateAcceptanceNature,
} from '../src/codex/core/impact.js';

test('three acceptance natures exist and runtime constraints are one of them', () => {
  assert.deepEqual([...ACCEPTANCE_NATURES].sort(), [
    'business-goal',
    'regression-guard',
    'runtime-constraint',
  ]);
});

test('a change touching the workflow kernel is detected with its evidence', () => {
  // AC-31 的前置判定。
  const result = isKernelChange({ changedFiles: ['src/codex/state-machine.js'] });
  assert.equal(result.ok, true);
  assert.equal(result.isKernel, true);
  assert.deepEqual(result.kernelFiles, ['src/codex/state-machine.js']);
  assert.match(result.rationale, /必须执行真实完整闭环/);
});

test('a change outside the kernel is not a kernel change', () => {
  const result = isKernelChange({ changedFiles: ['docs/readme.md', 'src/codex/locale.js'] });
  assert.equal(result.isKernel, false);
  assert.deepEqual(result.kernelFiles, []);
});

test('kernel detection normalises windows separators', () => {
  const result = isKernelChange({ changedFiles: ['src\\codex\\plan.js'] });
  assert.equal(result.isKernel, true);
});

test('a routine change does not get the full business canary', () => {
  // AC-30：常规变更不无条件附加完整业务金丝雀。
  const result = selectVerification({
    changedFiles: ['src/codex/locale.js'],
    affectedModules: ['locale'],
    availableChecks: ['unit', 'lint', 'business-canary'],
    criticalVersion: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.selected.includes('business-canary'), false);
  assert.equal(result.requiresFullClosure, false);
  assert.ok(result.skipped.some((entry) => entry.check === 'business-canary'));
});

test('a kernel change requires the full closure and the canary', () => {
  const result = selectVerification({
    changedFiles: ['src/codex/quality.js'],
    availableChecks: ['unit', 'business-canary'],
  });
  assert.equal(result.requiresFullClosure, true);
  assert.equal(result.selected.includes('business-canary'), true);
});

test('a critical version also requires the full closure', () => {
  const result = selectVerification({
    changedFiles: ['src/codex/locale.js'],
    availableChecks: ['unit', 'business-canary'],
    criticalVersion: true,
  });
  assert.equal(result.requiresFullClosure, true);
  assert.equal(result.selected.includes('business-canary'), true);
});

test('the selection always states its rationale', () => {
  const result = selectVerification({
    changedFiles: ['src/a.js'],
    affectedModules: ['a'],
    availableChecks: ['unit'],
  });
  assert.ok(result.rationale.length >= 2, '必须说明为什么运行这些检查');
  assert.ok(result.rationale.some((line) => line.includes('受影响模块')));
});

test('an empty uncovered list must be justified', () => {
  const result = selectVerification({
    changedFiles: [],
    affectedModules: [],
    availableChecks: ['unit'],
  });
  assert.deepEqual(result.uncovered, []);
  assert.match(result.coverageJustification, /未识别到受影响模块/);
});

test('an established runtime constraint cannot be required to go red first', () => {
  // AC-32：历史缺陷的直接防回归。
  const result = validateAcceptanceNature({
    criteria: [{ id: 'AC-1', nature: 'runtime-constraint', requiresRedBaseline: true }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACCEPTANCE_MODELLING_INVALID');
  assert.equal(result.problems[0].code, 'CONSTRAINT_REQUIRES_RED');
});

test('a business goal may legitimately require a red baseline', () => {
  const result = validateAcceptanceNature({
    criteria: [{ id: 'AC-1', nature: 'business-goal', requiresRedBaseline: true }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.businessGoals, 1);
});

test('an unknown acceptance nature is reported', () => {
  const result = validateAcceptanceNature({ criteria: [{ id: 'AC-1', nature: 'whatever' }] });
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].code, 'NATURE_UNKNOWN');
});

test('the three natures are counted separately', () => {
  const result = validateAcceptanceNature({
    criteria: [
      { id: 'AC-1', nature: 'business-goal' },
      { id: 'AC-2', nature: 'regression-guard' },
      { id: 'AC-3', nature: 'runtime-constraint' },
      { id: 'AC-4', nature: 'runtime-constraint' },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, { businessGoals: 1, regressionGuards: 1, runtimeConstraints: 2 });
});

test('the kernel path list is bounded and declared', () => {
  assert.ok(KERNEL_PATHS.length > 0);
  for (const entry of KERNEL_PATHS) assert.equal(entry.startsWith('src/codex/'), true, entry);
});

test('invalid input is refused', () => {
  assert.equal(isKernelChange({ changedFiles: 'x' }).code, 'IMPACT_INPUT_INVALID');
  assert.equal(validateAcceptanceNature({ criteria: 'x' }).code, 'IMPACT_INPUT_INVALID');
});
