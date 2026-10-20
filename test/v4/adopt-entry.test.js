import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { approvedAdoptWorkspace, adoptWorkspace } from '../../src/v4/adopt.js';

function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-adopt-entry-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"legacy"}\n');
  return dir;
}
function snapshot(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      return [name, fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : 'directory'];
    });
}
function questions(select, check = () => {}) {
  return {
    async ask({ questions: list }) {
      const q = list[0];
      check(q);
      return { answers: [{ id: q.id, selected: [select(q)] }] };
    },
  };
}
const execute = (q) => q.options.find((option) => option.label.startsWith('确认方案 ')).label;

test('adopt entry: missing questions, cancellation, modify and forged plain confirmation are zero-write', async () => {
  for (const label of [null, '暂不执行', '返回修改', '确认']) {
    const dir = root();
    const before = snapshot(dir);
    const result = await approvedAdoptWorkspace({
      root: dir,
      userQuestions: label ? questions(() => label) : null,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(snapshot(dir), before);
  }
});

test('adopt entry: bound approval previews exact root/scope then initializes; valid repeat skips without questions', async () => {
  const dir = root();
  const before = snapshot(dir);
  const userQuestions = questions(execute, (q) => {
    assert.deepEqual(snapshot(dir), before);
    assert.ok(q.question.includes(dir));
    assert.match(q.question, /不安装依赖/);
    assert.match(q.question, /不执行 Git 命令/);
  });
  const result = await approvedAdoptWorkspace({ root: dir, userQuestions });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(path.join(dir, 'openspec', 'REQ.md')));
  const after = snapshot(dir);
  const repeat = await approvedAdoptWorkspace({
    root: dir,
    userQuestions: {
      ask() {
        throw new Error('must not ask');
      },
    },
  });
  assert.equal(repeat.skipped, true);
  assert.deepEqual(snapshot(dir), after);
});

test('adopt entry: low-level multi-module workspace remains compatible and repeats read-only', async () => {
  const dir = root();
  for (const name of ['api', 'web']) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'package.json'), '{}');
  }
  assert.equal(adoptWorkspace({ root: dir }).ok, true);
  const before = snapshot(dir);
  assert.equal((await approvedAdoptWorkspace({ root: dir })).skipped, true);
  assert.deepEqual(snapshot(dir), before);
});

test('adopt entry: target changes or abort during approval invalidate execution', async () => {
  for (const abort of [false, true]) {
    const dir = root();
    const controller = new AbortController();
    const result = await approvedAdoptWorkspace({
      root: dir,
      signal: controller.signal,
      userQuestions: questions(execute, () => {
        if (abort) controller.abort();
        else fs.writeFileSync(path.join(dir, 'changed.txt'), 'user change');
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(path.join(dir, '.specgate')), false);
  }
});

test('adopt entry: malformed workspace, damaged state, partial config and custom requirements fail closed', async () => {
  for (const damage of ['yaml', 'state', 'config', 'side']) {
    const dir = root();
    if (damage === 'config') {
      fs.mkdirSync(path.join(dir, '.specgate'));
      fs.writeFileSync(path.join(dir, '.specgate', 'config.yaml'), 'workflowVersion: 4\n');
    } else {
      assert.equal(adoptWorkspace({ root: dir }).ok, true);
      if (damage === 'yaml')
        fs.writeFileSync(path.join(dir, '.specgate', 'workspace.yaml'), 'broken');
      if (damage === 'state') fs.writeFileSync(path.join(dir, '.specgate', 'state.json'), '{}');
      if (damage === 'side') fs.writeFileSync(path.join(dir, 'openspec', 'REQ.md'), '');
    }
    const before = snapshot(dir);
    const result = await approvedAdoptWorkspace({ root: dir, userQuestions: questions(execute) });
    assert.equal(result.ok, false, damage);
    assert.equal(result.code, 'WORKSPACE_INVALID', damage);
    assert.deepEqual(snapshot(dir), before, damage);
  }
  const dir = root();
  const before = snapshot(dir);
  const result = await approvedAdoptWorkspace({
    root: dir,
    draft: { functional: ['authentication'] },
  });
  assert.equal(result.code, 'NEEDS_DESIGN');
  assert.deepEqual(snapshot(dir), before);
});
