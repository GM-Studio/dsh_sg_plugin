import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveSkills,
  loadSkill,
  findSkillFile,
  loadSkillPayload,
  suggestForPhase,
} from '../../src/v3/skills.js';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { initProject, createChange } from '../../src/v3/change.js';
import { verifyEvidence } from '../../src/v3/evidence.js';

const SP_SKILLS = [
  'sp-skill-brainstorming',
  'sp-skill-subagent-driven-development',
  'sp-skill-verification-before-completion',
  'sp-skill-dispatching-parallel-agents',
  'sp-skill-requesting-and-receiving-code-review',
];

test('5 个 Superpowers 技能文件都存在且可加载', () => {
  for (const id of SP_SKILLS) {
    const file = findSkillFile(id);
    assert.ok(file, `${id} 未找到`);
    const text = loadSkill(id);
    assert.ok(text && text.length > 50, `${id} 内容过短`);
    assert.match(text, /^# /);
  }
});

test('未知技能返回 null', () => {
  assert.equal(loadSkill('no-such-skill'), null);
});

test('resolveSkills 按角色与条件组合', () => {
  const impl = resolveSkills({ role: 'implementer' });
  assert.ok(impl.includes('sg-skill-test-driven-development'));
  assert.ok(impl.includes('sp-skill-subagent-driven-development'));

  const parallel = resolveSkills({ role: 'implementer', parallel: true });
  assert.ok(parallel.includes('sp-skill-dispatching-parallel-agents'));

  const retry = resolveSkills({ role: 'tester', retry: true });
  assert.ok(retry.includes('sg-skill-systematic-debugging'));

  const brain = resolveSkills({ phase: 'H1_PENDING', multiCapability: true });
  assert.ok(brain.includes('sp-skill-brainstorming'));
});

test('suggestForPhase 返回阶段建议', () => {
  assert.ok(suggestForPhase('H1_PENDING').length > 0);
  assert.ok(suggestForPhase('PLAN').includes('sg-skill-writing-plans'));
  assert.deepEqual(suggestForPhase('DONE'), []);
});

test('loadSkillPayload 带正文', () => {
  const payload = loadSkillPayload({ role: 'reviewer' });
  assert.ok(payload.length >= 2);
  assert.ok(payload.every((item) => item.id && item.text.length > 0));
});

function makeCtx() {
  const tools = new Map();
  return {
    get: () => undefined,
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    toolsMap: tools,
  };
}

test('sg_skill 工具返回正文并写证据', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-skill-'));
  initProject(root);
  createChange(root, { name: 'skill-demo', type: 'feature' });
  const ctx = makeCtx();
  const runtime = createRuntime(ctx, { root });
  registerTools(ctx, runtime);

  const result = await ctx.toolsMap
    .get('sg_skill')
    .execute({ name: 'sp-skill-brainstorming' }, { agent: null });
  assert.match(result.text, /brainstorming/);
  assert.equal(result.data.skill, 'sp-skill-brainstorming');

  const evidence = verifyEvidence(root, 'skill-demo');
  assert.equal(evidence.ok, true);
  assert.ok(evidence.count >= 1);
});
