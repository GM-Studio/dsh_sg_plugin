import test from 'node:test';
import assert from 'node:assert/strict';
import { createPeerUserInputProvider, interactiveHostIdentity } from '../src/codex/host-input.js';

test('interactive approval identity is server-derived only when explicitly enabled', () => {
  assert.equal(interactiveHostIdentity({ env: {}, userInfo: () => ({ username: 'alice' }) }), null);
  assert.deepEqual(
    interactiveHostIdentity({
      env: { SPECGATE_INTERACTIVE_APPROVAL: '1' },
      userInfo: () => ({ username: 'alice' }),
    }),
    {
      id: 'alice',
      kind: 'user',
      source: 'codex-mcp-os-user',
    },
  );
  assert.equal(
    interactiveHostIdentity({
      env: { SPECGATE_INTERACTIVE_APPROVAL: '1' },
      userInfo: () => ({ username: '' }),
    }),
    null,
  );
});

test('MCP elicitation probes the real channel and supplies clarification answers', async () => {
  const trustedUserIdentity = {
    id: 'alice',
    kind: 'user',
    source: 'codex-mcp-os-user',
  };
  const calls = [];
  const provider = createPeerUserInputProvider({
    trustedUserIdentity,
    requestPeer: async (method, params, options) => {
      calls.push({ method, params, options });
      return {
        action: 'accept',
        content: Object.fromEntries(
          params.requestedSchema.required.map((id) => [id, `answer-${id}`]),
        ),
      };
    },
  });
  const result = await provider.request({
    changeId: 'change',
    round: 1,
    questions: [
      { id: 'Q-1', category: 'functional', text: 'Who may edit?' },
      { id: 'Q-2', category: 'security', text: 'Which roles are read-only?' },
    ],
  });
  assert.equal(calls[0].method, 'elicitation/create');
  assert.equal(calls[0].options.allowUnadvertised, true);
  assert.equal(calls[0].options.timeoutMs, 300000);
  assert.deepEqual(calls[0].params.requestedSchema.required, ['Q-1', 'Q-2']);
  assert.deepEqual(result.answers, [
    { questionId: 'Q-1', answer: 'answer-Q-1' },
    { questionId: 'Q-2', answer: 'answer-Q-2' },
  ]);
});

test('clarification fails closed when the real channel rejects or cancels', async () => {
  const identity = { id: 'alice', kind: 'user', source: 'codex-mcp-os-user' };
  const rejected = createPeerUserInputProvider({
    trustedUserIdentity: identity,
    requestPeer: async () => ({ action: 'decline' }),
  });
  await assert.rejects(
    rejected.request({
      changeId: 'change',
      round: 1,
      questions: [{ id: 'Q-1', category: 'functional', text: 'Question?' }],
    }),
    (error) => error.code === 'USER_INPUT_REJECTED',
  );
});

test('clarification renders single choice, multiple choice and text as distinct native controls', async () => {
  let schema;
  const provider = createPeerUserInputProvider({
    trustedUserIdentity: { id: 'alice', kind: 'user', source: 'codex-mcp-os-user' },
    requestPeer: async (_method, params) => {
      schema = params.requestedSchema;
      return {
        action: 'accept',
        content: { single: 'Vue', multiple: ['查询', '导出'], text: '补充说明' },
      };
    },
  });
  const response = await provider.request({
    changeId: 'controls',
    round: 2,
    questions: [
      {
        id: 'single',
        category: 'constraint',
        text: '框架',
        input: 'choice',
        options: ['Vue', 'React'],
      },
      {
        id: 'multiple',
        category: 'functional',
        text: '功能',
        input: 'multi-choice',
        options: ['查询', '导出'],
      },
      { id: 'text', category: 'boundary', text: '说明', input: 'text' },
    ],
  });
  assert.equal(schema.properties.single.type, 'string');
  assert.deepEqual(schema.properties.single.enum, ['Vue', 'React']);
  assert.equal(schema.properties.multiple.type, 'array');
  assert.deepEqual(schema.properties.multiple.items.enum, ['查询', '导出']);
  assert.equal(schema.properties.text.type, 'string');
  assert.equal(schema.properties.text.enum, undefined);
  assert.deepEqual(response.answers[1].answer, ['查询', '导出']);
});
