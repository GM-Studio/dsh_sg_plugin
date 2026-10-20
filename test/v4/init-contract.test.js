import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createInitContract,
  requestInitApproval,
  consumeInitApproval,
  clarifyInitRequirements,
} from '../../src/v4/init-contract.js';
import { startV4Init, resolveInitRoot } from '../../src/v4/init.js';
import { scanEnvironment } from '../../src/v4/environment.js';

function target() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-contract-')), 'new', 'project');
}
function contract(root) {
  return createInitContract({
    root,
    selection: { backend: 'node', frontend: 'none', sides: [] },
    profile: 'full',
  });
}
function approve() {
  return {
    async ask({ questions }) {
      const question = questions[0];
      return { answers: [{ id: question.id, selected: [question.options.at(-1).label] }] };
    },
  };
}

test('path resolution never creates missing parents', () => {
  const root = target();
  assert.equal(resolveInitRoot(path.dirname(root), root).ok, true);
  assert.equal(fs.existsSync(path.dirname(root)), false);
});

for (const [name, service] of [
  ['absent', null],
  [
    'throws',
    {
      async ask() {
        throw new Error('unavailable');
      },
    },
  ],
  [
    'empty',
    {
      async ask() {
        return { answers: [] };
      },
    },
  ],
  [
    'ambiguous',
    {
      async ask() {
        return { answers: [{ selected: ['确认'] }] };
      },
    },
  ],
]) {
  test('approval fails closed: ' + name, async () => {
    const root = target();
    const prepared = contract(root);
    const result = await requestInitApproval({
      contract: prepared,
      userQuestions: service,
      text: 'preview',
    });
    assert.equal(result.decision, 'cancelled');
    assert.equal(fs.existsSync(path.dirname(root)), false);
  });
}

test('human receipt is bound to exact plan and is single use', async () => {
  const root = target();
  const prepared = contract(root);
  const result = await requestInitApproval({
    contract: prepared,
    userQuestions: approve(),
    text: 'preview',
  });
  assert.equal(consumeInitApproval(prepared, { contractId: prepared.id }).ok, false);
  assert.equal(consumeInitApproval(prepared, result.receipt).ok, true);
  assert.equal(consumeInitApproval(prepared, result.receipt).ok, false);
});

test('a changed plan cannot reuse an approved receipt', async () => {
  const root = target();
  const prepared = contract(root);
  const result = await requestInitApproval({
    contract: prepared,
    userQuestions: approve(),
    text: 'preview',
  });
  assert.equal(consumeInitApproval(contract(root), result.receipt).ok, false);
});

test('directory/file changes while confirming invalidate approval', async () => {
  const root = target();
  const prepared = contract(root);
  const result = await requestInitApproval({
    contract: prepared,
    userQuestions: approve(),
    text: 'preview',
  });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'user.txt'), 'user content');
  assert.equal(consumeInitApproval(prepared, result.receipt).code, 'TARGET_CHANGED');
});

test('aborted approval does not grant a receipt', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await requestInitApproval({
    contract: contract(target()),
    userQuestions: approve(),
    text: 'preview',
    signal: controller.signal,
  });
  assert.equal(result.decision, 'cancelled');
});

for (const profile of ['minimal', 'full']) {
  test(profile + ': yes cannot substitute human approval', async () => {
    const root = target();
    const result = await startV4Init({
      root,
      profile,
      backend: 'node',
      frontend: 'none',
      yes: true,
    });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(path.dirname(root)), false);
  });
  test(profile + ': cancellation after clarification is zero write', async () => {
    const root = target();
    const result = await startV4Init({
      root,
      profile,
      backend: 'node',
      frontend: 'none',
      userQuestions: {
        async ask({ questions }) {
          return {
            answers: questions.map((question) => ({
              id: question.id,
              selected: [question.id.startsWith('sg-v4-init-') ? '使用上述范围' : '暂不执行'],
            })),
          };
        },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(path.dirname(root)), false);
  });
}

test('custom requirements cannot silently become a default scaffold', async () => {
  const result = await clarifyInitRequirements({
    profile: 'full',
    userQuestions: {
      async ask() {
        return { answers: [{ custom: '必须使用 PostgreSQL 持久化' }] };
      },
    },
  });
  assert.equal(result.code, 'NEEDS_DESIGN');
});

test('readonly environment inventory creates no directories or probes', async () => {
  const root = target();
  const environment = await scanEnvironment({ root, readOnly: true, env: { PATH: '' } });
  assert.equal(environment.readOnly, true);
  assert.equal(environment.sandbox.projectWritable, null);
  assert.equal(environment.network.skipped, true);
  assert.equal(fs.existsSync(path.dirname(root)), false);
});
