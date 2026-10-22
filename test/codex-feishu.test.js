import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFeishuNotifier,
  renderFeishuCard,
  validateFeishuWebhook,
} from '../src/codex/channels/feishu.js';

const webhook = 'https://open.feishu.cn/open-apis/bot/v2/hook/example';

function response(body = { code: 0, msg: 'success' }, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test('Feishu webhook requires HTTPS without embedded credentials', () => {
  assert.equal(validateFeishuWebhook(webhook).ok, true);
  assert.equal(validateFeishuWebhook('http://open.feishu.cn/hook').ok, false);
  assert.equal(validateFeishuWebhook('https://user:pass@open.feishu.cn/hook').ok, false);
});

test('Feishu notifier sends an interactive card and classifies API errors', async () => {
  const calls = [];
  const notifier = createFeishuNotifier({
    webhookUrl: webhook,
    timeoutMs: 1000,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response();
    },
  });
  const sent = await notifier.send({
    workItem: { title: 'Export fix' },
    attention: {
      type: 'H1_APPROVAL',
      reason: 'Confirm scope',
      question: 'Approve?',
      actions: ['approve', 'request_changes'],
      risks: [],
      expiresAt: '2026-10-23T10:00:00.000Z',
    },
    managementUrl: 'https://management.example.test/#attention=a-1',
  });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(JSON.parse(calls[0].options.body).msg_type, 'interactive');

  const rejected = createFeishuNotifier({
    webhookUrl: webhook,
    fetchImpl: async () => response({ code: 19001, msg: 'bad request' }),
  });
  const failure = await rejected.send({
    workItem: { title: 'x' },
    attention: { actions: [], risks: [] },
    managementUrl: 'https://management.example.test',
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.code, 'FEISHU_API_ERROR');
  assert.doesNotMatch(JSON.stringify(failure), /open-apis\/bot\/v2\/hook/);
});

test('Feishu card redacts internal paths and credentials and only opens the management URL', () => {
  const card = renderFeishuCard({
    workItem: {
      title: 'C:\\client\\secret-project\\export',
      request: 'Use token=abcdefghijklmnop and open /tmp/internal.',
    },
    attention: {
      type: 'H3_APPROVAL',
      reason: 'Review C:\\private\\artifact.json',
      question: 'Approve token=abcdefghijklmnop?',
      summary: 'Tests passed.',
      risks: ['Path /home/owner/project remains.'],
      actions: ['approve', 'request_changes'],
      expiresAt: '2026-10-23T10:00:00.000Z',
    },
    managementUrl: 'https://management.example.test/#attention=a-1',
  });
  const serialized = JSON.stringify(card);
  assert.doesNotMatch(serialized, /client|private|abcdefghijklmnop|home\/owner|tmp\/internal/i);
  assert.match(serialized, /management\.example\.test/);
  const buttons = card.card.elements
    .filter((entry) => entry.tag === 'action')
    .flatMap((entry) => entry.actions);
  assert.ok(buttons.length >= 1);
  assert.ok(
    buttons.every((button) => button.url === 'https://management.example.test/#attention=a-1'),
  );
  assert.ok(buttons.every((button) => !Object.hasOwn(button, 'value')));
  assert.match(card.card.elements[0].text.content, /approve/);
});

test('Feishu renders a non-actionable resolution follow-up after a Decision', () => {
  const card = renderFeishuCard({
    workItem: { title: 'Export fix' },
    attention: {
      type: 'H1_APPROVAL',
      reason: 'Confirm scope',
      question: 'Approve?',
      actions: ['approve', 'request_changes'],
      expiresAt: '2026-10-23T10:00:00.000Z',
    },
    notification: {
      kind: 'resolution',
      status: 'DECIDED',
      action: 'approve',
      decidedAt: '2026-10-22T10:05:00.000Z',
    },
    managementUrl: 'https://management.example.test/#attention=a-1',
  });
  const serialized = JSON.stringify(card);
  assert.equal(card.ok, true);
  assert.match(serialized, /SpecGate · 已处理/);
  assert.match(serialized, /approve/);
  assert.match(serialized, /不再可操作/);
  assert.equal(card.card.elements.filter((entry) => entry.tag === 'action').length, 1);
});

test('Feishu notifier has bounded timeout and never leaks the webhook on failure', async () => {
  const notifier = createFeishuNotifier({
    webhookUrl: webhook,
    timeoutMs: 5,
    fetchImpl: async (_url, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
  });
  const result = await notifier.send({
    workItem: { title: 'x' },
    attention: { actions: [], risks: [] },
    managementUrl: 'https://management.example.test',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FEISHU_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(result), /example/);
});
