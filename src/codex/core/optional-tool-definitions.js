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
