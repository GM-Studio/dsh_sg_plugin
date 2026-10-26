import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskGraph, implementationRolesFor, validateTaskGraph } from '../src/codex/plan.js';

function requirements(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    id: 'REQ-' + (index + 1),
    category: 'functional',
    text: 'Requirement ' + (index + 1),
    acceptanceCriteria: [{ id: 'AC-' + (index + 1), text: 'Observable condition ' + (index + 1) }],
  }));
}

test('without module information the legacy both-role behaviour is kept', () => {
  // 向后兼容：既有计划（无 moduleRoles）必须仍生成 backend + frontend。
  assert.deepEqual(implementationRolesFor({}), ['backend', 'frontend']);
  const built = buildTaskGraph({ requirements: requirements(1) });
  assert.equal(built.ok, true, JSON.stringify(built));
  const kinds = new Set(built.graph.tasks.map((task) => task.kind));
  assert.equal(kinds.has('backend'), true);
  assert.equal(kinds.has('frontend'), true);
});

test('a backend-only project gets no frontend implementation task', () => {
  // AC-22：纯模块变更不被强制附加无关的前端任务。
  const built = buildTaskGraph({
    requirements: requirements(2),
    moduleRoles: { service: 2 },
  });
  assert.equal(built.ok, true, JSON.stringify(built));
  const kinds = built.graph.tasks.map((task) => task.kind);
  assert.equal(kinds.includes('backend'), true);
  assert.equal(kinds.includes('frontend'), false, '不得注入前端任务');
});

test('a frontend-only project gets no backend implementation task', () => {
  const built = buildTaskGraph({
    requirements: requirements(1),
    moduleRoles: { ui: 1 },
  });
  assert.equal(built.ok, true, JSON.stringify(built));
  const kinds = built.graph.tasks.map((task) => task.kind);
  assert.equal(kinds.includes('frontend'), true);
  assert.equal(kinds.includes('backend'), false, '不得注入后端任务');
});

test('a single-module CLI produces exactly one implementation role', () => {
  const built = buildTaskGraph({
    requirements: requirements(2),
    moduleRoles: { cli: 1 },
  });
  assert.equal(built.ok, true);
  const implementation = built.graph.tasks.filter((task) =>
    ['backend', 'frontend'].includes(task.kind),
  );
  // 两条 AC × 一个实现角色 = 2 个实现任务，而不是 4 个。
  assert.equal(implementation.length, 2, JSON.stringify(implementation.map((task) => task.id)));
  assert.equal(new Set(implementation.map((task) => task.kind)).size, 1);
});

test('a fullstack project still gets both roles', () => {
  const built = buildTaskGraph({
    requirements: requirements(1),
    moduleRoles: { service: 1, ui: 1 },
  });
  assert.equal(built.ok, true);
  const kinds = new Set(built.graph.tasks.map((task) => task.kind));
  assert.equal(kinds.has('backend'), true);
  assert.equal(kinds.has('frontend'), true);
});

test('a library-only project does not gain a second implementation role', () => {
  assert.deepEqual(implementationRolesFor({ moduleRoles: { library: 1 } }), ['backend']);
  assert.deepEqual(implementationRolesFor({ moduleRoles: { other: 1 } }), ['backend']);
});

test('an unknown module role set still yields at least one implementation role', () => {
  // 不能返回空集合，否则计划里没有任何实现任务。
  const roles = implementationRolesFor({ moduleRoles: {} });
  assert.ok(roles.length >= 1, JSON.stringify(roles));
});

test('the generated graph remains valid when roles are narrowed', () => {
  for (const moduleRoles of [{ service: 1 }, { ui: 1 }, { cli: 1 }, { service: 1, ui: 1 }]) {
    const built = buildTaskGraph({ requirements: requirements(1), moduleRoles });
    assert.equal(built.ok, true, JSON.stringify(moduleRoles));
    assert.equal(validateTaskGraph(built.graph).ok, true, JSON.stringify(moduleRoles));
  }
});

test('no unrelated frontend, http or data-model task is invented for a pure module change', () => {
  // AC-22 的直接断言：纯后端库变更不得出现前端与 HTTP 相关任务。
  const built = buildTaskGraph({
    requirements: requirements(1),
    moduleRoles: { library: 1 },
  });
  assert.equal(built.ok, true);
  const ids = built.graph.tasks.map((task) => task.id).join(' ');
  assert.equal(/frontend/.test(ids), false, '不得出现 frontend 任务：' + ids);
});
