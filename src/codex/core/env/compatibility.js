// 兼容性与可运行性判定（M3 / SNA-0302）。
//
// 目标（AC-09）：工具存在但不兼容时必须列为不兼容，
// 不能因为「文件存在」就判环境通过。
//
// 判定维度：版本、架构、项目约束、实际可运行性。
// 结果三态：compatible / incompatible / unknown。
// unknown 绝不能被当作 compatible。

/** 兼容性判定结果。 */
export const COMPATIBILITY = Object.freeze(['compatible', 'incompatible', 'unknown']);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/** 从版本字符串提取主版本号（支持 17.0.9 / 1.8.0_392 / temurin-21）。 */
export function majorOf(version) {
  const text = String(version ?? '').trim();
  if (!text) return null;
  const match = /(\d+)(?:[._](\d+))?/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  // 1.8.0_x 形式：主版本是 8 而不是 1。
  if (value === 1 && match[2] !== undefined) return Number(match[2]);
  return value;
}

/**
 * 判定单个工具的兼容性。
 * @param probe 探测结果：{ path, version, arch, exitCode, stderr }
 * @param requirement 项目约束：{ kinds, majors, arch, minVersion }
 */
export function assessTool({ tool, probe, requirement = {} } = {}) {
  if (typeof tool !== 'string' || tool.length === 0)
    return failure('COMPATIBILITY_INPUT_INVALID', 'tool 必须是非空名称');

  // 1. 未探测 / 探测无结果：unknown，不是通过。
  if (!object(probe)) return { ok: true, tool, state: 'unknown', reason: 'not-probed' };

  // 2. 探测过程失败（超时、崩溃）：unknown，不得当作不兼容也不得当作通过。
  if (probe.timedOut === true) return { ok: true, tool, state: 'unknown', reason: 'probe-timeout' };
  if (probe.exitCode !== undefined && probe.exitCode !== 0)
    return {
      ok: true,
      tool,
      state: 'incompatible',
      reason: 'probe-failed',
      detail: typeof probe.stderr === 'string' ? probe.stderr.slice(0, 512) : null,
    };

  // 3. 没有真实路径：文件存在不等于可用。
  if (typeof probe.path !== 'string' || probe.path.length === 0)
    return { ok: true, tool, state: 'incompatible', reason: 'no-executable-path' };

  // 4. 架构不匹配。
  if (requirement.arch && probe.arch && probe.arch !== requirement.arch)
    return {
      ok: true,
      tool,
      state: 'incompatible',
      reason: 'arch-mismatch',
      detail: 'expected ' + requirement.arch + ', got ' + probe.arch,
    };

  // 5. 主版本约束。
  if (Array.isArray(requirement.majors) && requirement.majors.length > 0) {
    const major = majorOf(probe.version);
    if (major === null) return { ok: true, tool, state: 'unknown', reason: 'version-unreadable' };
    if (!requirement.majors.includes(major))
      return {
        ok: true,
        tool,
        state: 'incompatible',
        reason: 'version-mismatch',
        detail: 'expected one of ' + requirement.majors.join('/') + ', got ' + major,
      };
  }

  // 6. 最低版本约束。
  if (requirement.minVersion !== undefined) {
    const major = majorOf(probe.version);
    const expected = majorOf(requirement.minVersion);
    if (major === null || expected === null)
      return { ok: true, tool, state: 'unknown', reason: 'version-unreadable' };
    if (major < expected)
      return {
        ok: true,
        tool,
        state: 'incompatible',
        reason: 'version-below-minimum',
        detail: 'requires >= ' + expected + ', got ' + major,
      };
  }

  return { ok: true, tool, state: 'compatible', reason: null, path: probe.path };
}

/**
 * 批量判定。
 * 汇总时 incompatible 与 unknown 都不计入「可用」。
 */
export function assessEnvironment({ requirements = {}, probes = {} } = {}) {
  if (!object(requirements) || !object(probes))
    return failure('COMPATIBILITY_INPUT_INVALID', 'requirements 与 probes 必须是对象');

  const tools = Object.keys(requirements).sort();
  const results = [];
  for (const tool of tools) {
    const assessed = assessTool({ tool, probe: probes[tool], requirement: requirements[tool] });
    if (!assessed.ok) return assessed;
    results.push(assessed);
  }

  const compatible = results.filter((entry) => entry.state === 'compatible');
  const incompatible = results.filter((entry) => entry.state === 'incompatible');
  const unknown = results.filter((entry) => entry.state === 'unknown');

  return {
    ok: true,
    results,
    compatible,
    incompatible,
    unknown,
    // 只有全部 compatible 才算环境通过；unknown 不算。
    environmentReady: results.length > 0 && incompatible.length === 0 && unknown.length === 0,
    // 明确的分层报告：环境结论不蕴含构建/测试/Review 结论。
    projectBuildPassed: false,
    projectTestsPassed: false,
    reviewPassed: false,
    workflowVerification: 'not-run',
  };
}

/** 从项目约束中提取工具要求（供 assessEnvironment 使用）。 */
export function requirementsFromProject({ modules = [], buildSystems = [] } = {}) {
  const requirements = {};
  const systems = new Set([
    ...(Array.isArray(buildSystems) ? buildSystems : []),
    ...(Array.isArray(modules) ? modules.flatMap((entry) => entry?.buildSystems ?? []) : []),
  ]);
  if (systems.has('maven') || systems.has('gradle')) requirements.jdk = { majors: [8, 11, 17, 21] };
  if (systems.has('maven')) requirements.maven = { minVersion: 3 };
  if (systems.has('gradle')) requirements.gradle = { minVersion: 7 };
  if (systems.has('npm') || systems.has('pnpm') || systems.has('yarn'))
    requirements.node = { minVersion: 20 };
  if (systems.has('python')) requirements.python = { minVersion: 3 };
  if (systems.has('go')) requirements.go = { minVersion: 1 };
  if (systems.has('cargo')) requirements.rust = { minVersion: 1 };
  // 始终需要 git 用于版本化交付。
  requirements.git = { minVersion: 2 };
  return requirements;
}
