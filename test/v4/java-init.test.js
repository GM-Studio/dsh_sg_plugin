import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startJavaInit } from '../../src/v4/java-init.js';
import { createChange, readConfig, readSuites, validateSuites } from '../../src/v3/change.js';
import { isRequirementsFrozen } from '../../src/v3/requirements.js';
import { load } from '../../src/v3/state.js';
import { parseInitArgs, registerCommands } from '../../src/v3/commands.js';
import { registerTools } from '../../src/v3/tools.js';
import { createRuntime } from '../../src/v3/runtime.js';
import { GOLDEN_MANIFEST } from '../../src/v4/java-versions.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-init-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const approve = {
  ask: async ({ questions }) => ({
    answers: questions.map((question) => ({
      id: question.id,
      selected: [question.id === 'sg-java-init-version' ? 'jdk8-boot2.7' : '确认'],
    })),
  }),
};

test('strict empty rule rejects Git, zero files, and empty folders without writes', async (t) => {
  for (const entry of ['.git', 'zero.txt', 'empty']) {
    const root = temp(t);
    if (entry === 'zero.txt') fs.writeFileSync(path.join(root, entry), '');
    else fs.mkdirSync(path.join(root, entry));
    const result = await startJavaInit({ root, userQuestions: approve });
    assert.equal(result.code, 'E_TARGET_NOT_EMPTY');
    assert.deepEqual(fs.readdirSync(root), [entry]);
  }
});

test('missing questions, cancellation, and stack conflicts do not create target', async (t) => {
  const parent = temp(t);
  const root = path.join(parent, 'missing');
  for (const args of [
    {},
    { userQuestions: { ask: async () => ({ answers: [{ selected: ['取消'] }] }) } },
    { backend: 'node' },
  ]) {
    const result = await startJavaInit({ root, ...args });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(root), false);
  }
});

test('recheck rejects files introduced during confirmation', async (t) => {
  const root = temp(t);
  const result = await startJavaInit({
    root,
    userQuestions: {
      ask: async ({ questions }) => {
        for (const question of questions)
          if (question.id === 'sg-java-init-confirm')
            fs.writeFileSync(path.join(root, 'external'), '');
        return {
          answers: questions.map((question) => ({
            id: question.id,
            selected: [question.id === 'sg-java-init-version' ? 'jdk8-boot2.7' : '确认'],
          })),
        };
      },
    },
  });
  assert.equal(result.code, 'E_TARGET_NOT_EMPTY');
  assert.deepEqual(fs.readdirSync(root), ['external']);
});

test('default init generates code, req baseline, golden metadata and Git baseline', async (t) => {
  const root = temp(t);
  const result = await startJavaInit({ root, userQuestions: approve });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.code, 'GENERATED_ONLY');
  assert.equal(result.report.initializationComplete, false);
  assert.equal(result.report.quality.generateOnly, true);
  assert.equal(result.report.version.id, 'jdk8-boot2.7');
  assert.equal(result.report.template.verified, true);
  assert.equal(fs.existsSync(path.join(root, 'backend/pom.xml')), true);
  assert.equal(fs.existsSync(path.join(root, 'frontend/package.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'frontend/package-lock.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.specgate/golden.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.gitmodules')), false);
  assert.equal(load(root).state.phase, 'IDLE');
  assert.equal(load(root).state.change, null);
  assert.equal(isRequirementsFrozen(root).ok, true);
  const suites = readSuites(readConfig(root));
  assert.equal(validateSuites(root, suites).ok, true);
  assert.deepEqual(
    suites.map((item) => item.id),
    ['backend', 'frontend'],
  );
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout.trim();
  assert.match(head, /^[a-f0-9]{40}$/);
  const change = createChange(root, {
    name: 'add-filter',
    baseCommit: head,
    requirements: ['REQ-001'],
  });
  assert.equal(change.ok, true);
  assert.equal(load(root).state.phase, 'H1_PENDING');
  assert.equal(load(root).state.approvals.H1.issuedAt, null);
});

test('re-init is idempotent and a copied workspace can create a change', async (t) => {
  const root = temp(t);
  const first = await startJavaInit({ root, userQuestions: approve });
  assert.equal(first.ok, true);
  const again = await startJavaInit({ root, userQuestions: approve });
  assert.equal(again.skipped, true);
  assert.equal(again.code, 'ALREADY_INITIALIZED');
  const cloneParent = temp(t);
  const clone = path.join(cloneParent, 'clone');
  fs.cpSync(root, clone, { recursive: true });
  const change = createChange(clone, { name: 'clone-change' });
  assert.equal(change.ok, true);
});

test('version presets generate the requested Java/Boot stack', async (t) => {
  const cases = [
    ['jdk8-boot2.7', '2.7.18', '1.8', false, '8'],
    ['jdk17-boot3.5', '3.5.16', '17', true, '17'],
    ['jdk21-boot3.5', '3.5.16', '21', true, '21'],
    ['jdk21-boot4.0', '4.0.0', '21', true, '21'],
  ];
  for (const [version, boot, java, jakarta, jdk] of cases) {
    const root = temp(t);
    const result = await startJavaInit({ root, userQuestions: approve, version });
    assert.equal(result.ok, true, JSON.stringify(result));
    const pom = fs.readFileSync(path.join(root, 'backend/pom.xml'), 'utf8');
    assert.ok(pom.includes('<version>' + boot + '</version>'), version + ' boot');
    assert.ok(pom.includes('<java.version>' + java + '</java.version>'), version + ' java');
    const task = fs.readFileSync(
      path.join(root, 'backend/src/main/java/com/example/tasks/Task.java'),
      'utf8',
    );
    assert.equal(task.includes(jakarta ? 'jakarta.persistence' : 'javax.persistence'), true);
    assert.equal(fs.readFileSync(path.join(root, '.java-version'), 'utf8').trim(), jdk);
    assert.equal(result.report.version.id, version);
    assert.equal(result.report.template.verified, Boolean(GOLDEN_MANIFEST.presets[version]));
  }
});

test('sg_init tool passes the version preset through', async (t) => {
  const root = temp(t);
  const { toolMap } = setup(root, approve);
  const result = await toolMap.get('sg_init').execute({ version: 'jdk17-boot3.5' }, {});
  assert.equal(result.data.report.version.id, 'jdk17-boot3.5');
  assert.equal(result.data.report.template.verified, true);
  assert.ok(fs.existsSync(path.join(root, 'backend/pom.xml')));
});

test('unknown version fails before writing', async (t) => {
  const parent = temp(t);
  const root = path.join(parent, 'unknown');
  const result = await startJavaInit({
    root,
    userQuestions: approve,
    version: 'jdk11-boot3.0',
  });
  assert.equal(result.code, 'E_JAVA_VERSION');
  assert.equal(fs.existsSync(root), false);
});

test('CLI version flag and tool schema keep the generation-only surface', () => {
  assert.equal(parseInitArgs('--version jdk17-boot3.5').version, 'jdk17-boot3.5');
  assert.equal(parseInitArgs('--strict').ok, false);
  assert.equal(parseInitArgs('--generate-only').ok, false);
  const { toolMap } = setup(os.tmpdir(), approve);
  const schema = toolMap.get('sg_init').parameters.properties;
  assert.equal(schema.version.type, 'string');
  assert.ok(schema.version.enum.includes('jdk17-boot3.5'));
  assert.ok(schema.version.enum.includes('jdk21-boot4.0'));
  assert.equal(schema.execution, undefined);
  assert.equal(schema.quality, undefined);
});

function setup(root, questions) {
  const toolMap = new Map();
  const commandMap = new Map();
  const ctx = {
    get: (name) => (name === 'userQuestions' ? questions : undefined),
    tools: { register: (definition) => toolMap.set(definition.name, definition) },
    commands: { register: (definition) => commandMap.set(definition.name, definition) },
  };
  const runtime = createRuntime(ctx, { root });
  registerTools(ctx, runtime);
  registerCommands(ctx, runtime);
  return { toolMap, commandMap };
}
