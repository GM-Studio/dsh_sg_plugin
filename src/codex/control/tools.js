import { resolveControlRoot } from './config.js';
import { createLocalControlRuntime } from './runtime.js';
import { hashValue } from '../events.js';

const definition = (name, description, properties = {}, required = [], readOnly = false) => ({
  name,
  description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: {
    readOnlyHint: readOnly,
    destructiveHint: false,
    idempotentHint: readOnly,
    openWorldHint: false,
  },
});

const text = (maximum, description) => ({
  type: 'string',
  minLength: 1,
  maxLength: maximum,
  description,
});
const textList = (maximumItems, maximumLength, description) => ({
  type: 'array',
  maxItems: maximumItems,
  items: { type: 'string', minLength: 1, maxLength: maximumLength },
  description,
});

export const CONTROL_TOOLS = Object.freeze([
  definition(
    'sg_work_item_create',
    'Create a durable asynchronous WorkItem in the local control store for the bound project. The supervisor, not this tool, executes it.',
    {
      title: text(256, 'Short user-facing WorkItem title.'),
      request: text(16000, 'Business request for autonomous delivery execution.'),
      priority: { type: 'string', enum: ['low', 'normal', 'high'] },
      budget: {
        type: 'object',
        properties: {
          wallClockMs: { type: 'integer', minimum: 1000, maximum: 2000000000 },
          maxModelTokens: { type: 'integer', minimum: 1, maximum: 2000000000 },
          maxToolCalls: { type: 'integer', minimum: 1, maximum: 2000000000 },
          maxRepairRounds: { type: 'integer', minimum: 1, maximum: 2000000000 },
          maxNotificationAttempts: { type: 'integer', minimum: 1, maximum: 2000000000 },
          maxEvidenceBytes: { type: 'integer', minimum: 1, maximum: 2000000000 },
        },
        additionalProperties: false,
      },
    },
    ['title', 'request'],
  ),
  definition(
    'sg_work_item_status',
    'Read the current WorkItem, execution, attention, decisions and notification state without writing.',
    {
      workItemId: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
      },
    },
    [],
    true,
  ),
  definition(
    'sg_work_item_wait',
    'Create a durable AttentionRequest for the current WorkItem, mark it waiting for the user and stop autonomous execution. This tool does not approve anything.',
    {
      workItemId: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
      },
      scope: {
        type: 'string',
        minLength: 1,
        maxLength: 256,
      },
      type: {
        type: 'string',
        enum: [
          'H1_APPROVAL',
          'H3_APPROVAL',
          'CLARIFICATION',
          'BLOCKED',
          'FAILED',
          'OFFLINE',
          'BUDGET',
          'CUSTOMER_ACCEPTANCE',
          'COMPLETION',
        ],
      },
      reason: text(4000, 'Why the user is required.'),
      question: text(4000, 'The bounded decision or information requested.'),
      actions: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'string',
          enum: [
            'approve',
            'request_changes',
            'answer',
            'pause',
            'resume',
            'retry',
            'cancel',
            'accept_delivery',
          ],
        },
      },
      summary: text(16000, 'Business result and context.'),
      risks: textList(100, 4000, 'Known risks.'),
      evidence: textList(200, 1024, 'Evidence references.'),
      expiresAt: { type: 'string', minLength: 1, maxLength: 64 },
    },
    ['workItemId', 'type', 'reason', 'question', 'actions'],
  ),
]);

export function controlControlService({ env = process.env, clock = Date.now } = {}) {
  return createLocalControlRuntime({ env, clock });
}

export async function callControlTool(
  { projectRoot, env = process.env, clock = Date.now, service } = {},
  name,
  args = {},
) {
  const runtime = service ? null : controlControlService({ env, clock });
  const control = service || runtime.service;
  if (name === 'sg_work_item_create') {
    const created = await control.createWorkItem({
      title: args.title,
      request: args.request,
      priority: args.priority,
      budget: args.budget,
      projectRoot,
    });
    return created.ok
      ? {
          ...created,
          controlRoot: service ? null : resolveControlRoot({ env }),
          next: 'Start or keep the local supervisor running, then monitor this WorkItem.',
        }
      : created;
  }
  if (name === 'sg_work_item_status') {
    const workItemId = args.workItemId || env.SPECGATE_WORK_ITEM_ID;
    if (!workItemId) {
      const listed = await control.projection.listWorkItems();
      return listed.ok ? { ...listed, controlRoot: resolveControlRoot({ env }) } : listed;
    }
    const item = await control.projection.getWorkItem(workItemId);
    return item.ok ? { ...item, controlRoot: resolveControlRoot({ env }) } : item;
  }
  if (name === 'sg_work_item_wait') {
    const configuredWorkItem = env.SPECGATE_WORK_ITEM_ID;
    if (configuredWorkItem && args.workItemId !== configuredWorkItem)
      return {
        ok: false,
        code: 'WORK_ITEM_SCOPE_MISMATCH',
        message: 'A worker may only request attention for its own WorkItem',
      };
    if (['H1_APPROVAL', 'H3_APPROVAL', 'CUSTOMER_ACCEPTANCE'].includes(args.type))
      return {
        ok: false,
        code: 'CONTROL_GATE_TOOL_REQUIRED',
        message: 'H1/H3 and customer acceptance must use their bound gate workflows',
      };
    const current = await control.projection.getWorkItem(args.workItemId);
    if (!current.ok) return current;
    return control.requestAttention({
      workItemId: args.workItemId,
      scope: args.scope,
      expectedVersion: current.workItem.revision,
      type: args.type,
      reason: args.reason,
      question: args.question,
      actions: args.actions,
      artifactHash: hashValue({
        workItemId: args.workItemId,
        type: args.type,
        revision: current.workItem.revision,
      }),
      summary: args.summary,
      risks: args.risks,
      evidence: args.evidence,
      expiresAt: args.expiresAt,
    });
  }
  return { ok: false, code: 'UNKNOWN_TOOL', message: 'Control tool is unavailable' };
}
