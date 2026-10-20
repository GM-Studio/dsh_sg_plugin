import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startV4Init } from '../../src/v4/init.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v4-flow-'));
}

test('v4.1 init：不再询问四维需求，直接进入最终审批', async () => {
  const root = tempRoot();
  const asked = [];
  const answers = {
    'sg-v4-backend': 'node',
    'sg-v4-frontend': 'none',
    'sg-v4-api-node-version': '22',
    'sg-v4-api-node-package-manager': 'pnpm',
    'sg-v4-api-node-framework': 'express',
    'sg-v4-api-node-language': 'typescript',
    'sg-v4-api-deps-preset': 'minimal',
    'sg-v4-quality-approval': '跳过，仅生成代码',
  };
  const userQuestions = {
    async ask({ questions }) {
      for (const question of questions) asked.push(question.id);
      return {
        answers: questions.map((question) => ({
          id: question.id,
          selected: [answers[question.id] || '留空'],
        })),
      };
    },
  };
  const result = await startV4Init({
    root,
    userQuestions,
    qualityRunner: async () => {
      throw new Error('quality runner must not run when approval is skipped');
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.approved, false);
  assert.equal(
    asked.some((id) => id.startsWith('sg-init-req-')),
    false,
  );
  assert.equal(asked.includes('sg-v4-requirements-confirm'), false);
  assert.equal(asked.includes('sg-v4-quality-approval'), true);
  assert.equal(result.build.results[0].qualityStatus, 'skipped');
  assert.ok(fs.existsSync(path.join(root, 'api', 'src', 'items.ts')));
});
