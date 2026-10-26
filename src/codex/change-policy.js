import { validateChangeContract } from './project-model.js';
import { CHANGE_TYPE_HINT, isChangeType } from './core/change-types.js';
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
  // refactor 专用（M5 / SNA-0501）：允许调整的内部结构、不变的对外行为、约束。
  'internalStructure',
  'preservedBehavior',
  'constraints',
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
  if (!isChangeType(normalizedType))
    return failure('CHANGE_TYPE_INVALID', 'Supported change types: ' + CHANGE_TYPE_HINT);
  const normalizedDetails = object(details) ? { ...details } : null;
  if (!normalizedDetails)
    return failure('CHANGE_DETAILS_INVALID', 'Change details must be an object');
  return { ok: true, request, type: normalizedType, details: normalizedDetails };
}

export function validateChangeInput(value = {}) {
  if (!isChangeType(value.type))
    return failure('CHANGE_TYPE_INVALID', 'Supported change types: ' + CHANGE_TYPE_HINT);
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
  if (value.type === 'refactor') {
    // AC-19：重构必须声明「改哪些内部结构 / 哪些对外行为不变 / 受什么约束」，
    // 而不是伪装成新增功能，也不要求人为制造全红。
    if (
      !text(details.internalStructure) ||
      !text(details.preservedBehavior) ||
      !text(details.constraints)
    )
      return failure(
        'CHANGE_DETAILS_INVALID',
        'Refactor changes require internalStructure, preservedBehavior and constraints',
      );
    // 重构不得同时声称要改变对外行为：那是 modify。
    if (text(details.desiredBehavior))
      return failure(
        'CHANGE_DETAILS_INVALID',
        'Refactor changes must not declare desiredBehavior; use modify instead',
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
    requirements.some(
      (requirement) =>
        typeof requirement?.id !== 'string' ||
        !Array.isArray(requirement.acceptanceCriteria) ||
        requirement.acceptanceCriteria.length === 0,
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
