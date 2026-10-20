import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerTools } from '../../src/v3/tools.js';
import { registerCommands } from '../../src/v3/commands.js';
import { inspectInit, initNewProject, startRequirementsInit } from '../../src/v3/init.js';
import { init as initState } from '../../src/v3/state.js';

function setup(root, userQuestions) {
  const tools = new Map();
  const commands = new Map();
  const ctx = {
    tools: {
      register(d) {
        tools.set(d.name, d);
        return () => {};
      },
    },
    commands: {
      register(d) {
        commands.set(d.name, d);
        return () => {};
      },
    },
  };
  const runtime = { getCwd: () => root, service: () => userQuestions };
  registerTools(ctx, runtime);
  registerCommands(ctx, runtime);
  return {
    tool: (args) => tools.get('sg_init').execute(args, {}),
    command: (rawInput) => commands.get('sg-init').handler({ rawInput }),
    definition: tools.get('sg_init'),
  };
}
function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-entry-safe-'));
}

test('init entry: conflicting inputs on a missing path do not create directories', async () => {
  const root = tempRoot();
  const entry = setup(root);
  const result = await entry.tool({ path: 'missing/nested', req: 'a.md', description: 'business' });
  assert.equal(result.data.code, 'E_ARGS_CONFLICT');
  assert.deepEqual(fs.readdirSync(root), []);
  const command = await entry.command('--path missing/nested --req a.md business');
  assert.match(command.text, /E_ARGS_CONFLICT/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('init entry: explicit and default v4 never silently ignore requirement inputs', async () => {
  for (const input of [
    { req: 'requirements.md' },
    { description: 'production authentication' },
    { draft: {} },
  ]) {
    for (const explicit of [false, true]) {
      const root = tempRoot();
      const result = await setup(root).tool({ ...input, ...(explicit ? { v4: true } : {}) });
      assert.equal(result.data.code, 'NEEDS_DESIGN');
      assert.deepEqual(fs.readdirSync(root), []);
    }
  }
  const root = tempRoot();
  const result = await setup(root).command('--v4 --path missing business requirements');
  assert.match(result.text, /NEEDS_DESIGN/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('init entry: missing v4 target stays absent without execution approval, even with yes', async () => {
  const root = tempRoot();
  const entry = setup(root);
  const result = await entry.tool({ path: 'missing/nested', v4: true, backend: 'node', yes: true });
  assert.equal(result.data.ok, false);
  assert.deepEqual(fs.readdirSync(root), []);
  const command = await entry.command('--v4 --path missing/nested --backend node --yes');
  assert.equal(command.kind, 'error');
  assert.deepEqual(fs.readdirSync(root), []);
});

test('init entry: yes and adopt cannot bypass an unavailable approval channel', async () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  const entry = setup(root);
  const tool = await entry.tool({ adopt: true, yes: true });
  assert.equal(tool.data.ok, false);
  assert.equal(tool.data.code, 'APPROVAL_REQUIRED');
  const command = await entry.command('--adopt --yes');
  assert.equal(command.kind, 'error');
  assert.equal(fs.existsSync(path.join(root, '.specgate')), false);
  assert.doesNotMatch(entry.definition.parameters.properties.yes.description, /跳过初始化确认页/);
});

test('v3 init: invalid or partial state fails closed in direct calls and both entries', async () => {
  for (const raw of ['{invalid', '{}', null]) {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, '.specgate'));
    if (raw !== null) fs.writeFileSync(path.join(root, '.specgate', 'state.json'), raw);
    assert.equal(inspectInit(root).ok, false);
    assert.equal((await startRequirementsInit({ root })).ok, false);
    const entry = setup(root);
    assert.equal((await entry.tool({ v3: true })).data.ok, false);
    assert.equal((await entry.command('--v3')).kind, 'error');
    assert.equal((await initNewProject({ root })).ok, false);
    assert.deepEqual(
      fs.readdirSync(path.join(root, '.specgate')),
      raw === null ? [] : ['state.json'],
    );
    if (raw !== null)
      assert.equal(fs.readFileSync(path.join(root, '.specgate', 'state.json'), 'utf8'), raw);
  }
});

test('v3 initNewProject respects started.skipped and does not finish/reset an existing change', async () => {
  const root = tempRoot();
  assert.equal(
    initState(root, { phase: 'H1_PENDING', change: 'existing', type: 'feature' }).ok,
    true,
  );
  const file = path.join(root, '.specgate', 'state.json');
  const before = fs.readFileSync(file, 'utf8');
  const result = await initNewProject({ root });
  assert.equal(result.skipped, true);
  assert.equal(result.change, 'existing');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, 'openspec')), false);
});
