// 平台差异的单一收敛点（M4 / SNA-0401）。
//
// 目标（NFR-08）：
// - 平台差异能被隔离，而不是散落在流程代码里；
// - 未知平台返回 unsupported，而不是默认 Windows 行为；
// - 可执行名解析、路径分隔、环境变量分隔集中于此。
//
// 说明：本模块不承揽既有 134 处调用的全部迁移（那是跨 M4/M5 的渐进工作）。
// 它提供唯一权威实现，并让「散落判断」可以被机械扫描与逐步收敛。

/** 受支持平台（首期真实验收范围，D02）。 */
export const SUPPORTED_PLATFORMS = Object.freeze(['win32', 'linux']);

/**
 * 预留平台：可被识别、可被表达，但未完成真实验收（AC-17）。
 * 预留不等于已支持或已验证。
 */
export const RESERVED_PLATFORMS = Object.freeze(['darwin']);
/** 预留架构。 */
export const RESERVED_ARCHITECTURES = Object.freeze(['arm64']);

/** 平台等级三态。 */
export const SUPPORT_LEVELS = Object.freeze(['supported', 'reserved', 'unverified']);

const WINDOWS = 'win32';
const DARWIN = 'darwin';

/**
 * 判定平台支持等级。
 * 只认三态；未知平台一律 unverified，绝不默认成 Windows 行为。
 */
export function platformSupport(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' || arch === 'arm64') {
    // macOS 与 ARM64 均为预留：即使有代码分支也不能自称 supported。
    return { platform, arch, level: 'reserved', reason: 'reserved-platform-or-architecture' };
  }
  if (SUPPORTED_PLATFORMS.includes(platform) && arch === 'x64')
    return { platform, arch, level: 'supported', reason: null };
  return { platform, arch, level: 'unverified', reason: 'unknown-platform-or-architecture' };
}

/** 是否为已知平台（用于平台层内部判断，不供业务代码直接使用）。 */
export function isKnownPlatform(platform = process.platform) {
  return SUPPORTED_PLATFORMS.includes(platform) || RESERVED_PLATFORMS.includes(platform);
}

/** 路径分隔符。 */
export function pathSeparator(platform = process.platform) {
  return platform === WINDOWS ? ';' : ':';
}

/** 目录分隔符。 */
export function directorySeparator(platform = process.platform) {
  return platform === WINDOWS ? '\\' : '/';
}

/** 追加环境变量路径（跨平台语义一致）。 */
export function joinPath(prepend, existing, platform = process.platform) {
  const separator = pathSeparator(platform);
  const head = String(prepend || '')
    .split(separator)
    .filter(Boolean);
  const tail = String(existing || '')
    .split(separator)
    .filter(Boolean);
  return [...head, ...tail].join(separator);
}

/**
 * 可执行文件候选名。
 * Windows 需要 .exe/.cmd/.bat 与无后缀；POSIX 只需原名。
 */
export function executableNames(name, platform = process.platform) {
  if (platform === WINDOWS) return [name + '.exe', name + '.cmd', name + '.bat', name];
  return [name];
}

/** 是否需要 shell 才能执行带参数的命令（Windows 的 .cmd/.bat）。 */
export function requiresShell(platform = process.platform) {
  return platform === WINDOWS;
}

/** 空设备路径。 */
export function nullDevice(platform = process.platform) {
  return platform === WINDOWS ? 'NUL' : '/dev/null';
}

/** 路径大小写是否不敏感（影响去重与比较）。 */
export function isCaseInsensitive(platform = process.platform) {
  return platform === WINDOWS || platform === DARWIN;
}

/** 归一化用于比较的路径。 */
export function normalizeForCompare(value, platform = process.platform) {
  const text = String(value ?? '');
  return isCaseInsensitive(platform) ? text.toLowerCase() : text;
}

/**
 * 供机械检查使用：本模块是允许出现平台判断的唯一位置。
 * 业务代码若要判断平台，应调用此处的函数。
 */
export const PLATFORM_LAYER_MODULE = 'src/codex/core/platform.js';
