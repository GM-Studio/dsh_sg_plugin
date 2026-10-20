import test from 'node:test';
import assert from 'node:assert/strict';
import { askWizard, selectionFromInitial, summarizeSelection } from '../../src/v4/wizard.js';

function fake(values) {
  return {
    async ask({ questions }) {
      return {
        answers: questions.map((question) => ({
          id: question.id,
          selected: values[question.id] ?? '留空',
        })),
      };
    },
  };
}

test('v4.1 向导：Java 21 + Gradle + Boot 4 + 自定义依赖', async () => {
  const selection = await askWizard({
    userQuestions: fake({
      'sg-v4-backend': 'java',
      'sg-v4-frontend': 'none',
      'sg-v4-api-java-jdk': '21',
      'sg-v4-api-java-build': 'gradle',
      'sg-v4-api-java-boot': '4.x',
      'sg-v4-api-deps-preset': 'custom',
      'sg-v4-api-deps-optional': ['jpa', 'h2', 'lombok'],
    }),
  });
  assert.equal(selection.ok, true);
  const api = selection.sides[0];
  assert.equal(api.jdk, '21');
  assert.equal(api.runtimeVersion, '21');
  assert.equal(api.buildTool, 'gradle');
  assert.equal(api.packageManager, 'gradle');
  assert.equal(api.bootVersion, '4.x');
  assert.deepEqual(api.dependencies.optional, ['jpa', 'h2', 'lombok']);
  assert.ok(summarizeSelection(selection).includes('java / spring-boot / 21 / gradle'));
});

test('v4.1 向导：Java 8 + Boot 3 被拒绝', async () => {
  const selection = await askWizard({
    userQuestions: fake({
      'sg-v4-backend': 'java',
      'sg-v4-frontend': 'none',
      'sg-v4-api-java-jdk': '8',
      'sg-v4-api-java-build': 'maven',
      'sg-v4-api-java-boot': '3.x',
    }),
  });
  assert.equal(selection.ok, false);
  assert.equal(selection.code, 'E_STACK_INVALID');
});

test('v4.1 向导：Python 2.7 只显示 Flask/Django', async () => {
  const selection = await askWizard({
    userQuestions: fake({
      'sg-v4-backend': 'python',
      'sg-v4-frontend': 'none',
      'sg-v4-api-python-version': '2.7',
      'sg-v4-api-python-framework': 'django',
      'sg-v4-api-python-packaging': 'pip',
      'sg-v4-api-deps-preset': 'minimal',
    }),
  });
  assert.equal(selection.ok, true);
  const api = selection.sides[0];
  assert.equal(api.pythonVersion, '2.7');
  assert.equal(api.framework, 'django');
  assert.equal(api.packageManager, 'pip');
  assert.equal(api.dependencies.required.includes('fastapi'), false);
});

test('v4.1 向导：Node NestJS 强制 TypeScript', async () => {
  const selection = await askWizard({
    userQuestions: fake({
      'sg-v4-backend': 'node',
      'sg-v4-frontend': 'none',
      'sg-v4-api-node-version': '24',
      'sg-v4-api-node-package-manager': 'pnpm',
      'sg-v4-api-node-framework': 'nestjs',
      'sg-v4-api-node-language': 'typescript',
      'sg-v4-api-deps-preset': 'recommended',
    }),
  });
  assert.equal(selection.ok, true);
  assert.equal(selection.sides[0].framework, 'nestjs');
  assert.equal(selection.sides[0].language, 'typescript');
  assert.equal(selection.sides[0].runtimeVersion, '24');
});

test('v4.1 向导：无问答器时使用静态默认值', async () => {
  const selection = await selectionFromInitial({
    backend: 'python',
    frontend: 'react',
    sides: {
      api: { framework: 'fastapi', pythonVersion: '3.12', preset: 'minimal' },
      web: { language: 'typescript', preset: 'minimal' },
    },
  });
  assert.equal(selection.ok, true);
  assert.equal(selection.interactive, false);
  assert.equal(selection.sides.length, 2);
  assert.equal(selection.sides[0].dependencies.preset, 'minimal');
});
