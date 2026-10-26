import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PROFILE_SCHEMA_V3,
  migrateProfileV2ToV3,
  normalizeProfile,
  validateProjectProfileV3,
} from '../src/codex/core/profile-migration.js';
import { validateProjectProfile } from '../src/codex/project-model.js';

const stamp = '2026-10-26T00:00:00.000Z';

// 与既有 v2 测试所用的档案形状一致（见 test/codex-project-model.test.js:23）。
function v2Profile(overrides = {}) {
  return {
    schemaVersion: 2,
    projectId: 'project-1',
    mode: 'adopted',
    stack: 'java-vue',
    root: path.resolve('/tmp/project-1'),
    targetBranch: 'main',
    remoteUrl: null,
    commands: { install: [], build: [], test: [], lint: [], format: [], runtime: [] },
    protectedPaths: [],
    backendPackage: 'com.acme.orders',
    frontendDefaultLocale: 'zh-CN',
    frontendLocales: ['zh-CN'],
    frontendFramework: 'vue',
    javaPreset: 'jdk17-boot3.5',
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

test('a v2 ProfileProfile keeps validating unchanged in M1', () => {
  // M1 只新增 v3，不改变既有 v2 语义：既有项目不需要迁移。
  const result = validateProjectProfile(v2Profile());
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('a v2 profile migrates to v3 with capabilities bound to real modules', () => {
  const migrated = migrateProfileV2ToV3(v2Profile());
  assert.equal(migrated.ok, true, JSON.stringify(migrated));
  const profile = migrated.profile;
  assert.equal(profile.schemaVersion, PROFILE_SCHEMA_V3);
  assert.deepEqual(
    profile.modules.map((entry) => entry.id),
    ['backend', 'frontend'],
  );
  assert.deepEqual(
    profile.capabilities.map((entry) => entry.id),
    ['backend-build', 'frontend-build', 'frontend-test'],
  );
  const moduleIds = new Set(profile.modules.map((entry) => entry.id));
  for (const entry of profile.capabilities) assert.equal(moduleIds.has(entry.module), true);
  assert.equal(validateProjectProfileV3(profile).ok, true);
});

test('migration is a pure function: same input yields identical output, no writes', () => {
  const before = fs.readdirSync(os.tmpdir()).length;
  const first = migrateProfileV2ToV3(v2Profile());
  const second = migrateProfileV2ToV3(v2Profile());
  assert.deepEqual(first, second);
  // 不生成时间戳：createdAt/updatedAt 原样保留。
  assert.equal(first.profile.createdAt, stamp);
  assert.equal(first.profile.updatedAt, stamp);
  assert.equal(fs.readdirSync(os.tmpdir()).length, before, '迁移不得写盘');
});

test('migrated profile no longer requires the java-vue stack value', () => {
  const unknown = migrateProfileV2ToV3(v2Profile({ stack: 'something-else' }));
  assert.equal(unknown.ok, true, '未知 stack 不应让 v3 迁移失败');
  assert.equal(unknown.profile.stack, 'something-else', 'stack 保留为描述性标签');
  // 准入不再看 stack，而看 capabilities/modules 自洽性。
  assert.equal(validateProjectProfileV3(unknown.profile).ok, true);
});

test('v3 rejects a capability that points at a missing module', () => {
  const migrated = migrateProfileV2ToV3(v2Profile()).profile;
  migrated.capabilities.push({ id: 'ghost', kind: 'build', module: 'nope', toolchain: '' });
  const result = validateProjectProfileV3(migrated);
  assert.equal(result.ok, false);
  assert.deepEqual(result.dangling, ['ghost']);
});

test('v3 rejects missing capabilities/modules arrays', () => {
  for (const mutate of [
    (profile) => delete profile.capabilities,
    (profile) => delete profile.modules,
    (profile) => {
      profile.capabilities = 'nope';
    },
    (profile) => {
      profile.modules = {};
    },
  ]) {
    const profile = structuredClone(migrateProfileV2ToV3(v2Profile()).profile);
    mutate(profile);
    assert.equal(validateProjectProfileV3(profile).ok, false);
  }
});

test('v3 rejects unknown fields and duplicate ids', () => {
  const base = migrateProfileV2ToV3(v2Profile()).profile;
  const extra = structuredClone(base);
  extra.unexpected = true;
  const extraResult = validateProjectProfileV3(extra);
  assert.equal(extraResult.ok, false);
  assert.deepEqual(extraResult.unknown, ['unexpected']);
  assert.equal(extraResult.code, 'PROJECT_PROFILE_INVALID');

  const duplicated = structuredClone(base);
  duplicated.modules.push({ ...duplicated.modules[0] });
  assert.equal(validateProjectProfileV3(duplicated).ok, false);

  const duplicatedCapability = structuredClone(base);
  duplicatedCapability.capabilities.push({ ...duplicatedCapability.capabilities[0] });
  assert.equal(validateProjectProfileV3(duplicatedCapability).ok, false);
});

test('migrating a non-v2 profile is refused rather than guessed', () => {
  for (const value of [
    { ...v2Profile(), schemaVersion: 3 },
    { ...v2Profile(), schemaVersion: 1 },
    null,
    {},
  ]) {
    const result = migrateProfileV2ToV3(value);
    assert.equal(result.ok, false, JSON.stringify(value));
    assert.equal(result.code, 'PROFILE_MIGRATION_INVALID');
  }
});

test('normalizeProfile reports whether a migration happened', () => {
  const fromV2 = normalizeProfile(v2Profile());
  assert.equal(fromV2.ok, true);
  assert.equal(fromV2.migrated, true);

  const fromV3 = normalizeProfile(fromV2.profile);
  assert.equal(fromV3.ok, true);
  assert.equal(fromV3.migrated, false);
  assert.deepEqual(fromV3.profile, fromV2.profile);

  const unsupported = normalizeProfile({ schemaVersion: 99 });
  assert.equal(unsupported.ok, false);
  assert.deepEqual(unsupported.supported, [2, 3]);
});

test('a v2 profile without stack conventions yields gaps instead of invented modules', () => {
  const bare = migrateProfileV2ToV3(
    v2Profile({
      backendPackage: undefined,
      frontendFramework: undefined,
      frontendLocales: undefined,
      frontendDefaultLocale: undefined,
      javaPreset: undefined,
    }),
  );
  assert.equal(bare.ok, true);
  assert.deepEqual(bare.profile.modules, []);
  assert.deepEqual(bare.profile.capabilities, []);
  assert.equal(bare.profile.gaps.length, 1, '必须显式说明无法推导模块，而不是编造');
});

test('M1 does not change the detection path to emit v3 yet', async () => {
  const { fileURLToPath } = await import('node:url');
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  for (const file of ['src/codex/project-detect.js', 'src/codex/project-adopt.js']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(text.includes('profile-migration'), false, file + ' 属于 M2 范围');
  }
  // project-model 仍然导出 v2 校验器（未删除既有语义）。
  assert.equal(typeof validateProjectProfile, 'function');
});
