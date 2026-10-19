import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initProject,
  createChange,
  parseConfig,
  readConfig,
  configPath,
} from '../../src/v3/change.js';
import { load, patchState } from '../../src/v3/state.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-change-'));
}

test('parseConfig 解析扁平键与嵌套段', () => {
  const config = parseConfig(`workflowVersion: 3
language: zh
testing:
  command: ["node", "--test"]
  cwd: "."
maxParallel: 2
coverage:
  blocking: false
`);
  assert.equal(config.workflowVersion, 3);
  assert.equal(config.language, 'zh');
  assert.deepEqual(config.testing.command, ['node', '--test']);
  assert.equal(config.testing.cwd, '.');
  assert.equal(config.maxParallel, 2);
  assert.equal(config.coverage.blocking, false);
});

test('initProject 创建目录、配置与状态', () => {
  const root = tempRoot();
  const result = initProject(root);
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(configPath(root)), true);
  assert.equal(fs.existsSync(path.join(root, 'openspec', 'specs')), true);
  assert.equal(fs.existsSync(path.join(root, '.specgate', 'worktrees')), true);
  const state = load(root);
  assert.equal(state.ok, true);
  assert.equal(state.state.phase, 'IDLE');
  assert.equal(readConfig(root).workflowVersion, 3);
});

test('initProject 幂等，不重复写 gitignore', () => {
  const root = tempRoot();
  initProject(root);
  const before = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const second = initProject(root);
  assert.equal(second.ok, true);
  assert.deepEqual(second.ignored, []);
  const after = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.equal(after, before);
  assert.equal((after.match(/\.specgate\/worktrees\//g) || []).length, 1);
});

test('initProject 拒绝 workflowVersion<3 的项目', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(configPath(root), 'workflowVersion: 2\n', 'utf8');
  const result = initProject(root);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORKFLOW_VERSION_MISMATCH');
});

test('createChange 需要先初始化', () => {
  const root = tempRoot();
  const result = createChange(root, { name: 'add-login', type: 'feature' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STATE_MISSING');
});

test('createChange 创建包并推进到 H1_PENDING', () => {
  const root = tempRoot();
  initProject(root);
  const result = createChange(root, { name: 'add-login', type: 'feature', baseCommit: 'abc123' });
  assert.equal(result.ok, true);
  const changeDir = path.join(root, 'openspec', 'changes', 'add-login');
  for (const relative of [
    'proposal.md',
    'design.md',
    'tasks.md',
    'tests/cases.md',
    'tests/mapping.json',
    'tests/touched.json',
  ]) {
    assert.equal(fs.existsSync(path.join(changeDir, relative)), true, relative);
  }
  const state = load(root);
  assert.equal(state.state.change, 'add-login');
  assert.equal(state.state.type, 'feature');
  assert.equal(state.state.phase, 'H1_PENDING');
  assert.equal(state.state.baseCommit, 'abc123');
  const mapping = JSON.parse(fs.readFileSync(path.join(changeDir, 'tests', 'mapping.json'), 'utf8'));
  assert.equal(mapping.change, 'add-login');
});

test('createChange 拒绝非法名称与类型', () => {
  const root = tempRoot();
  initProject(root);
  assert.equal(createChange(root, { name: 'Add Login' }).code, 'INVALID_CHANGE_NAME');
  assert.equal(createChange(root, { name: 'add-login', type: 'wip' }).code, 'INVALID_CHANGE_TYPE');
});

test('createChange 拒绝同名目录', () => {
  const root = tempRoot();
  initProject(root);
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'add-login'), { recursive: true });
  const result = createChange(root, { name: 'add-login' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CHANGE_EXISTS');
});

test('有进行中的 change 时拒绝新建', () => {
  const root = tempRoot();
  initProject(root);
  assert.equal(createChange(root, { name: 'first-change' }).ok, true);
  const second = createChange(root, { name: 'second-change' });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'CHANGE_ACTIVE');
});

test('ABORTED 后可以新建 change', () => {
  const root = tempRoot();
  initProject(root);
  createChange(root, { name: 'first-change' });
  patchState(root, (draft) => {
    draft.phase = 'ABORTED';
  });
  const second = createChange(root, { name: 'second-change' });
  assert.equal(second.ok, true);
});
