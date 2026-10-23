import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createToolRegistry } from '../src/codex/workflow-tools.js';
import { resolveProjectRoot } from '../src/codex/server.js';
import { resolveGitIdentity } from '../src/codex/core/git-identity.js';
import { executeInit, previewInit } from '../src/codex/init.js';
import { renderRequirementsForUser } from '../src/codex/change-add.js';

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-onboarding-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const data = (response) => response.structuredContent;

test('explicit startup binding wins over workspace roots and environment', async (t) => {
  const root = temporary(t);
  const peer = {
    capabilities: () => ({ rootsSupported: true }),
    request: () => {
      throw new Error('must not request roots');
    },
  };
  assert.equal(
    await resolveProjectRoot(peer, root, {
      explicit: true,
      env: { SPECGATE_PROJECT_ROOT: '/other' },
    }),
    root,
  );
});

test('plugin cache fallback stays unbound instead of becoming the business project', async () => {
  const peer = {
    capabilities: () => ({ rootsSupported: false }),
    request: () => {
      throw new Error('must not request roots');
    },
  };
  assert.equal(
    await resolveProjectRoot(peer, process.cwd(), { env: { PLUGIN_ROOT: process.cwd() } }),
    null,
  );
  const registry = createToolRegistry({ projectRoot: process.cwd(), projectBound: false });
  const status = data(await registry.call('sg_project_status'));
  assert.equal(status.ok, true);
  assert.equal(status.projectRoot, null);
  assert.equal(status.code, 'PROJECT_NOT_BOUND');
  assert.equal(data(await registry.call('sg_verify')).code, 'PROJECT_NOT_BOUND');
});

test('binding switches every subsequent project tool without writing either tree', async (t) => {
  const first = temporary(t),
    second = temporary(t);
  const registry = createToolRegistry({ projectRoot: first });
  assert.equal(
    data(await registry.call('sg_project_bind', { path: second })).projectRoot,
    fs.realpathSync(second),
  );
  assert.equal(data(await registry.call('sg_project_status')).projectRoot, fs.realpathSync(second));
  assert.equal(data(await registry.call('status')).projectRoot, fs.realpathSync(second));
  assert.equal(
    data(await registry.call('sg_project_bind', { path: process.cwd() })).code,
    'PROJECT_SOURCE_FORBIDDEN',
  );
  assert.deepEqual(fs.readdirSync(first), []);
  assert.deepEqual(fs.readdirSync(second), []);
});

test('new project requires explicit stack and missing form support never writes', async (t) => {
  const root = temporary(t),
    registry = createToolRegistry({ projectRoot: root });
  assert.equal(registry.validate('sg_init_preview', { company: 'acme', business: 'hotel' }), false);
  assert.equal(data(await registry.call('sg_project_create')).code, 'PROJECT_FORM_UNAVAILABLE');
  assert.deepEqual(fs.readdirSync(root), []);
});

test('native creation form preserves selected React stack, user identity, auto setup and project binding', async (t) => {
  const host = temporary(t),
    target = path.join(temporary(t), 'hotel');
  const requests = [];
  const registry = createToolRegistry({
    projectRoot: host,
    trustedUserIdentity: { kind: 'user', id: 'fixture', source: 'test-native' },
    peerCapabilities: () => ({ elicitationSupported: true }),
    requestPeer: async (method, params) => {
      requests.push(params);
      assert.equal(method, 'elicitation/create');
      if (requests.length === 1) {
        assert.equal(params.requestedSchema.properties.preset.default, undefined);
        const content = {
          path: target,
          company: 'acme',
          business: 'hotel',
          preset: 'JDK 17 + Spring Boot 3.5（通用项目）',
          frontend: 'React 18（管理后台）',
          nonempty: '保留已有文件，只补齐缺失文件',
        };
        if (params.requestedSchema.properties.gitName)
          Object.assign(content, { gitName: 'Fixture User', gitEmail: 'fixture@example.test' });
        return { action: 'accept', content };
      }
      return { action: 'accept', content: { decision: 'generate' } };
    },
  });
  const result = data(await registry.call('sg_project_create'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(requests.length, 1, '填写并确认一次后不能再次索要技术栈或确认');
  assert.equal(result.phase, 'GENERATED_ONLY');
  assert.equal(result.report.initializationComplete, false);
  assert.equal(fs.existsSync(path.join(target, 'frontend/src/main.tsx')), true);
  for (const file of [
    '.codex/agents/specgate_backend.toml',
    '.agents/skills/sg-codex/SKILL.md',
    '.agents/skills/sg-codex-setup/SKILL.md',
    '.env',
  ])
    assert.equal(fs.existsSync(path.join(target, file)), true, file);
  assert.match(
    fs.readFileSync(path.join(target, '.codex/config.toml'), 'utf8'),
    new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\\\', '\\\\\\\\')),
  );
  assert.equal(data(await registry.call('status')).projectRoot, fs.realpathSync(target));
  const projectStatus = data(await registry.call('sg_project_status'));
  assert.equal(projectStatus.nextTool, 'sg_project_verify');
  assert.deepEqual(projectStatus.verificationTools, ['sg_project_verify', 'sg_verify']);
  assert.equal(fs.existsSync(path.join(target, '.specgate/codex/changes')), false);
  const git = (...args) => spawnSync('git', args, { cwd: target, encoding: 'utf8' }).stdout.trim();
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('ls-files', '--', '.env', '.codex', '.agents'), '');
  assert.notEqual(git('log', '-1', '--format=%an <%ae>'), 'SpecGate <specgate@local>');
  const env = fs.readFileSync(path.join(target, '.env'), 'utf8');
  const passwords = [...env.matchAll(/^APP_(?:ADMIN|VIEWER)_PASSWORD=(.+)$/gm)].map(
    (entry) => entry[1],
  );
  assert.equal(passwords.length, 2);
  assert.deepEqual(passwords, ['admin', 'viewer']);
  assert.match(env, /^APP_LOCAL_DEMO=true$/m);
  assert.equal(result.login.admin.password, 'admin');
  assert.equal(data(await registry.call('sg_project_create')).alreadyInitialized, true);
  assert.equal(requests.length, 1, '已经生成的项目应继续验证，而不是重新填写');
});

test('cancelled project form is attempted again instead of degrading to text', async (t) => {
  const root = temporary(t);
  let requests = 0;
  const registry = createToolRegistry({
    projectRoot: root,
    trustedUserIdentity: { kind: 'user', id: 'fixture', source: 'test-native' },
    peerCapabilities: () => ({ elicitationSupported: true }),
    requestPeer: async () => {
      requests += 1;
      return { action: 'cancel' };
    },
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = data(await registry.call('sg_project_create'));
    assert.equal(result.code, 'INIT_CANCELLED');
    assert.equal(result.status, 'WAITING_FOR_USER');
  }
  assert.equal(requests, 2);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('project verification alias remains equivalent to sg_verify', async (t) => {
  const registry = createToolRegistry({ projectRoot: temporary(t) });
  const direct = data(await registry.call('sg_verify'));
  const project = data(await registry.call('sg_project_verify'));
  assert.equal(project.code, direct.code);
  assert.equal(project.ok, direct.ok);
  assert.equal(project.reportPath, direct.reportPath);
  assert.equal(project.nextAction, direct.nextAction);
});

test('identity resolver reuses explicit Git author environment and never supplies a fake identity', (t) => {
  const root = temporary(t);
  assert.deepEqual(
    resolveGitIdentity({
      root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Actual User',
        GIT_AUTHOR_EMAIL: 'user@example.test',
      },
    }),
    { ok: true, name: 'Actual User', email: 'user@example.test' },
  );
  assert.equal(
    resolveGitIdentity({ root, gitName: '', gitEmail: '' }).code,
    'GIT_IDENTITY_REQUIRED',
  );
});

test('missing identity stops initialization before any target files or commit are created', async (t) => {
  const root = path.join(temporary(t), 'app');
  const input = { root, gitName: '', gitEmail: '' };
  const preview = previewInit(input);
  assert.equal(preview.ok, true);
  const result = await executeInit({ ...input, previewHash: preview.previewHash });
  assert.equal(result.code, 'GIT_IDENTITY_REQUIRED');
  assert.equal(fs.existsSync(root), false);
});

test('H1 document shows requirements, acceptance criteria, user answers, critique and pending risks', () => {
  const summary = renderRequirementsForUser({
    changeId: 'hotel',
    revision: 2,
    request: '用户提出的酒店需求',
    requirements: [
      {
        id: 'REQ-1',
        category: 'functional',
        text: '客房查询',
        acceptanceCriteria: [{ id: 'AC-1', text: '满房时返回明确提示' }],
      },
    ],
    assumptions: [
      { id: 'A-1', text: '暂用单门店', risk: '多门店需要调整', pendingConfirmation: true },
    ],
    openIssues: [],
    clarifications: [{ answer: '用户的真实回答' }],
    critique: { restatement: ['反向复述'], risks: ['并发预订风险'] },
    change: { type: 'feature' },
    changeContract: { nonGoals: ['不含支付'] },
  });
  for (const text of [
    '需求文档',
    '用户提出的酒店需求',
    'REQ-1',
    'AC-1',
    '满房时返回明确提示',
    '暂用单门店',
    '多门店需要调整',
    '用户的真实回答',
    '反向复述',
    '并发预订风险',
    '不含支付',
  ])
    assert.ok(summary.includes(text), text);
});
