// ProjectProfile schema 演进（M1 / SNA-0104）。
//
// 问题：v2 把 Java/Vue 专属字段（javaPreset/frontendFramework/backendPackage/
// frontendLocales）放在顶层，并把 stack 硬钉为 java-vue（project-model.js:128）。
// 未知技术栈因此无法表达，与 AC-02 / AC-04 / OI-08 冲突。
//
// 本模块只做两件事：
// 1. 定义 v3 的形状与校验（capabilities + modules 取代技术栈硬绑定）；
// 2. 提供 v2 → v3 的纯函数迁移（同输入同输出，不写文件）。
//
// M1 只加 schema 与迁移器，不改检测产出（检测在 M2 / SNA-0201..0202）。
// v2 档案继续通过 validateProjectProfile，既有项目无需迁移。

export const PROFILE_SCHEMA_V2 = 2;
export const PROFILE_SCHEMA_V3 = 3;

/** v3 的模块描述：不预设前后端角色。 */
export const MODULE_ROLES = Object.freeze(['service', 'ui', 'cli', 'library', 'worker', 'other']);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const text = (value, max = 32768) =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
// 描述性字段允许空串（表示「未识别到」），但必须有界且无控制字符。
const boundedText = (value, max = 256) =>
  typeof value === 'string' && value.length <= max && !/[\r\n\0]/.test(value);

/** 能力声明：一项能力 = 类别 + 承载它的模块 + 工具链名称（可为空）。 */
function capability(value) {
  if (!object(value)) return false;
  const keys = ['id', 'kind', 'module', 'toolchain'];
  if (Object.keys(value).some((key) => !keys.includes(key))) return false;
  return (
    id(value.id) && text(value.kind, 128) && id(value.module) && boundedText(value.toolchain, 256)
  );
}

function moduleEntry(value) {
  if (!object(value)) return false;
  const keys = ['id', 'role', 'root', 'buildSystem', 'packageManager'];
  if (Object.keys(value).some((key) => !keys.includes(key))) return false;
  const roleOk = value.role === undefined || MODULE_ROLES.includes(value.role);
  return (
    id(value.id) &&
    roleOk &&
    text(value.root, 1024) &&
    boundedText(value.buildSystem, 64) &&
    boundedText(value.packageManager, 64)
  );
}

/** 观察：静态看到但未被证实的事实，带来源。 */
function observation(value) {
  if (!object(value)) return false;
  const keys = ['id', 'text', 'sourceRefs'];
  if (Object.keys(value).some((key) => !keys.includes(key))) return false;
  return (
    id(value.id) &&
    text(value.text) &&
    Array.isArray(value.sourceRefs) &&
    value.sourceRefs.length > 0 &&
    value.sourceRefs.every((ref) => text(ref, 1024))
  );
}

/**
 * 校验 v3 ProjectProfile。
 * v3 的准入不再依赖 stack 字符串，而是依赖 capabilities/modules 的自洽性。
 */
export function validateProjectProfileV3(value) {
  if (!object(value)) return failure('PROJECT_PROFILE_INVALID', 'ProjectProfile 必须是对象');
  const required = [
    'schemaVersion',
    'projectId',
    'mode',
    'root',
    'targetBranch',
    'remoteUrl',
    'commands',
    'protectedPaths',
    'capabilities',
    'modules',
    'createdAt',
    'updatedAt',
  ];
  const allowed = [...required, 'stack', 'observations', 'gaps', 'conventions'];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    return failure('PROJECT_PROFILE_INVALID', 'ProjectProfile 包含未知字段', { unknown });
  for (const key of required)
    if (!Object.hasOwn(value, key))
      return failure('PROJECT_PROFILE_INVALID', 'ProjectProfile 缺少字段 ' + key);
  if (value.schemaVersion !== PROFILE_SCHEMA_V3)
    return failure('PROJECT_PROFILE_INVALID', 'schemaVersion 必须为 3');
  if (!id(value.projectId)) return failure('PROJECT_PROFILE_INVALID', 'projectId 不合法');
  if (!['new', 'adopted'].includes(value.mode))
    return failure('PROJECT_PROFILE_INVALID', 'mode 不合法');
  if (!text(value.root)) return failure('PROJECT_PROFILE_INVALID', 'root 不合法');
  if (!text(value.targetBranch, 255))
    return failure('PROJECT_PROFILE_INVALID', 'targetBranch 不合法');
  if (!(value.remoteUrl === null || text(value.remoteUrl, 4096)))
    return failure('PROJECT_PROFILE_INVALID', 'remoteUrl 不合法');
  if (!object(value.commands)) return failure('PROJECT_COMMANDS_INVALID', 'commands 必须是对象');
  if (!Array.isArray(value.protectedPaths))
    return failure('PROJECT_PROFILE_INVALID', 'protectedPaths 必须是数组');
  if (!text(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)))
    return failure('PROJECT_PROFILE_INVALID', 'createdAt 不合法');
  if (!text(value.updatedAt) || !Number.isFinite(Date.parse(value.updatedAt)))
    return failure('PROJECT_PROFILE_INVALID', 'updatedAt 不合法');
  // stack 退化为可选描述性标签，不再参与准入。
  if (value.stack !== undefined && !text(value.stack, 128))
    return failure('PROJECT_PROFILE_INVALID', 'stack 必须是描述性字符串');
  if (!Array.isArray(value.capabilities) || !value.capabilities.every(capability))
    return failure('PROJECT_PROFILE_INVALID', 'capabilities 条目不合法');
  if (!Array.isArray(value.modules) || !value.modules.every(moduleEntry))
    return failure('PROJECT_PROFILE_INVALID', 'modules 条目不合法');
  const moduleIds = new Set(value.modules.map((entry) => entry.id));
  if (moduleIds.size !== value.modules.length)
    return failure('PROJECT_PROFILE_INVALID', 'modules 存在重复 id');
  const capabilityIds = new Set(value.capabilities.map((entry) => entry.id));
  if (capabilityIds.size !== value.capabilities.length)
    return failure('PROJECT_PROFILE_INVALID', 'capabilities 存在重复 id');
  // 能力必须挂在真实存在的模块上，否则环境计划会指向不存在的模块。
  const dangling = value.capabilities.filter((entry) => !moduleIds.has(entry.module));
  if (dangling.length > 0)
    return failure('PROJECT_PROFILE_INVALID', 'capability 引用了不存在的模块', {
      dangling: dangling.map((entry) => entry.id),
    });
  if (value.observations !== undefined) {
    if (!Array.isArray(value.observations) || !value.observations.every(observation))
      return failure('PROJECT_PROFILE_INVALID', 'observations 条目不合法');
  }
  if (value.gaps !== undefined && !Array.isArray(value.gaps))
    return failure('PROJECT_PROFILE_INVALID', 'gaps 必须是数组');
  return { ok: true };
}

/**
 * v2 → v3 纯函数迁移。
 * 同一输入恒等输出；不读盘、不写盘、不生成时间戳。
 * 缺少必要 v2 字段时返回失败，不做宽容猜测。
 */
export function migrateProfileV2ToV3(value) {
  if (!object(value)) return failure('PROFILE_MIGRATION_INVALID', 'v2 ProjectProfile 必须是对象');
  if (value.schemaVersion !== PROFILE_SCHEMA_V2)
    return failure('PROFILE_MIGRATION_INVALID', '只能迁移 schemaVersion 为 2 的档案');
  if (!id(value.projectId) || !text(value.root) || !text(value.targetBranch, 255))
    return failure('PROFILE_MIGRATION_INVALID', 'v2 档案缺少必填标识字段');

  const modules = [];
  const capabilities = [];
  const observations = [];
  const gaps = [];

  // v2 的 conventions 表达的是 Java 后端 + 前端框架；v3 把它们降级为能力与模块。
  const hasJava = value.javaPreset !== undefined || value.backendPackage !== undefined;
  const hasFrontend = value.frontendFramework !== undefined;

  if (hasJava) {
    modules.push({
      id: 'backend',
      role: 'service',
      root: '.',
      buildSystem: 'maven',
      packageManager: '',
    });
    capabilities.push({
      id: 'backend-build',
      kind: 'build',
      module: 'backend',
      toolchain: value.javaPreset || '',
    });
    if (value.backendPackage !== undefined)
      observations.push({
        id: 'backend-package',
        text: 'backendPackage = ' + String(value.backendPackage),
        sourceRefs: ['ProjectProfile.backendPackage'],
      });
  }

  if (hasFrontend) {
    modules.push({
      id: 'frontend',
      role: 'ui',
      root: '.',
      buildSystem: 'npm',
      packageManager: 'npm',
    });
    capabilities.push({
      id: 'frontend-build',
      kind: 'build',
      module: 'frontend',
      toolchain: String(value.frontendFramework),
    });
    capabilities.push({
      id: 'frontend-test',
      kind: 'test',
      module: 'frontend',
      toolchain: String(value.frontendFramework),
    });
  }

  if (modules.length === 0) gaps.push('v2 档案没有声明任何技术栈能力，v3 无法推导模块；需重新检测');

  const migrated = {
    schemaVersion: PROFILE_SCHEMA_V3,
    projectId: value.projectId,
    mode: value.mode,
    // stack 保留为描述性标签，不再参与准入。
    stack: value.stack,
    root: value.root,
    targetBranch: value.targetBranch,
    remoteUrl: value.remoteUrl,
    commands: value.commands,
    protectedPaths: value.protectedPaths,
    capabilities,
    modules,
    observations,
    gaps,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  const checked = validateProjectProfileV3(migrated);
  if (!checked.ok) return checked;
  return { ok: true, profile: migrated };
}

/** 读取任意版本的 ProjectProfile 并归一为 v3（v2 走迁移器，v3 直接返回）。 */
export function normalizeProfile(value) {
  if (!object(value)) return failure('PROJECT_PROFILE_INVALID', 'ProjectProfile 必须是对象');
  if (value.schemaVersion === PROFILE_SCHEMA_V3) {
    const checked = validateProjectProfileV3(value);
    return checked.ok ? { ok: true, profile: value, migrated: false } : checked;
  }
  if (value.schemaVersion === PROFILE_SCHEMA_V2) {
    const migrated = migrateProfileV2ToV3(value);
    return migrated.ok ? { ok: true, profile: migrated.profile, migrated: true } : migrated;
  }
  return failure('PROJECT_PROFILE_INVALID', '不支持的 schemaVersion', {
    schemaVersion: value.schemaVersion,
    supported: [PROFILE_SCHEMA_V2, PROFILE_SCHEMA_V3],
  });
}
