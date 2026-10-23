import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { publishInitialization } from '../src/codex/init-publication.js';
import { createNativeInitConsent } from '../src/codex/init-consent.js';
import { executeInit, previewInit } from '../src/codex/init.js';
import { createToolRegistry } from '../src/codex/workflow-tools.js';

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-init-publication-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const identity = { kind: 'user', id: 'fixture', source: 'test-native-form' };
const inputFor = (root) => ({
  root,
  company: 'acme',
  business: 'hotel',
  preset: 'jdk8-boot2.7',
  frontend: 'vue',
});

test('native form submission confirms initialization only inside its bound scope', async () => {
  const binding = {
    identity,
    root: path.resolve('fixture'),
    preset: 'jdk8-boot2.7',
    policy: '保留已有文件，只补齐缺失文件',
  };
  const challenge = {
    action: 'init',
    root: binding.root,
    preset: binding.preset,
    strategy: 'keep-missing',
    conflicts: [{ path: 'README.md', decision: 'keep' }],
    previewHash: 'a'.repeat(64),
  };
  for (const response of [
    { action: 'accept', content: {} },
    { action: 'accept', content: { confirm: false } },
  ])
    assert.equal(
      (await createNativeInitConsent({ ...binding, response }).requestApproval(challenge)).approved,
      true,
    );
  assert.equal(
    (
      await createNativeInitConsent({
        ...binding,
        response: { action: 'decline' },
      }).requestApproval(challenge)
    ).approved,
    false,
  );
  const consent = createNativeInitConsent({
    ...binding,
    response: { action: 'accept', content: { confirm: true } },
  });
  assert.equal((await consent.requestApproval(challenge)).approved, true);
  for (const patch of [
    { root: path.resolve('other') },
    { preset: 'jdk17-boot3.5' },
    { strategy: 'overwrite' },
    { conflicts: [{ path: 'README.md', decision: 'overwrite' }] },
  ])
    assert.equal((await consent.requestApproval({ ...challenge, ...patch })).approved, false);
});

test('publication rolls back created files and managed edits without deleting retained user files', (t) => {
  const root = temporary(t),
    target = path.join(root, 'target'),
    source = path.join(root, 'source');
  fs.mkdirSync(target);
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(target, 'AGENTS.md'), 'User instructions\n');
  fs.writeFileSync(path.join(target, 'business.txt'), 'Keep business\n');
  fs.writeFileSync(path.join(source, 'AGENTS.md'), 'User instructions\nManaged addition\n');
  fs.writeFileSync(path.join(source, 'new.txt'), 'generated');
  fs.writeFileSync(path.join(source, 'fail.txt'), 'generated');
  const snapshot = {
    exists: true,
    entries: ['AGENTS.md', 'business.txt'].map((file) => ({
      path: file,
      type: 'file',
      hash: hash(fs.readFileSync(path.join(target, file))),
      mode: fs.statSync(path.join(target, file)).mode,
    })),
  };
  assert.throws(
    () =>
      publishInitialization({
        source,
        target,
        snapshot,
        files: ['AGENTS.md', 'new.txt', 'fail.txt'],
        managedPaths: ['AGENTS.md'],
        beforeWrite: (file) => {
          if (file === 'fail.txt') throw new Error('simulated disk failure');
        },
      }),
    /simulated disk failure/,
  );
  assert.equal(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8'), 'User instructions\n');
  assert.equal(fs.readFileSync(path.join(target, 'business.txt'), 'utf8'), 'Keep business\n');
  assert.deepEqual(fs.readdirSync(target).sort(), ['AGENTS.md', 'business.txt']);
});

test('nonempty initialization uses system staging and preserves unrelated projects and runtime data', async (t) => {
  const root = temporary(t),
    target = path.join(root, 'project');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'README.md'), 'Keep this README');
  fs.mkdirSync(path.join(target, 'other-project/node_modules'), { recursive: true });
  const largeFile = path.join(target, 'other-project/node_modules/retained.bin');
  fs.writeFileSync(largeFile, '');
  fs.truncateSync(largeFile, 70 * 1024 * 1024);
  const input = inputFor(target),
    preview = previewInit(input);
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const originalMkdtemp = fs.mkdtempSync,
    prefixes = [];
  fs.mkdtempSync = (prefix, ...args) => {
    prefixes.push(prefix);
    assert.equal(path.dirname(prefix), os.tmpdir());
    return originalMkdtemp(prefix, ...args);
  };
  let result;
  try {
    result = await executeInit(
      { ...input, previewHash: preview.previewHash },
      {
        approvalProvider: createNativeInitConsent({
          identity,
          root: target,
          preset: input.preset,
          policy: '保留已有文件，只补齐缺失文件',
          response: { action: 'accept', content: { confirm: true } },
        }),
      },
    );
  } finally {
    fs.mkdtempSync = originalMkdtemp;
  }
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(prefixes.length > 0);
  assert.equal(fs.readFileSync(path.join(target, 'README.md'), 'utf8'), 'Keep this README');
  assert.equal(fs.statSync(largeFile).size, 70 * 1024 * 1024);
  assert.deepEqual(fs.readdirSync(root), ['project']);
});

test('initialization reclaims a lock left by a dead process and removes staging', async (t) => {
  const host = temporary(t);
  const target = path.join(host, 'project');
  fs.mkdirSync(target);
  const input = inputFor(target);
  const preview = previewInit(input);
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const lockPath = path.join(os.tmpdir(), 'sg-codex-init-' + hash(preview.root) + '.lock');
  fs.mkdirSync(lockPath, { recursive: true });
  fs.writeFileSync(
    path.join(lockPath, 'owner.json'),
    JSON.stringify({ schemaVersion: 1, pid: 2147483647 }),
  );
  t.after(() => fs.rmSync(lockPath, { recursive: true, force: true }));
  const stages = [];
  const originalMkdtemp = fs.mkdtempSync;
  fs.mkdtempSync = (prefix, ...args) => {
    const created = originalMkdtemp(prefix, ...args);
    if (String(prefix).includes('sg-codex-init-')) stages.push(created);
    return created;
  };
  let result;
  try {
    result = await executeInit({ ...input, previewHash: preview.previewHash }, {});
  } finally {
    fs.mkdtempSync = originalMkdtemp;
  }
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.existsSync(lockPath), false);
  assert.ok(stages.length > 0);
  for (const stage of stages) assert.equal(fs.existsSync(stage), false);
});

test('blank path initializes the bound Git repository once while retaining staged user changes', async (t) => {
  const root = temporary(t);
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q');
  git('config', 'user.name', 'User Fixture');
  git('config', 'user.email', 'user@example.test');
  fs.writeFileSync(path.join(root, 'business.txt'), 'original\n');
  git('add', 'business.txt');
  git('commit', '-q', '-m', 'existing user history');
  const originalHead = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'business.txt'), 'user staged changes\n');
  git('add', 'business.txt');
  const requests = [];
  const registry = createToolRegistry({
    projectRoot: root,
    trustedUserIdentity: identity,
    peerCapabilities: () => ({ elicitationSupported: true }),
    requestPeer: async (_method, params) => {
      requests.push(params);
      assert.equal(params.requestedSchema.required.includes('path'), false);
      assert.equal(params.requestedSchema.properties.path.default, root);
      assert.ok(
        params.requestedSchema.properties.preset.enum.includes(
          'JDK 8 + Spring Boot 2.7（兼容旧项目）',
        ),
      );
      return {
        action: 'accept',
        content: {
          path: '',
          company: 'acme',
          business: 'hotel',
          preset: 'JDK 8 + Spring Boot 2.7（兼容旧项目）',
          frontend: 'Vue 3（管理后台）',
          nonempty: '保留已有文件，只补齐缺失文件',
          confirm: true,
        },
      };
    },
  });
  const result = (await registry.call('sg_project_create')).structuredContent;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(requests.length, 1);
  assert.equal(result.root, root);
  assert.equal(git('rev-parse', 'HEAD^'), originalHead);
  assert.equal(git('show', 'HEAD:business.txt'), 'original');
  assert.equal(git('diff', '--cached', '--name-only'), 'business.txt');
  assert.equal(fs.readFileSync(path.join(root, 'business.txt'), 'utf8'), 'user staged changes\n');
});

test('failed creation retains stack including JDK8 and does not reopen the form on retry', async (t) => {
  const host = temporary(t),
    requests = [];
  const registry = createToolRegistry({
    projectRoot: host,
    trustedUserIdentity: identity,
    peerCapabilities: () => ({ elicitationSupported: true }),
    requestPeer: async (_method, params) => {
      requests.push(params);
      const content = {
        path: process.cwd(),
        company: 'acme',
        business: 'hotel',
        preset: 'JDK 8 + Spring Boot 2.7（兼容旧项目）',
        frontend: 'Vue 3（管理后台）',
        confirm: true,
      };
      if (params.requestedSchema.properties.gitName)
        Object.assign(content, { gitName: 'User Fixture', gitEmail: 'user@example.test' });
      return { action: 'accept', content };
    },
  });
  for (let i = 0; i < 2; i++) {
    const response = (await registry.call('sg_project_create')).structuredContent;
    assert.equal(response.code, 'INIT_SOURCE_TARGET_FORBIDDEN');
    assert.equal(response.selectionRetained, true);
  }
  assert.equal(requests.length, 1);
});

test('a separate plugin source checkout cannot become a default business target', (t) => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, 'src/codex'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'specgate-codex' }));
  fs.writeFileSync(path.join(root, 'src/codex/server.js'), '// plugin source');
  assert.equal(previewInit(inputFor(root)).code, 'INIT_SOURCE_TARGET_FORBIDDEN');
  assert.equal(
    previewInit(inputFor(path.join(root, 'child'))).code,
    'INIT_SOURCE_TARGET_FORBIDDEN',
  );
});
