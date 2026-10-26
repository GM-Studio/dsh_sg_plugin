import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUPPORTED_PLATFORMS,
  RESERVED_PLATFORMS,
  SUPPORT_LEVELS,
  platformSupport,
  isKnownPlatform,
  pathSeparator,
  directorySeparator,
  joinPath,
  executableNames,
  requiresShell,
  nullDevice,
  isCaseInsensitive,
  normalizeForCompare,
  PLATFORM_LAYER_MODULE,
} from '../src/codex/core/platform.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('only win32 and linux x64 are supported in the first release', () => {
  assert.deepEqual([...SUPPORTED_PLATFORMS].sort(), ['linux', 'win32']);
  for (const platform of SUPPORTED_PLATFORMS) {
    const result = platformSupport(platform, 'x64');
    assert.equal(result.level, 'supported', platform);
    assert.equal(result.reason, null);
  }
});

test('macOS and ARM64 are reserved, never supported', () => {
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['win32', 'arm64'],
  ]) {
    const result = platformSupport(platform, arch);
    assert.equal(result.level, 'reserved', platform + '/' + arch);
    assert.notEqual(result.level, 'supported', 'AC-17：预留不得冒充已支持');
  }
});

test('an unknown platform is unverified rather than defaulting to Windows behaviour', () => {
  for (const platform of ['aix', 'freebsd', 'sunos', 'something']) {
    const result = platformSupport(platform, 'x64');
    assert.equal(result.level, 'unverified', platform);
    assert.equal(result.reason, 'unknown-platform-or-architecture');
  }
});

test('support levels are a closed set of three values', () => {
  assert.deepEqual([...SUPPORT_LEVELS].sort(), ['reserved', 'supported', 'unverified']);
});

test('reserved platforms remain recognisable', () => {
  for (const platform of [...SUPPORTED_PLATFORMS, ...RESERVED_PLATFORMS]) {
    assert.equal(isKnownPlatform(platform), true, platform);
  }
  assert.equal(isKnownPlatform('aix'), false);
});

test('executable names follow the platform', () => {
  assert.deepEqual(executableNames('mvn', 'win32'), ['mvn.exe', 'mvn.cmd', 'mvn.bat', 'mvn']);
  assert.deepEqual(executableNames('mvn', 'linux'), ['mvn']);
  assert.deepEqual(executableNames('mvn', 'darwin'), ['mvn'], '遗留平台按 POSIX 处理');
});

test('path separators and joins are consistent across platforms', () => {
  assert.equal(pathSeparator('win32'), ';');
  assert.equal(pathSeparator('linux'), ':');
  assert.equal(directorySeparator('win32'), String.fromCharCode(92), 'Windows 目录分隔符是反斜杠');
  assert.equal(directorySeparator('linux'), '/');
  assert.equal(joinPath('/a;/b', '/c', 'win32'), '/a;/b;/c');
  assert.equal(joinPath('/a:/b', '/c', 'linux'), '/a:/b:/c');
  assert.equal(joinPath('', '/c', 'linux'), '/c');
});

test('shell, null device and case sensitivity follow the platform', () => {
  assert.equal(requiresShell('win32'), true);
  assert.equal(requiresShell('linux'), false);
  assert.equal(nullDevice('win32'), 'NUL');
  assert.equal(nullDevice('linux'), '/dev/null');
  assert.equal(isCaseInsensitive('win32'), true);
  assert.equal(isCaseInsensitive('linux'), false);
  assert.equal(normalizeForCompare('C:/Temp/A', 'win32'), 'c:/temp/a');
  assert.equal(normalizeForCompare('C:/Temp/A', 'linux'), 'C:/Temp/A');
});

test('the platform layer is the single authoritative implementation', () => {
  // 机械检查：平台层必须导出一套完整的能力，业务代码可据此收敛。
  const source = fs.readFileSync(path.join(root, PLATFORM_LAYER_MODULE), 'utf8');
  for (const exported of [
    'platformSupport',
    'executableNames',
    'pathSeparator',
    'directorySeparator',
    'joinPath',
    'requiresShell',
    'nullDevice',
    'isCaseInsensitive',
    'normalizeForCompare',
  ])
    assert.match(source, new RegExp('export function ' + exported), exported);
});

test('business modules can be scanned for remaining direct platform checks', () => {
  // 这条断言记录当前收敛进度，而不是要求立刻归零：
  // 目标是让「还有多少处散落判断」可被机械统计并逐步下降。
  const walk = (directory) => {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...walk(target));
      else if (entry.name.endsWith('.js')) files.push(target);
    }
    return files;
  };
  const files = walk(path.join(root, 'src/codex'));
  const offenders = [];
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative === PLATFORM_LAYER_MODULE) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (/process.platforms*===?s*'win32'/.test(source)) offenders.push(relative);
  }
  // 已收敛的模块不得再出现直接判断。
  for (const converged of ['src/codex/core/env/discovery-bounds.js'])
    assert.equal(offenders.includes(converged), false, converged + ' 应使用平台层');
  // 记录剩余数量，保证不会因为新增代码而无限增长。
  assert.ok(offenders.length <= 134, '散落判断数量不得增加（当前基线 134）');
});

test('platform behaviour is pure and does not read the ambient environment', () => {
  // 所有函数都接受显式 platform 参数，因此可在任意宿主上测试另一平台的行为。
  const before = process.platform;
  const snapshot = [];
  for (const platform of ['win32', 'linux'])
    snapshot.push(JSON.stringify(platformSupport(platform, 'x64')));
  assert.equal(process.platform, before, '调用不得改变宿主平台');
  assert.notEqual(snapshot[0], snapshot[1]);
});
