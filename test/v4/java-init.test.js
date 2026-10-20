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
const approve = { ask: async () => ({ answers: [{ selected: ['确认'] }] }) };

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
test('missing questions, cancellation, invalid flags and stack conflicts do not create target', async (t) => {
  const parent = temp(t),
    root = path.join(parent, 'missing');
  for (const args of [
    {},
    { userQuestions: { ask: async () => ({ answers: [{ selected: ['取消'] }] }) } },
    { execution: { test: 'true' } },
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
      ask: async () => {
        fs.writeFileSync(path.join(root, 'external'), '');
        return { answers: [{ selected: ['确认'] }] };
      },
    },
  });
  assert.equal(result.code, 'E_TARGET_NOT_EMPTY');
  assert.deepEqual(fs.readdirSync(root), ['external']);
});
test('generation-only has no quality execution; frozen req and root gate workflow accept independent change', async (t) => {
  const root = temp(t);
  let calls = 0;
  const result = await startJavaInit({
    root,
    userQuestions: approve,
    quality: { generateOnly: true },
    runner: () => {
      calls++;
      throw Error('must not execute');
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(calls, 0);
  assert.equal(result.code, 'GENERATED_ONLY');
  assert.equal(result.report.initializationComplete, false);
  assert.equal(result.report.gitBaseline.status, 'passed');
  assert.equal(result.report.gitBaseline.network, false);
  assert.equal(result.report.approval.source, 'host-userQuestions');
  assert.match(result.report.approval.requirementsHash, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(path.join(root, 'backend/pom.xml')), true);
  assert.equal(fs.existsSync(path.join(root, 'frontend/package.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.gitmodules')), false);
  assert.equal(fs.existsSync(path.join(root, '.specgate/workspace.yaml')), false);
  assert.equal(load(root).state.phase, 'IDLE');
  assert.equal(load(root).state.change, null);
  assert.equal(isRequirementsFrozen(root).ok, true);
  const suites = readSuites(readConfig(root));
  assert.equal(validateSuites(root, suites).ok, true);
  assert.deepEqual(
    suites.map((s) => s.id),
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
test('CLI execution flags are independent and unknown flags fail closed', () => {
  assert.deepEqual(parseInitArgs('--test --format --no-test').execution, {
    test: false,
    format: true,
  });
  assert.equal(parseInitArgs('--typo').ok, false);
  assert.deepEqual(parseInitArgs('').execution, {});
});

function setup(root, questions) {
  const toolMap = new Map(),
    commandMap = new Map();
  const ctx = {
    get: (n) => (n === 'userQuestions' ? questions : undefined),
    tools: { register: (d) => toolMap.set(d.name, d) },
    commands: { register: (d) => commandMap.set(d.name, d) },
  };
  const runtime = createRuntime(ctx, { root });
  registerTools(ctx, runtime);
  registerCommands(ctx, runtime);
  return { toolMap, commandMap };
}
test('default tool and CLI both reject nonempty instead of falling back to v3', async (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'README.md'), 'keep');
  const { toolMap, commandMap } = setup(root, approve);
  assert.equal((await toolMap.get('sg_init').execute({}, {})).data.code, 'E_TARGET_NOT_EMPTY');
  assert.match(
    (await commandMap.get('sg-init').handler({ rawInput: '' })).text,
    /E_TARGET_NOT_EMPTY/,
  );
  assert.deepEqual(fs.readdirSync(root), ['README.md']);
});
test('default init is generation-only; explicit lenient remains pending and cannot be bypassed', async (t) => {
  const generatedRoot = temp(t);
  const generated = await startJavaInit({ root: generatedRoot, userQuestions: approve });
  assert.equal(generated.code, 'GENERATED_ONLY');
  assert.equal(generated.report.initializationComplete, false);
  assert.equal(generated.report.version.id, 'jdk8-boot2.7');

  const root = temp(t);
  const result = await startJavaInit({
    root,
    userQuestions: approve,
    quality: { mode: 'lenient' },
  });
  assert.equal(result.code, 'MAIN_AGENT_PENDING');
  assert.equal(createChange(root, { name: 'premature' }).code, 'INIT_QUALITY_PENDING');
  fs.writeFileSync(
    path.join(root, '.specgate/init-report.json'),
    JSON.stringify({ schemaVersion: 1, phase: 'IDLE' }),
  );
  assert.equal(createChange(root, { name: 'tampered' }).code, 'INIT_QUALITY_PENDING');
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
    assert.ok(fs.existsSync(path.join(root, '.specgate/golden.json')));
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

test('quality CLI options reject invalid modes and generation execution conflicts', async (t) => {
  assert.deepEqual(parseInitArgs('--strict').quality, { mode: 'strict' });
  assert.deepEqual(parseInitArgs('--generate-only').quality, { generateOnly: true });
  assert.equal(parseInitArgs('--mode fast').ok, false);
  assert.equal(parseInitArgs('--strict --lenient').ok, false);
  const result = await startJavaInit({
    root: temp(t),
    userQuestions: approve,
    quality: { generateOnly: true },
    execution: { test: true },
  });
  assert.equal(result.code, 'E_ARGS_CONFLICT');
});

test('tool schema exposes strictly typed optional switches', () => {
  const { toolMap } = setup(os.tmpdir(), approve);
  const schema = toolMap.get('sg_init').parameters.properties;
  assert.equal(parseInitArgs('--version jdk17-boot3.5').version, 'jdk17-boot3.5');
  assert.equal(schema.version.type, 'string');
  assert.ok(schema.version.enum.includes('jdk17-boot3.5'));
  assert.ok(schema.version.enum.includes('jdk21-boot4.0'));
  const p = schema.execution;
  assert.equal(p.additionalProperties, false);
  assert.deepEqual(Object.keys(p.properties), [
    'test',
    'format',
    'lint',
    'review',
    'verify',
    'installToolchain',
  ]);
});
