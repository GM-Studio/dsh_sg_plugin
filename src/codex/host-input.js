import os from 'node:os';
import { categoryLabel } from './locale.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Derives a local approval actor only when the host operator explicitly enabled
 * interactive approval. Tool arguments and MCP clientInfo cannot set this.
 */
export function interactiveHostIdentity({
  env = process.env,
  userInfo = () => os.userInfo(),
} = {}) {
  if (env.SPECGATE_INTERACTIVE_APPROVAL !== '1') return null;
  let username;
  try {
    username = String(userInfo()?.username || '').trim();
  } catch {
    return null;
  }
  if (!username || username.length > 256) return null;
  return Object.freeze({
    id: username,
    kind: 'user',
    source: 'codex-mcp-os-user',
  });
}

/**
 * Converts MCP elicitation into the provider contract used by requirements
 * clarification. Answers stay user-authored and never enter tool arguments.
 */
export function createPeerUserInputProvider({ requestPeer, trustedUserIdentity } = {}) {
  if (typeof requestPeer !== 'function') return null;
  if (
    !object(trustedUserIdentity) ||
    trustedUserIdentity.kind !== 'user' ||
    typeof trustedUserIdentity.id !== 'string' ||
    typeof trustedUserIdentity.source !== 'string'
  )
    return null;
  return {
    trustedUserIdentity,
    async request({ changeId, round, questions }, { signal } = {}) {
      if (!Array.isArray(questions) || !questions.length)
        throw Object.assign(new Error('Clarification questions are required'), {
          code: 'INVALID_ARGUMENT',
        });
      const properties = Object.fromEntries(
        questions.map((question) => [
          question.id,
          {
            type: 'string',
            title: `[${categoryLabel(question.category)}] ${question.text}`,
            minLength: 1,
            maxLength: 8000,
          },
        ]),
      );
      const result = await requestPeer(
        'elicitation/create',
        {
          message: `SpecGate ${changeId}：第 ${round} 轮需求澄清，请填写以下 ${questions.length} 个问题。回答仅代表澄清，最终需求文档仍须 H1 人工审批。`,
          requestedSchema: {
            type: 'object',
            properties,
            required: questions.map((question) => question.id),
            additionalProperties: false,
          },
        },
        {
          signal,
          // Some Codex hosts can render elicitation even when the client did
          // not advertise the capability. Probe the real channel; the native
          // response still has to arrive before any answer is recorded.
          allowUnadvertised: true,
          timeoutMs: 5 * 60 * 1000,
        },
      );
      if (!object(result) || result.action !== 'accept' || !object(result.content))
        throw Object.assign(new Error('The user did not supply clarification answers'), {
          code: result?.action === 'cancel' ? 'CANCELLED' : 'USER_INPUT_REJECTED',
        });
      return {
        answers: questions.map((question) => ({
          questionId: question.id,
          answer: result.content[question.id],
        })),
      };
    },
  };
}
