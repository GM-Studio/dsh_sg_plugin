import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVAL_KINDS,
  createApproval,
  validateApprovalSet,
  authorize,
  independenceMatrix,
} from '../src/codex/core/approval-separation.js';

const H = 'sha256:' + 'a'.repeat(64);
const at = '2026-10-26T00:00:00.000Z';
const approval = (kind, overrides = {}) => ({
  kind,
  artifactHash: H,
  grantedAt: at,
  grantedBy: 'user',
  consumedAt: null,
  ...overrides,
});

test('five approval kinds exist', () => {
  assert.deepEqual([...APPROVAL_KINDS].sort(), [
    'approve-delivery',
    'approve-installation',
    'approve-plan',
    'approve-requirement',
    'write-requirement-document',
  ]);
});

test('an approval must bind an artifact hash, a time and a grantor', () => {
  for (const mutate of [
    { artifactHash: null },
    { artifactHash: 'short' },
    { grantedAt: 'not-a-date' },
    { grantedBy: '' },
  ]) {
    const result = createApproval({ ...approval('approve-plan'), ...mutate });
    assert.equal(result.ok, false, JSON.stringify(mutate));
    assert.equal(result.code, 'APPROVAL_INVALID');
  }
});

test('writing the requirement document is not the same as approving the requirement', () => {
  // AC-36 的核心：写入不等于批准。
  const approvals = [approval('write-requirement-document')];
  const result = authorize({ operation: 'approve-requirement', approvals });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'APPROVAL_MISSING');
  assert.deepEqual(result.present, ['write-requirement-document'], '必须说明实际持有哪些');
});

test('every kind authorises only its own operation', () => {
  for (const kind of APPROVAL_KINDS) {
    const approvals = [approval(kind)];
    assert.equal(authorize({ operation: kind, approvals }).ok, true, kind);
    for (const other of APPROVAL_KINDS) {
      if (other === kind) continue;
      const result = authorize({ operation: other, approvals });
      assert.equal(result.ok, false, kind + ' must not authorise ' + other);
      assert.equal(result.code, 'APPROVAL_MISSING');
    }
  }
});

test('the pairwise independence matrix has ten pairs', () => {
  // C(5,2) = 10
  const matrix = independenceMatrix();
  assert.equal(matrix.count, 10);
  assert.equal(matrix.pairs.length, 10);
  for (const [left, right] of matrix.pairs) assert.notEqual(left, right);
});

test('no pair of approvals substitutes for the other', () => {
  const matrix = independenceMatrix();
  for (const [left, right] of matrix.pairs) {
    // 只持有 left 时，right 的操作被拒。
    const onlyLeft = authorize({ operation: right, approvals: [approval(left)] });
    assert.equal(onlyLeft.ok, false, left + ' -> ' + right);
    // 反向亦然。
    const onlyRight = authorize({ operation: left, approvals: [approval(right)] });
    assert.equal(onlyRight.ok, false, right + ' -> ' + left);
  }
});

test('a consumed approval cannot be reused', () => {
  const approvals = [approval('approve-delivery', { consumedAt: at })];
  const result = authorize({ operation: 'approve-delivery', approvals });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'APPROVAL_ALREADY_CONSUMED');
});

test('an approval goes stale when the approved content changes', () => {
  const other = 'sha256:' + 'b'.repeat(64);
  const approvals = [approval('approve-plan')];
  const result = authorize({ operation: 'approve-plan', approvals, artifactHash: other });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'APPROVAL_STALE');
  // 哈希一致时通过。
  assert.equal(authorize({ operation: 'approve-plan', approvals, artifactHash: H }).ok, true);
});

test('an approval set reports which kinds are missing', () => {
  const result = validateApprovalSet({
    approvals: [approval('approve-requirement'), approval('approve-plan')],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.present, ['approve-plan', 'approve-requirement']);
  assert.equal(result.missing.length, 3);
  assert.ok(result.missing.includes('approve-delivery'));
});

test('a duplicate or unknown approval kind is refused', () => {
  const duplicated = validateApprovalSet({
    approvals: [approval('approve-plan'), approval('approve-plan')],
  });
  assert.equal(duplicated.ok, false);
  assert.equal(duplicated.problems[0].code, 'DUPLICATE_KIND');

  const unknown = validateApprovalSet({ approvals: [{ kind: 'approve-everything' }] });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.problems[0].code, 'UNKNOWN_KIND');
});

test('an authorised result scopes itself to the single operation', () => {
  const result = authorize({
    operation: 'approve-installation',
    approvals: [approval('approve-installation')],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.scope, ['approve-installation']);
  assert.equal(result.grantedBy, 'user');
});

test('invalid input is refused', () => {
  assert.equal(authorize({ operation: 'nope', approvals: [] }).code, 'APPROVAL_INVALID');
  assert.equal(authorize({ operation: 'approve-plan', approvals: 'x' }).code, 'APPROVAL_INVALID');
  assert.equal(validateApprovalSet({ approvals: 'x' }).code, 'APPROVAL_INVALID');
});
