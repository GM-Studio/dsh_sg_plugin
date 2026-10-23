import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { withEnvironmentMirrors } from '../src/codex/core/environment-mirrors.js';
import { planEnvironment, createEnvironmentService } from '../src/codex/core/environment.js';
import {
  verifyArchive,
  installEnvironmentComponent,
  recoverEnvironmentStages,
} from '../src/codex/core/environment-install.js';
import { createToolRegistry } from '../src/codex/workflow-tools.js';
import { executeInit, previewInit } from '../src/codex/init.js';
import { createControlStore, readControlStore } from '../src/codex/control/store.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sg-environment-'));
const stack = { preset: 'jdk17-boot3.5', frontend: 'vue' };
const tools = {
  git: { version: '2.49.0', path: '/git' },
  node: { version: '22.22.0', node: '/node', npm: '/npm', npmVersion: '10.9.4' },
  java: { major: 17, version: '17.0.18', home: '/jdk17', java: '/jdk17/bin/java' },
  maven: { version: '3.9.11', home: '/maven', path: '/maven/bin/mvn' },
};

test('initialization checks the selected environment before creating project files', async () => {
  const root = path.join(temp(), 'new-project');
  const input = { root, ...stack, gitName: 'Fixture', gitEmail: 'fixture@example.test' };
  const preview = previewInit(input);
  assert.equal(preview.ok, true);
  let observed;
  const result = await executeInit(
    { ...input, previewHash: preview.previewHash },
    {
      environmentGate: async (selection) => {
        observed = selection;
        return { environmentReady: false, code: 'ENV_NOT_READY' };
      },
    },
  );
  assert.equal(result.code, 'ENV_NOT_READY');
  assert.deepEqual(observed, { root, ...stack });
  assert.equal(fs.existsSync(root), false);
});

test('read-only control status verifies the snapshot without repairing corrupt history', async () => {
  const root = temp();
  const store = createControlStore({ root });
  assert.equal((await store.mutate(() => ({ ok: true, type: 'fixture' }))).ok, true);
  assert.equal(readControlStore(root).ok, true);
  const snapshot = path.join(root, 'state.json');
  fs.writeFileSync(snapshot, '{"state":{"version":99},"headHash":"bad"}\n');
  const before = fs.readFileSync(snapshot, 'utf8');
  assert.equal(readControlStore(root).code, 'AUDIT_CORRUPT');
  assert.equal(fs.readFileSync(snapshot, 'utf8'), before);
});

test('only marked staging owned by an exited process is recovered', () => {
  const cache = temp();
  const deadPid = Number(
    spawnSync(process.execPath, ['-p', 'process.pid'], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout.trim(),
  );
  for (const [name, owner] of [
    ['sg-env-dead', { kind: 'specgate-environment', pid: deadPid }],
    ['sg-env-live', { kind: 'specgate-environment', pid: process.pid }],
    ['sg-env-unowned', null],
  ]) {
    fs.mkdirSync(path.join(cache, name));
    if (owner) fs.writeFileSync(path.join(cache, name, 'owner.json'), JSON.stringify(owner));
  }
  recoverEnvironmentStages(cache);
  assert.deepEqual(fs.readdirSync(cache).sort(), ['sg-env-live', 'sg-env-unowned']);
});

test('temporary mirrors are scoped to the callback and removed on failure', async () => {
  const root = temp(),
    npmrc = path.join(root, '.npmrc');
  fs.writeFileSync(npmrc, 'registry=https://registry.npmjs.org\n');
  const env = { NPM_CONFIG_USERCONFIG: npmrc };
  let temporary;
  await assert.rejects(
    withEnvironmentMirrors({ env }, async (scoped) => {
      temporary = path.dirname(scoped.mavenSettings);
      assert.equal(scoped.env.NPM_CONFIG_REGISTRY, 'https://registry.npmmirror.com');
      assert.match(fs.readFileSync(scoped.mavenSettings, 'utf8'), /maven.aliyun.com/);
      throw new Error('fixture command failed');
    }),
    /fixture command failed/,
  );
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(env.NPM_CONFIG_USERCONFIG, npmrc);
  assert.equal(fs.readFileSync(npmrc, 'utf8'), 'registry=https://registry.npmjs.org\n');
});

test('planning requires a selected stack and installs only selected missing tools', () => {
  assert.equal(planEnvironment({ tools: {} }).code, 'ENV_STACK_REQUIRED');
  const plan = planEnvironment({ selection: stack, tools: { git: tools.git, node: tools.node } });
  assert.deepEqual(plan.missing, ['jdk17', 'maven']);
  assert.equal(plan.required.includes('jdk8'), false);
  assert.equal(plan.required.includes('jdk21'), false);
  assert.equal(planEnvironment({ selection: stack, tools }).environmentReady, true);
  assert.equal(
    planEnvironment({ selection: stack, tools, platform: 'darwin' }).code,
    'ENV_PLATFORM_UNSUPPORTED',
  );
});

test('check is read-only and stack changes invalidate readiness', async () => {
  const root = temp();
  const service = createEnvironmentService({ root, discover: () => tools, platform: 'linux' });
  const ready = await service.check(stack);
  assert.equal(ready.environmentReady, true);
  assert.deepEqual(fs.readdirSync(root), []);
  const changed = await service.check({ ...stack, preset: 'jdk8-boot2.7' });
  assert.equal(changed.environmentReady, false);
  assert.deepEqual(changed.missing, ['jdk8']);
  assert.notEqual(changed.fingerprint, ready.fingerprint);
});

test('install has no approval argument and needs trusted installation consent', async () => {
  const root = temp();
  let installs = 0;
  const service = createEnvironmentService({
    root,
    platform: 'linux',
    discover: () => ({}),
    install: () => {
      installs++;
    },
  });
  const denied = await service.prepare(stack);
  assert.equal(denied.code, 'ENV_INSTALL_CONSENT_REQUIRED');
  assert.equal(installs, 0);
  assert.deepEqual(fs.readdirSync(root), []);
  const registry = createToolRegistry({ projectRoot: root });
  assert.equal(registry.validate('sg_env_prepare', { ...stack, approved: true }), false);
});

test('installation probes again and rerun reuses tools without asking or installing', async () => {
  const root = temp();
  let discovered = { git: tools.git, node: tools.node };
  const installed = [],
    approvals = [];
  const service = createEnvironmentService({
    root,
    platform: 'linux',
    discover: () => discovered,
    consent: async (plan) => {
      approvals.push(plan);
      return true;
    },
    install: async (id) => {
      installed.push(id);
      discovered = {
        ...discovered,
        ...(id === 'jdk17' ? { java: tools.java } : { maven: tools.maven }),
      };
      return { ok: true };
    },
  });
  assert.equal((await service.prepare(stack)).environmentReady, true);
  assert.deepEqual(installed, ['jdk17', 'maven']);
  assert.equal((await service.prepare(stack)).environmentReady, true);
  assert.equal(approvals.length, 1);
  assert.equal(installed.length, 2);
});

test('an installer success without real discovered binaries stays blocked', async () => {
  const service = createEnvironmentService({
    root: temp(),
    platform: 'linux',
    discover: () => ({}),
    consent: async () => true,
    install: async () => ({ ok: true }),
  });
  const report = await service.prepare(stack);
  assert.equal(report.environmentReady, false);
  assert.equal(report.code, 'ENV_VERIFICATION_FAILED');
});

test('archive integrity rejects corrupted downloads before publication', () => {
  const archive = path.join(temp(), 'archive.zip');
  fs.writeFileSync(archive, 'bad');
  assert.throws(
    () => verifyArchive(archive, { algorithm: 'sha256', checksum: '0'.repeat(64) }),
    /校验/,
  );
  const checksum = createHash('sha256').update('bad').digest('hex');
  assert.equal(verifyArchive(archive, { algorithm: 'sha256', checksum }).ok, true);
});

test('aggregated status on a bare project never creates files or starts control runtime', async () => {
  const root = temp();
  const registry = createToolRegistry({ projectRoot: root });
  const response = await registry.call('sg_status');
  assert.equal(response.structuredContent.ok, true);
  assert.equal(response.structuredContent.projectRoot, fs.realpathSync(root));
  assert.equal(response.structuredContent.environment.status, 'not-checked');
  assert.deepEqual(fs.readdirSync(root), []);
});

test('all task Skills and generated project copies are declared', () => {
  const root = path.resolve(import.meta.dirname, '..');
  for (const name of ['env', 'project', 'change', 'status']) {
    const file = path.join(root, 'skills', `sg-codex-${name}`, 'SKILL.md');
    assert.equal(fs.existsSync(file), true, name);
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`name: sg-codex-${name}`));
  }
});

test('a corrupt download is cleaned and an existing installation remains untouched', async () => {
  const cacheRoot = temp();
  fs.mkdirSync(path.join(cacheRoot, 'jdk17-working'));
  fs.writeFileSync(path.join(cacheRoot, 'jdk17-working', 'retain'), 'retain');
  await assert.rejects(
    installEnvironmentComponent('node', {
      cacheRoot,
      platform: 'linux',
      fetchImpl: async () => new Response('corrupted archive'),
      run: () => {
        throw new Error('corrupt archive must not be extracted');
      },
    }),
    /校验/,
  );
  assert.deepEqual(fs.readdirSync(cacheRoot), ['jdk17-working']);
  assert.equal(fs.readFileSync(path.join(cacheRoot, 'jdk17-working', 'retain'), 'utf8'), 'retain');
});

test('workflow execution remains blocked without creating runtime state', async () => {
  const root = temp();
  fs.mkdirSync(path.join(root, '.specgate'));
  fs.writeFileSync(
    path.join(root, '.specgate/monorepo.json'),
    JSON.stringify({ preset: stack.preset, frontendFramework: stack.frontend }),
  );
  const service = createEnvironmentService({ root, platform: 'linux', discover: () => ({}) });
  const registry = createToolRegistry({ projectRoot: root, environmentService: service });
  const response = await registry.call('sg_quality_run', { expectedVersion: 0 });
  assert.equal(response.structuredContent.code, 'ENV_NOT_READY');
  assert.equal(fs.existsSync(path.join(root, '.specgate/codex')), false);
});

test('status in supervisor mode does not create the control home', async () => {
  const root = temp(),
    control = path.join(temp(), 'not-created');
  const saved = {
    mode: process.env.SPECGATE_CONTROL_MODE,
    item: process.env.SPECGATE_WORK_ITEM_ID,
    home: process.env.SPECGATE_CONTROL_HOME,
  };
  try {
    process.env.SPECGATE_CONTROL_MODE = '1';
    process.env.SPECGATE_WORK_ITEM_ID = 'fixture';
    process.env.SPECGATE_CONTROL_HOME = control;
    const registry = createToolRegistry({ projectRoot: root });
    assert.equal((await registry.call('sg_status')).structuredContent.ok, true);
    assert.equal(fs.existsSync(control), false);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    for (const [key, value] of Object.entries({
      SPECGATE_CONTROL_MODE: saved.mode,
      SPECGATE_WORK_ITEM_ID: saved.item,
      SPECGATE_CONTROL_HOME: saved.home,
    }))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
