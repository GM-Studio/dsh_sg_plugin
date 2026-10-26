// 能力需求推导（M3 / SNA-0301）。
//
// 目标（AC-08、AC-11）：
// - 所需能力从「项目事实 + 拟执行任务」推导，而不是从固定的 JDK/Boot/Vue 预设；
// - 已存在的兼容工具优先复用，不重复安装；
// - 只准备当前任务需要的能力，不安装全部已知技术栈工具。
//
// 与既有 environment.js 的关系：既有 planEnvironment 以固定预设为入口，
// 本模块提供能力推导作为权威来源；预设降级为可选快捷方式（见 04-rebaseline-record §7）。

/** 能力类别（与 suites.js 的 kind 口径一致）。 */
export const CAPABILITY_KINDS = Object.freeze(['build', 'test', 'lint', 'format', 'runtime']);

/**
 * 构建系统 → 该任务真正需要的工具。
 * 关键点：跑 maven 不需要 node；跑 pytest 不需要 jdk。
 */
const TOOLCHAINS = Object.freeze({
  maven: { tools: ['jdk', 'maven'], language: 'java' },
  gradle: { tools: ['jdk', 'gradle'], language: 'java' },
  npm: { tools: ['node'], language: 'javascript' },
  pnpm: { tools: ['node'], language: 'javascript' },
  yarn: { tools: ['node'], language: 'javascript' },
  python: { tools: ['python'], language: 'python' },
  poetry: { tools: ['python'], language: 'python' },
  uv: { tools: ['python'], language: 'python' },
  pip: { tools: ['python'], language: 'python' },
  go: { tools: ['go'], language: 'go' },
  cargo: { tools: ['rust'], language: 'rust' },
  dotnet: { tools: ['dotnet'], language: 'csharp' },
  cmake: { tools: ['cmake', 'cxx'], language: 'cpp' },
  make: { tools: ['make'], language: 'unknown' },
  bundler: { tools: ['ruby'], language: 'ruby' },
  composer: { tools: ['php'], language: 'php' },
});

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/** 某构建系统需要哪些工具。未知构建系统返回空集并记录缺口。 */
export function toolsForBuildSystem(buildSystem) {
  const entry = TOOLCHAINS[buildSystem];
  if (!entry) return { ok: true, tools: [], known: false };
  return { ok: true, tools: [...entry.tools], known: true };
}

/**
 * 从一批任务推导所需能力。
 * 任务形如 { id, kind, buildSystem, module }。
 * 无构建需求的任务（纯文档）→ 能力为空集，不安装任何工具（AC-11）。
 */
export function deriveCapabilities({ tasks = [], modules = [] } = {}) {
  if (!Array.isArray(tasks)) return failure('CAPABILITY_INPUT_INVALID', 'tasks 必须是数组');
  if (!Array.isArray(modules)) return failure('CAPABILITY_INPUT_INVALID', 'modules 必须是数组');

  const moduleById = new Map();
  for (const entry of modules) {
    if (!object(entry) || typeof entry.id !== 'string') continue;
    moduleById.set(entry.id, entry);
  }

  const required = new Map();
  const capabilities = [];
  const gaps = [];

  for (const task of tasks) {
    if (!object(task)) continue;
    const buildSystem =
      typeof task.buildSystem === 'string'
        ? task.buildSystem
        : moduleById.get(task.module)?.buildSystems?.[0] || null;

    if (!buildSystem) {
      // 纯文档/配置类任务：不产生工具能力。
      gaps.push({
        task: task.id ?? null,
        reason: 'no-build-system',
        detail: '该任务不需要构建工具，未推导任何工具链能力',
      });
      continue;
    }

    const mapped = toolsForBuildSystem(buildSystem);
    if (!mapped.known) {
      gaps.push({
        task: task.id ?? null,
        reason: 'unknown-build-system',
        detail: '未知构建系统：' + buildSystem,
      });
      continue;
    }

    capabilities.push({
      task: task.id ?? null,
      kind: CAPABILITY_KINDS.includes(task.kind) ? task.kind : 'build',
      module: task.module ?? null,
      buildSystem,
      tools: [...mapped.tools],
    });
    for (const tool of mapped.tools) {
      if (!required.has(tool)) required.set(tool, new Set());
      required.get(tool).add(task.id ?? 'unknown');
    }
  }

  return {
    ok: true,
    // 只含当前任务真正需要的工具（AC-11）。
    requiredTools: [...required.keys()].sort(),
    requestedBy: Object.fromEntries(
      [...required.entries()].map(([tool, tasks]) => [tool, [...tasks].sort()]),
    ),
    capabilities,
    gaps,
  };
}

/**
 * 判定每项所需工具是「复用」还是「缺项」（AC-08）。
 * 只做判定，不安装。
 */
export function resolveTools({ requiredTools = [], discovered = {} } = {}) {
  const reuse = [];
  const missing = [];
  for (const tool of requiredTools) {
    const found = discovered[tool];
    // discovered 里必须带真实路径/版本才算复用，仅「文件存在」不算。
    const usable =
      object(found) &&
      typeof found.path === 'string' &&
      found.path.length > 0 &&
      (typeof found.version === 'string' || found.major !== undefined);
    if (usable) reuse.push({ tool, ...found });
    else missing.push({ tool, observed: found ?? null });
  }
  return {
    ok: true,
    reuse,
    missing,
    // 环境是否就绪只看缺项，与项目构建/测试/Review 结论完全分离（AC-15）。
    environmentReady: missing.length === 0,
    workflowVerification: 'not-run',
    projectBuildPassed: false,
    projectTestsPassed: false,
    reviewPassed: false,
  };
}
