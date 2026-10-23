const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const string = (description, maxLength = 16000) => ({
  type: 'string',
  minLength: 1,
  maxLength,
  pattern: '\\S',
  description,
});
const identifier = (description) => ({
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
  description,
});
const array = (items, minItems = 0, maxItems = 200) => ({
  type: 'array',
  items,
  minItems,
  maxItems,
});
const version = {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
  description: 'Current authoritative state version from sg_state. Stale versions are rejected.',
};
const category = {
  type: 'string',
  enum: [
    'functional',
    'non-functional',
    'constraint',
    'acceptance',
    'boundary',
    'failure',
    'security',
    'performance',
    'concurrency',
    'compatibility',
  ],
  description:
    'Requirement or clarification topic; use explicit categories to reveal missing coverage.',
};
const criterion = objectSchema({
  id: identifier('Acceptance criterion ID; unique across the proposed requirements.'),
  text: string(
    'Concrete observable acceptance behavior, including relevant failure or boundary behavior.',
  ),
});
const requirement = objectSchema({
  id: identifier(
    'Requirement ID; unique within this revision and referenced by critique findings.',
  ),
  category,
  text: string('Proposed requirement text. The service records this as a model proposal.'),
  acceptanceCriteria: array(criterion, 1, 100),
});
const assumption = objectSchema({
  id: identifier('Assumption ID referenced by a nonblocking unresolved issue.'),
  text: string('Explicit proposed assumption; never silently treat it as a user answer.'),
  risk: string('Risk or consequence if this assumption is incorrect.'),
  pendingConfirmation: {
    type: 'boolean',
    enum: [true],
    description:
      'Must remain true until the native H1 decision; this field does not assert user confirmation.',
  },
});
const openIssue = objectSchema(
  {
    id: identifier('Unique unresolved issue ID.'),
    text: string('Unresolved requirement question or constraint.'),
    blocking: {
      type: 'boolean',
      description:
        'True blocks H1. False requires assumptionId referencing an explicit assumption with its risk.',
    },
    assumptionId: identifier('Required when blocking is false; the service checks the reference.'),
  },
  ['id', 'text', 'blocking'],
);
const question = objectSchema(
  {
    id: identifier('Unique question ID within this round.'),
    category,
    text: string(
      'Question for the native user interaction provider; answers cannot be supplied in tool arguments.',
      2000,
    ),
    input: {
      type: 'string',
      enum: ['text', 'choice', 'multi-choice'],
      description:
        'Native control type. Omit for text compatibility; choice renders a single select and multi-choice renders a multi-select.',
    },
    options: {
      type: 'array',
      items: string('A selectable answer option.', 200),
      minItems: 2,
      maxItems: 20,
      uniqueItems: true,
      description: 'Required for choice and multi-choice; omitted for text questions.',
    },
  },
  ['id', 'category', 'text'],
);
const restatement = objectSchema({
  requirementId: identifier(
    'Existing requirement ID. Every requirement must have exactly one restatement.',
  ),
  text: string('Reverse restatement of what this requirement asks the product to do.'),
});
const finding = objectSchema({
  id: identifier('Finding ID; unique across all categories in this critique.'),
  requirementIds: array(identifier('Referenced existing requirement ID.'), 1, 200),
  text: string(
    'Specific ambiguity, contradiction, infeasibility, risk, test blind spot or suggested question.',
  ),
  severity: {
    type: 'string',
    enum: ['blocking', 'non-blocking'],
    description: 'Any blocking finding prevents H1 freezing.',
  },
  suggestion: string('Concrete clarification or correction needed to address the finding.'),
});
const report = objectSchema({
  restatement: array(restatement, 1, 200),
  ambiguities: array(finding),
  contradictions: array(finding),
  infeasibleItems: array(finding),
  nonFunctionalRisks: array(finding),
  securityPerformanceConcurrencyRisks: array(finding),
  testBlindSpots: array(finding),
  suggestedQuestions: array(finding),
});
const impact = objectSchema(
  {
    affectedAcIds: array(
      identifier(
        'Acceptance criterion ID from the accepted parent delivery that this change affects.',
      ),
      1,
      200,
    ),
    reusedAcIds: array(
      identifier(
        'Affected acceptance criterion whose historical verification is reused; it must also be accepted by the parent.',
      ),
      0,
      200,
    ),
  },
  ['affectedAcIds'],
);
const changeDetails = objectSchema(
  {
    scope: array(string('Confirmed scope item.', 4000)),
    nonGoals: array(string('Confirmed non-goal.', 4000)),
    existingBehavior: string('Current behavior for a modify change.'),
    desiredBehavior: string('Target behavior for a modify change.'),
    compatibility: string('Compatibility statement for a modify change.'),
    expectedBehavior: string('Expected behavior for a fix.'),
    actualBehavior: string('Observed behavior for a fix.'),
    reproduction: string('Optional bounded reproduction steps for a fix.'),
    logs: string('Optional redacted failure log for a fix.'),
    environment: string('Optional affected environment for a fix.'),
    severity: string('Optional bug severity for a fix.', 256),
  },
  [],
);

const definition = (name, description, inputSchema, readOnly = false) => ({
  name,
  description,
  inputSchema,
  annotations: {
    readOnlyHint: readOnly,
    destructiveHint: false,
    idempotentHint: readOnly,
    openWorldHint: false,
  },
});

const changeStart = objectSchema(
  {
    expectedVersion: version,
    name: identifier(
      'Optional unique change name; omitted names are derived from the request deterministically.',
    ),
    request: string('Change request relayed by the command; never a native approval.'),
    type: { type: 'string', enum: ['feature', 'modify', 'fix'] },
    parentDeliveryId: identifier('Optional accepted parent delivery for incremental redelivery.'),
    impact: {
      ...impact,
      description: 'Required with parentDeliveryId: affected and reused acceptance criteria.',
    },
    details: changeDetails,
  },
  ['expectedVersion', 'request', 'type'],
);
const changeH1 = objectSchema({
  expectedVersion: version,
  action: {
    type: 'string',
    enum: ['request_h1'],
    description:
      'Request the same trusted H1 form as sg_request_h1 for the existing change. Never creates a new change or accepts approval through arguments.',
  },
});

export const CHANGE_TOOLS = [
  definition(
    'sg_change_preflight',
    'Read initialization, real verification evidence, source hash, Git cleanliness including untracked files, and the single active change condition. Does not create or advance a change.',
    objectSchema({}),
    true,
  ),
  definition(
    'sg_change_add',
    'Start one add-change requirements intake after real verification and a clean Git worktree, then immediately request the server-owned first round of native user clarification. Preserve the command input provenance; an optional name defaults to a stable slug. When the result is WAITING_FOR_USER, stop and resume clarification; do not propose, critique or request H1. Does not freeze requirements.',
    objectSchema(
      {
        expectedVersion: version,
        name: identifier(
          'Optional unique change name; omitted names are derived from the request deterministically.',
        ),
        request: string(
          'Feature request relayed by the command. Do not include credentials or claim this text is a native approval.',
        ),
      },
      ['expectedVersion', 'request'],
    ),
  ),
  definition(
    'sg_change',
    'Start a unified feature, modify or fix intake after an active ProjectBaseline and a clean Git worktree, then immediately request the server-owned first round of native user clarification. Type-specific details are validated before requirements proceed. When the result is WAITING_FOR_USER, stop and resume clarification; do not propose, critique or request H1. An optional parentDeliveryId plus impact records the incremental affected and reused acceptance criteria for a customer-feedback change.',
    {
      ...objectSchema({ ...changeStart.properties, ...changeH1.properties }, ['expectedVersion']),
      oneOf: [changeStart, changeH1],
    },
  ),
  definition(
    'sg_change_propose',
    'Record an explicit requirements revision with acceptance criteria, assumptions, risks and unresolved issues. Preserve prior revisions and invalidate the previous critique and H1 candidate. All content is recorded as a model proposal.',
    objectSchema({
      expectedVersion: version,
      requirements: array(requirement, 1, 200),
      assumptions: array(assumption),
      openIssues: array(openIssue),
    }),
  ),
  definition(
    'sg_change_questions',
    'Request at most five native-user clarification questions in each of at most three rounds, or resume an unanswered round. A pending round is persisted before the native form opens and remains resumable if the channel fails. A proven native user source is required; the default unavailable source refuses answers. Tool arguments cannot submit answers or a user identity.',
    {
      ...objectSchema(
        {
          expectedVersion: version,
          questions: array(question, 1, 5),
          round: {
            type: 'integer',
            minimum: 1,
            maximum: 3,
            description:
              'Resume this existing unanswered round instead of supplying new questions.',
          },
        },
        ['expectedVersion'],
      ),
      oneOf: [{ required: ['questions'] }, { required: ['round'] }],
    },
  ),
  definition(
    'sg_change_critique',
    'Record a structured model critique with reverse restatements and findings tied to requirement IDs. At least one answered native-user clarification round is mandatory and every clarification round must be answered; otherwise return WAITING_FOR_USER without creating a candidate. All categories are required, using empty arrays when no finding is proposed. Enter H1 pending; unresolved blocking findings still prevent freezing.',
    objectSchema({ expectedVersion: version, report }),
  ),
  definition(
    'sg_request_h1',
    'Ask the server approval authority to review the complete immutable requirements candidate. The same native clarification gate must pass before any candidate artifact or approval request is created. Only a trusted native user response can authorize freezing; the default unavailable source fails closed. No approval, receipt, answer or actor can be supplied here.',
    objectSchema({ expectedVersion: version }),
  ),
];

export const CHANGE_METHODS = Object.freeze({
  sg_change_preflight: 'inspectPrerequisites',
  sg_change_add: 'start',
  sg_change: 'startTyped',
  sg_change_propose: 'propose',
  sg_change_questions: 'askQuestions',
  sg_change_critique: 'critique',
  sg_request_h1: 'requestH1',
});

/** Pure dispatch to an already constructed server-owned service. The registry
 * validates the complete JSON Schema; the core also enforces semantic bindings.
 * This wrapper denies unexpected top-level credentials even without a registry. */
export async function callChangeTool(service, name, args = {}, context = {}) {
  const definition = CHANGE_TOOLS.find((tool) => tool.name === name);
  if (!definition)
    return { ok: false, code: 'UNKNOWN_TOOL', message: 'The change tool is not available' };
  const schema = definition.inputSchema;
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.keys(args).some((key) => !Object.hasOwn(schema.properties, key)) ||
    schema.required.some((key) => !Object.hasOwn(args, key))
  )
    return {
      ok: false,
      code: 'INVALID_ARGUMENT',
      message: 'Tool arguments do not match the declared input fields',
    };
  const method = service?.[CHANGE_METHODS[name]];
  if (typeof method !== 'function')
    return {
      ok: false,
      code: 'CHANGE_SERVICE_UNAVAILABLE',
      message: 'A server-owned change service is required',
    };
  try {
    return await method.call(service, args, context);
  } catch {
    return {
      ok: false,
      code: 'CHANGE_TOOL_FAILED',
      message: 'The controlled change operation did not complete',
    };
  }
}
