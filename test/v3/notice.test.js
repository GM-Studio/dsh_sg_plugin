import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginCommandNotice,
  deliverCommandResult,
  sessionOf,
  withNotice,
} from '../../src/v3/notice.js';

function fakeSession(messages = []) {
  return {
    appended: [],
    deriveMessages() {
      return messages;
    },
    append(message) {
      this.appended.push(message);
      messages.push(message);
      return message;
    },
  };
}

test('command invocation has no session field; notice resolves agent.session', () => {
  const session = fakeSession();
  const invocation = { commandId: 'cmd-1', agent: { status: 'idle', session }, rawInput: '' };
  assert.equal(sessionOf(invocation), session);
  const delivered = deliverCommandResult(
    invocation,
    { text: '验证完成：通过' },
    { agent: invocation.agent },
  );
  assert.equal(delivered.delivered, true);
  assert.equal(delivered.via, 'notice');
  assert.equal(session.appended.length, 1);
  assert.equal(session.appended[0].source.form, 'notice');
  assert.equal(session.appended[0].content[0].text, '验证完成：通过');
});

test('notices skip non-empty conversations and running agents', () => {
  const nonEmpty = fakeSession([{ role: 'user', content: [] }]);
  const invocation = { agent: { status: 'idle', session: nonEmpty } };
  assert.equal(deliverCommandResult(invocation, { text: 'x' }).delivered, false);
  const running = fakeSession();
  const runningInvocation = { agent: { status: 'running', session: running } };
  assert.equal(deliverCommandResult(runningInvocation, { text: 'x' }).delivered, false);
});

test('long command start notice activates a blank session and final result follows', () => {
  const session = fakeSession();
  const invocation = { agent: { status: 'idle', session } };
  assert.equal(beginCommandNotice(invocation, 'SpecGate 验证开始\n目录：/tmp/app').started, true);
  assert.equal(session.appended.length, 1);
  assert.equal(session.appended[0].source.summary, 'SpecGate 验证开始');
  // 会话已有内容，但本次命令已开始，最终结果仍需可见。
  assert.equal(deliverCommandResult(invocation, { text: '验证通过' }).delivered, true);
  assert.equal(session.appended.length, 2);
  assert.equal(session.appended[1].content[0].text, '验证通过');
  // 命令结束后不再追加。
  assert.equal(deliverCommandResult(invocation, { text: 'again' }).delivered, false);
});

test('withNotice turns thrown handlers into visible failed text', async () => {
  const session = fakeSession();
  const handler = withNotice(async () => {
    throw new Error('boom');
  });
  const result = await handler({ agent: { status: 'idle', session } });
  assert.equal(result.failed, true);
  assert.match(result.text, /命令执行失败：boom/);
  assert.equal(session.appended.length, 1);
  assert.match(session.appended[0].content[0].text, /命令执行失败：boom/);
});
