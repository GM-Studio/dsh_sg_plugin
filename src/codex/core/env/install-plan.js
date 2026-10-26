// 安装方案契约与批量批准（M3 / SNA-0304）。
//
// 目标（AC-12、AC-13；D07）：
// - 缺项时生成具体安装方案，含任务用途/组件/版本/来源/校验方式/位置/配置变动/权限，
//   缺任一即拒绝；
// - 未取得对应方案批准前不发生下载、安装或配置写入；
// - 批准后执行时若版本/来源/位置/权限与批准不一致，停止并重新申请，不沿用旧授权；
// - 批量批准逐项消费，已消费项不可复用；
// - 系统级安装、提权、换源强制重新申请。

/** 安装方案必须声明的全部字段（缺一即拒绝）。 */
export const INSTALL_PLAN_FIELDS = Object.freeze([
  'purpose',
  'component',
  'version',
  'source',
  'verification',
  'location',
  'configChanges',
  'privilege',
  'locationScope',
]);

/** 安装位置级别：用户目录/项目隔离优先，系统级需另行批准（D07）。 */
export const LOCATION_SCOPES = Object.freeze(['user', 'project', 'system']);

/** 权限级别。 */
export const PRIVILEGE_LEVELS = Object.freeze(['user', 'elevated']);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const text = (value, max = 4096) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** 校验一份安装方案是否自洽且可审阅。 */
export function validateInstallPlan(plan) {
  if (!object(plan)) return failure('INSTALL_PLAN_INVALID', '安装方案必须是对象');
  const missing = INSTALL_PLAN_FIELDS.filter((field) => !Object.hasOwn(plan, field));
  if (missing.length > 0) return failure('INSTALL_PLAN_INVALID', '安装方案缺少字段', { missing });
  const unknown = Object.keys(plan).filter((key) => !INSTALL_PLAN_FIELDS.includes(key));
  if (unknown.length > 0)
    return failure('INSTALL_PLAN_INVALID', '安装方案包含未知字段', { unknown });

  for (const field of ['purpose', 'component', 'version', 'source', 'verification', 'location'])
    if (!text(plan[field]))
      return failure('INSTALL_PLAN_INVALID', '安装方案字段为空或过长：' + field);
  if (!Array.isArray(plan.configChanges))
    return failure('INSTALL_PLAN_INVALID', 'configChanges 必须是数组');
  if (!plan.configChanges.every((entry) => text(entry, 1024)))
    return failure('INSTALL_PLAN_INVALID', 'configChanges 条目必须是有限文本');
  if (!LOCATION_SCOPES.includes(plan.locationScope))
    return failure('INSTALL_PLAN_INVALID', 'locationScope 不合法', { allowed: LOCATION_SCOPES });
  if (!PRIVILEGE_LEVELS.includes(plan.privilege))
    return failure('INSTALL_PLAN_INVALID', 'privilege 不合法', { allowed: PRIVILEGE_LEVELS });
  return { ok: true };
}

/** 该方案是否属于「必须重新申请」的高风险类别。 */
export function requiresFreshApproval(plan) {
  if (!object(plan)) return true;
  if (plan.locationScope === 'system') return true;
  if (plan.privilege === 'elevated') return true;
  return false;
}

/** 批准与方案之间必须逐字段一致的身份指纹。 */
export function planFingerprint(plan) {
  if (!object(plan)) return null;
  return JSON.stringify([
    plan.component,
    plan.version,
    plan.source,
    plan.location,
    plan.locationScope,
    plan.privilege,
  ]);
}

/**
 * 创建一次安装批准。
 * 批准绑定方案指纹，因此方案要素一变，旧批准自动失效（AC-13）。
 */
export function createInstallApproval({ planId, plan, approvedAt = null } = {}) {
  if (!text(planId, 128)) return failure('INSTALL_PLAN_INVALID', 'planId 必须是有限文本');
  if (typeof approvedAt !== 'string' || !Number.isFinite(Date.parse(approvedAt)))
    return failure('INSTALL_PLAN_INVALID', 'approvedAt 必须是合法时间戳');
  const checked = validateInstallPlan(plan);
  if (!checked.ok) return checked;
  return {
    ok: true,
    approval: {
      planId,
      fingerprint: planFingerprint(plan),
      approvedAt,
      // 高风险方案在创建时即标注：执行前必须再次确认。
      requiresFreshApproval: requiresFreshApproval(plan),
      consumedAt: null,
    },
  };
}

/**
 * 批量批准一组方案。
 * 逐项校验；任一项不合法则整批拒绝，避免「部分批准」导致状态含糊。
 */
export function approveBatch({ plans = [], approvedAt = null } = {}) {
  if (!Array.isArray(plans) || plans.length === 0)
    return failure('INSTALL_PLAN_INVALID', 'plans 必须是非空数组');
  const approvals = [];
  const rejected = [];
  for (const entry of plans) {
    const created = createInstallApproval({
      planId: entry?.planId,
      plan: entry?.plan,
      approvedAt,
    });
    if (!created.ok) {
      rejected.push({
        planId: entry?.planId ?? null,
        code: created.code,
        message: created.message,
        missing: created.missing,
      });
      continue;
    }
    approvals.push(created.approval);
  }
  // 任一项被拒 → 整批不生效（不给「部分批准」的模糊状态）。
  if (rejected.length > 0)
    return failure('INSTALL_BATCH_REJECTED', '批量批准中存在不合法方案', { rejected });
  return { ok: true, approvals };
}

/**
 * 执行前核对：方案当前的要素必须与批准时完全一致。
 * 不一致时停止并要求重新申请（AC-13）。
 */
export function authorizeExecution({ plan, approval, consumedPlanIds = [] } = {}) {
  if (!object(plan)) return failure('INSTALL_PLAN_INVALID', 'plan 必须是对象');
  if (!object(approval)) return failure('INSTALL_NOT_APPROVED', '缺少对应方案的批准');
  if (consumedPlanIds.includes(approval.planId))
    return failure('INSTALL_APPROVAL_CONSUMED', '该安装批准已被消费，不能复用');
  const checked = validateInstallPlan(plan);
  if (!checked.ok) return checked;
  // 指纹不一致：版本/来源/位置/权限之一被改动。
  if (planFingerprint(plan) !== approval.fingerprint)
    return failure('INSTALL_APPROVAL_STALE', '方案要素与批准不一致，必须重新申请（不沿用旧授权）', {
      fingerprint: planFingerprint(plan),
      approved: approval.fingerprint,
    });
  // 换源：即使指纹一致，来源变更也必须重新申请。
  if (plan.source !== undefined && approval.source !== undefined && plan.source !== approval.source)
    return failure('INSTALL_APPROVAL_STALE', '来源已变更，必须重新申请');
  if (requiresFreshApproval(plan))
    return failure('INSTALL_FRESH_APPROVAL_REQUIRED', '系统级安装或提权必须再次确认');
  return {
    ok: true,
    planId: approval.planId,
    // 授权只覆盖「执行这个安装」，不覆盖项目构建/测试/交付（AC-36）。
    coversInstallation: true,
    coversProjectBuild: false,
    coversDelivery: false,
    consumed: [...consumedPlanIds, approval.planId],
  };
}
