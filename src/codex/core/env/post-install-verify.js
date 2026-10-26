// 隔离安装位置与安装后真实复验（M3 / SNA-0305）。
//
// 目标（AC-14、AC-15）：
// - 优先用户目录或项目隔离位置；系统级位置需独立批准；
// - 安装命令成功但复验失败时，环境状态仍不能通过；
// - 复验逐能力执行，不因一项通过而标记全部通过；
// - 环境通过、项目构建通过、测试通过、Review 通过四者互不蕴含；
// - 下载/校验/权限/网络失败时保留已完成结果与阻塞原因，不自动放宽来源或权限。

import path from 'node:path';

/** 复验结果三态：只有 verified 算通过。 */
export const VERIFY_STATES = Object.freeze(['verified', 'failed', 'not-run', 'timeout']);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * 选择安装位置。
 * 优先项目隔离，其次用户目录；系统级必须显式要求且带批准。
 */
export function chooseInstallLocation({
  root,
  component,
  scope = 'project',
  systemApproved = false,
} = {}) {
  if (typeof component !== 'string' || component.length === 0)
    return failure('INSTALL_LOCATION_INVALID', 'component 必须是非空名称');
  if (!['project', 'user', 'system'].includes(scope))
    return failure('INSTALL_LOCATION_INVALID', 'scope 不合法', {
      allowed: ['project', 'user', 'system'],
    });
  if (scope === 'project') {
    if (typeof root !== 'string' || root.length === 0)
      return failure('INSTALL_LOCATION_INVALID', '项目隔离安装需要项目根路径');
    return {
      ok: true,
      scope: 'project',
      path: path.join(root, '.specgate', 'toolchains', component),
      requiresElevation: false,
    };
  }
  if (scope === 'user') {
    return {
      ok: true,
      scope: 'user',
      path: path.join('~', '.specgate', 'toolchains', component),
      requiresElevation: false,
    };
  }
  // 系统级：需独立批准。
  if (systemApproved !== true)
    return failure('INSTALL_SYSTEM_APPROVAL_REQUIRED', '系统级安装位置需要独立批准');
  return {
    ok: true,
    scope: 'system',
    path: path.join('/opt', 'specgate', component),
    requiresElevation: true,
  };
}

/**
 * 安装后逐能力复验。
 * 关键：安装命令退出 0 不代表可用；必须逐项探测真实可运行性。
 */
export function verifyAfterInstall({ capabilities = [], probes = {} } = {}) {
  if (!Array.isArray(capabilities))
    return failure('INSTALL_VERIFY_INVALID', 'capabilities 必须是数组');
  if (!object(probes)) return failure('INSTALL_VERIFY_INVALID', 'probes 必须是对象');

  const results = [];
  for (const capability of capabilities) {
    if (!object(capability) || typeof capability.id !== 'string') continue;
    const probe = probes[capability.id];
    let state = 'not-run';
    let detail = null;
    if (object(probe)) {
      if (probe.timedOut === true) {
        state = 'timeout';
        detail = '复验探测超时';
      } else if (probe.exitCode !== undefined && probe.exitCode !== 0) {
        state = 'failed';
        detail = (probe.stderr || '').slice(0, 512) || '复验命令非零退出';
      } else if (typeof probe.path !== 'string' || probe.path.length === 0) {
        state = 'failed';
        detail = '复验未得到真实可执行路径';
      } else if (typeof probe.version !== 'string' && probe.major === undefined) {
        state = 'failed';
        detail = '复验未得到版本信息';
      } else state = 'verified';
    }
    results.push({
      id: capability.id,
      kind: capability.kind ?? null,
      state,
      detail,
      path: object(probe) ? (probe.path ?? null) : null,
    });
  }

  const verified = results.filter((entry) => entry.state === 'verified');
  const failed = results.filter((entry) => entry.state === 'failed');
  const notRun = results.filter((entry) => entry.state === 'not-run');
  const timedOut = results.filter((entry) => entry.state === 'timeout');

  return {
    ok: true,
    results,
    verified,
    failed,
    notRun,
    timedOut,
    // 只有全部 verified 才算环境就绪；任一 not-run 也不算通过。
    environmentReady: results.length > 0 && verified.length === results.length,
    // 四类结论分别表达，互不蕴含（AC-15）。
    projectBuildPassed: false,
    projectTestsPassed: false,
    reviewPassed: false,
    workflowVerification: 'not-run',
  };
}

/**
 * 汇总一次安装尝试的结果。
 * 失败时必须保留已完成部分与阻塞原因（E2E-04 前置）。
 */
export function summarizeInstallAttempt({ plan, install, verification } = {}) {
  if (!object(plan)) return failure('INSTALL_ATTEMPT_INVALID', 'plan 必须是对象');
  if (!object(install)) return failure('INSTALL_ATTEMPT_INVALID', 'install 必须是对象');

  const outcome = {
    planId: plan.component ?? null,
    // 安装命令层面是否成功。
    installSucceeded: install.exitCode === 0,
    installExitCode: install.exitCode ?? null,
    // 环境层面是否就绪：只看真实复验，不看安装命令是否成功（AC-14）。
    environmentReady: false,
    blockedReason: null,
    completed: [],
    verification: null,
  };

  if (install.exitCode !== 0) {
    outcome.blockedReason = install.timedOut === true ? 'install-timeout' : 'install-failed';
    // 保留已完成部分，不重置为「什么都没发生」。
    outcome.completed = Array.isArray(install.completed) ? [...install.completed] : [];
    outcome.detail = typeof install.stderr === 'string' ? install.stderr.slice(0, 512) : null;
    return { ok: true, outcome };
  }

  if (!object(verification)) {
    outcome.blockedReason = 'verification-missing';
    outcome.completed = Array.isArray(install.completed) ? [...install.completed] : [];
    outcome.detail = '安装命令成功但没有复验证据，环境仍不能通过';
    return { ok: true, outcome };
  }

  outcome.verification = verification;
  outcome.environmentReady = verification.environmentReady === true;
  if (!outcome.environmentReady) outcome.blockedReason = 'verification-failed';

  // 明确：安装成功 + 复验通过 ≠ 项目构建/测试/Review 通过。
  outcome.projectBuildPassed = false;
  outcome.projectTestsPassed = false;
  outcome.reviewPassed = false;
  outcome.workflowVerification = 'not-run';
  return { ok: true, outcome };
}

/**
 * 失败后的处置策略：只保留现状，不放宽来源或权限。
 */
export function failurePolicy({ reason } = {}) {
  const policies = {
    'install-failed': {
      retryWithDifferentSource: false,
      retryWithElevation: false,
      skipVerification: false,
    },
    'install-timeout': {
      retryWithDifferentSource: false,
      retryWithElevation: false,
      skipVerification: false,
    },
    'verification-failed': {
      retryWithDifferentSource: false,
      retryWithElevation: false,
      skipVerification: false,
    },
    'verification-missing': {
      retryWithDifferentSource: false,
      retryWithElevation: false,
      skipVerification: false,
    },
    'checksum-failed': {
      retryWithDifferentSource: false,
      retryWithElevation: false,
      skipVerification: false,
    },
    'permission-denied': {
      retryWithDifferentSource: false,
      retryWithElevation: false,
      skipVerification: false,
    },
    'network-failed': {
      retryWithDifferentSource: false,
      retryWithElevation: false,
      skipVerification: false,
    },
  };
  return {
    ok: true,
    reason: reason ?? null,
    // 任何一种失败都不自动放宽：换源、提权、跳过复验一律需要新的批准。
    policy: policies[reason] ?? {
      retryWithDifferentSource: false,
      retryWithElevation: false,
      skipVerification: false,
    },
    requiresNewApproval: true,
  };
}
