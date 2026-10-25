import { validateChangeContract, observableAcceptanceCriterion } from './project-model.js';

const TYPES = new Set(['feature', 'modify', 'fix']);
const DETAIL_KEYS = new Set([
  'scope',
  'nonGoals',
  'existingBehavior',
  'desiredBehavior',
  'compatibility',
  'expectedBehavior',
  'actualBehavior',
  'reproduction',
  'logs',
  'environment',
  'severity',
]);

const failure = (code, message) => ({ ok: false, code, message });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 16000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const textList = (value, maximum = 200) =>
  Array.isArray(value) && value.length <= maximum && value.every((entry) => text(entry, 4000));
const sensitive = (value) =>
  /(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/i.test(
    JSON.stringify(value),
  );

export function normalizeChangeInput({ legacyFeature = false, request, type, details = {} } = {}) {
  const normalizedType = legacyFeature ? 'feature' : (type ?? 'feature');
  if (!TYPES.has(normalizedType))
    return failure('CHANGE_TYPE_INVALID', 'Only feature, modify and fix are supported');
  const normalizedDetails = object(details) ? { ...details } : null;
  if (!normalizedDetails)
    return failure('CHANGE_DETAILS_INVALID', 'Change details must be an object');
  return { ok: true, request, type: normalizedType, details: normalizedDetails };
}

export function validateChangeInput(value = {}) {
  if (!TYPES.has(value.type))
    return failure('CHANGE_TYPE_INVALID', 'Only feature, modify and fix are supported');
  if (!text(value.request) || sensitive(value.request))
    return sensitive(value.request)
      ? failure('SENSITIVE_CHANGE_INPUT', 'Change request contains apparent credentials')
      : failure('CHANGE_REQUEST_INVALID', 'A bounded change request is required');
  if (!object(value.details) || Object.keys(value.details).some((key) => !DETAIL_KEYS.has(key)))
    return failure('CHANGE_DETAILS_INVALID', 'Change details contain unknown fields');
  const details = value.details;
  if (
    (details.scope !== undefined && !textList(details.scope)) ||
    (details.nonGoals !== undefined && !textList(details.nonGoals)) ||
    Object.entries(details).some(
      ([key, entry]) => !['scope', 'nonGoals'].includes(key) && !text(entry, 16000),
    )
  )
    return failure('CHANGE_DETAILS_INVALID', 'Change detail values are invalid');
  if (value.type === 'fix') {
    if (!text(details.expectedBehavior) || !text(details.actualBehavior))
      return failure(
        'CHANGE_DETAILS_INVALID',
        'Fix changes require expectedBehavior and actualBehavior',
      );
  }
  if (value.type === 'modify') {
    if (
      !text(details.existingBehavior) ||
      !text(details.desiredBehavior) ||
      !text(details.compatibility)
    )
      return failure(
        'CHANGE_DETAILS_INVALID',
        'Modify changes require existingBehavior, desiredBehavior and compatibility',
      );
  }
  if (sensitive(value.details))
    return failure('SENSITIVE_CHANGE_INPUT', 'Change details contain apparent credentials');
  return { ok: true };
}

export function buildChangeContract({
  changeId,
  parentDeliveryId = null,
  type,
  request,
  details = {},
  requirements,
  baselineId,
  status = 'H1_PENDING',
} = {}) {
  const input = validateChangeInput({ type, request, details });
  if (!input.ok) return input;
  if (
    !Array.isArray(requirements) ||
    requirements.length === 0 ||
    new Set(requirements.map((requirement) => requirement?.id)).size !== requirements.length ||
    requirements.some(
      (requirement) =>
        typeof requirement?.id !== 'string' ||
        !Array.isArray(requirement.acceptanceCriteria) ||
        requirement.acceptanceCriteria.length === 0 ||
        requirement.acceptanceCriteria.some(
          (criterion) => !observableAcceptanceCriterion(criterion),
        ),
    )
  )
    return failure('CHANGE_CONTRACT_INVALID', 'Requirements with acceptance criteria are required');
  const acceptance = requirements.flatMap((requirement) =>
    requirement.acceptanceCriteria.map((criterion) => criterion.id),
  );
  const contract = {
    schemaVersion: 2,
    changeId,
    parentDeliveryId,
    type,
    request,
    scope:
      details.scope?.length > 0
        ? details.scope
        : [details.desiredBehavior || details.expectedBehavior || request],
    nonGoals: details.nonGoals || [],
    acceptance,
    assumptions: [],
    risks:
      details.compatibility && /breaking|incompatible|不可兼容|破坏/i.test(details.compatibility)
        ? [details.compatibility]
        : [],
    baselineId,
    status,
  };
  const checked = validateChangeContract(contract);
  return checked.ok ? { ok: true, contract } : checked;
}
