import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalText, askApproval, planForSide, skipQuality } from '../../src/v4/approval.js';
import { selectionFromInitial } from '../../src/v4/wizard.js';

function fake(value) {
  return {
    async ask() {
      return { answers: [{ id: 'sg-v4-quality-approval', selected: [value] }] };
    },
  };
}

test('v4.1 审批：详情仅展示操作目录与技术栈', async () => {
  const selection = await selectionFromInitial({
    backend: 'java',
    frontend: 'react',
    sides: {
      api: { jdk: '17', buildTool: 'maven', bootVersion: '3.x', preset: 'recommended' },
      web: { language: 'typescript', preset: 'recommended' },
    },
  });
  const text = approvalText(selection, {
    root: '/projects/my app',
    provisionSummary: 'verbose environment',
  });
  assert.ok(text.includes('操作目录：\n/projects/my app'));
  assert.match(text, /java \/ spring-boot \/ 17 \/ maven/);
  assert.match(text, /react \/ vite \/ typescript/);
  assert.doesNotMatch(text, /Spring Web|Lombok|必选|可选|将执行|verbose environment/);
  assert.doesNotMatch(text, /mvnw|pnpm install/);
  assert.ok(text.length < 1200, 'approval text too long: ' + text.length);
  assert.ok(
    text.split('\n').length <= 20,
    'approval text too many lines: ' + text.split('\n').length,
  );
});

test('v4.1 审批：三种选择与默认跳过', async () => {
  const selection = await selectionFromInitial({ backend: 'node', frontend: 'none' });
  assert.equal(await askApproval({ userQuestions: fake('批准并执行'), selection }), 'approved');
  assert.equal(
    await askApproval({ userQuestions: fake('跳过，仅生成代码'), selection }),
    'skipped',
  );
  assert.equal(await askApproval({ userQuestions: fake('返回修改'), selection }), 'modify');
  assert.equal(await askApproval({ userQuestions: null, selection }), 'skipped');
});

test('v4.1 审批：命令计划按栈生成', async () => {
  const java = await selectionFromInitial({ backend: 'java', frontend: 'none' });
  const javaPlan = planForSide(java.sides[0]);
  assert.equal(
    javaPlan.some((item) => item.phase === 'install'),
    true,
  );
  assert.equal(
    javaPlan.some((item) => item.command.includes('spotless:apply')),
    true,
  );

  const py = await selectionFromInitial({ backend: 'python', frontend: 'none' });
  const pyPlan = planForSide(py.sides[0]);
  assert.equal(
    pyPlan.some((item) => item.command.includes('pip install')),
    true,
  );
  assert.equal(
    pyPlan.some((item) => item.command.includes('pytest')),
    true,
  );

  const label = await skipQuality('x')({});
  assert.equal(label.skipped, true);
  assert.equal(label.reason, 'x');
});
