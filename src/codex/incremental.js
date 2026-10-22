const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COMMIT = /^[a-f0-9]{40,64}$/i;
const failure = (code, message) => ({ ok: false, code, message });
const list = (value) => Array.isArray(value) && value.every((entry) => ID.test(entry));

export function validateIncrementalPlan(plan) {
  if (
    !plan ||
    plan.schemaVersion !== 1 ||
    !ID.test(plan.projectId || '') ||
    !ID.test(plan.changeId || '') ||
    !ID.test(plan.parentDeliveryId || '') ||
    !COMMIT.test(plan.baselineCommit || '') ||
    !Array.isArray(plan.affectedAcIds) ||
    plan.affectedAcIds.length === 0 ||
    !plan.affectedAcIds.every((entry) => ID.test(entry)) ||
    !list(plan.reusedAcIds) ||
    !list(plan.invalidatedTestIds) ||
    !Array.isArray(plan.regressionCommands) ||
    !plan.regressionCommands.every((entry) => typeof entry === 'string' && entry.length > 0)
  )
    return failure('INCREMENT_PLAN_INVALID', 'Incremental delivery plan is invalid');
  return { ok: true };
}

export function createIncrementalPlan({ projectId, parent, contract, impact } = {}) {
  if (!parent || parent.projectId !== projectId)
    return failure(
      'PARENT_DELIVERY_PROJECT_MISMATCH',
      'Parent delivery belongs to another project',
    );
  if (parent.state !== 'delivery-accepted')
    return failure('PARENT_DELIVERY_NOT_ACCEPTED', 'Parent delivery is not accepted');
  if (!contract || contract.parentDeliveryId !== parent.deliveryId)
    return failure('PARENT_DELIVERY_MISMATCH', 'ChangeContract does not reference the parent');
  const allowed = new Set([...(parent.acceptance || []), ...(contract.acceptance || [])]);
  if (!Array.isArray(impact?.affectedAcIds) || impact.affectedAcIds.length === 0)
    return failure('INCREMENT_AC_INVALID', 'Affected acceptance criteria are required');
  if (impact.affectedAcIds.some((acId) => !allowed.has(acId)))
    return failure('INCREMENT_AC_UNKNOWN', 'Impact references an unknown acceptance criterion');
  if (
    !Array.isArray(impact.reusedAcIds) ||
    impact.reusedAcIds.some(
      (acId) => !impact.affectedAcIds.includes(acId) || !(parent.acceptance || []).includes(acId),
    )
  )
    return failure(
      'INCREMENT_AC_INCONSISTENT',
      'Reused ACs must be affected and historically accepted',
    );
  const plan = {
    schemaVersion: 1,
    projectId,
    changeId: contract.changeId,
    parentDeliveryId: parent.deliveryId,
    baselineCommit: parent.deliveryCommit,
    affectedAcIds: [...new Set(impact.affectedAcIds)],
    reusedAcIds: [...new Set(impact.reusedAcIds)],
    invalidatedTestIds: [...new Set(impact.invalidatedTestIds || [])],
    regressionCommands: [...new Set(impact.regressionCommands || [])],
  };
  const checked = validateIncrementalPlan(plan);
  return checked.ok ? { ok: true, plan } : checked;
}
