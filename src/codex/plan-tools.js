const expectedVersion = {
  type: 'integer',
  minimum: 0,
  description: 'Current state version; stale versions are rejected.',
};
const reason = {
  type: 'string',
  minLength: 1,
  maxLength: 2048,
  description: 'Bounded reason for replacing previously frozen test assets.',
};
const content = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: true,
    },
    {
      type: 'string',
      minLength: 1,
      maxLength: 1024 * 1024,
    },
  ],
};
const artifact = {
  type: 'object',
  properties: {
    version: { type: 'integer', const: 1 },
    content,
  },
  required: ['version', 'content'],
  additionalProperties: false,
};
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

export const PLAN_TOOLS = Object.freeze([
  definition(
    'sg_plan_inspect',
    'Read the frozen requirements, dynamic task graph, contract, model and executable test hashes without writing.',
    {},
    [],
    true,
  ),
  definition(
    'sg_plan_generate',
    'Generate a dynamic AC task graph from frozen requirements and enter planning. Requires a consumed H1 approval and intact P4 snapshot.',
    {
      expectedVersion,
      filePolicies: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            allowedFiles: { type: 'array', items: { type: 'string' }, minItems: 1 },
            forbiddenFiles: { type: 'array', items: { type: 'string' } },
          },
          required: ['allowedFiles', 'forbiddenFiles'],
          additionalProperties: false,
        },
      },
    },
    ['expectedVersion'],
  ),
  definition(
    'sg_plan_freeze_contracts',
    'Freeze the versioned API contract and data model before test design or serial development.',
    { expectedVersion, contract: artifact, model: artifact },
    ['expectedVersion', 'contract', 'model'],
  ),
  definition(
    'sg_plan_freeze_tests',
    'Ask the server-owned Test role for executable cases and fixtures, freeze their hashes and enter TEST_CASES_FROZEN.',
    { expectedVersion },
    ['expectedVersion'],
  ),
  definition(
    'sg_test_design_prepare',
    'Create the dedicated test-design worktree, assign the complete challenge to the real Codex Test Designer, run it through non-interactive exec when configured, and require a commit before freeze.',
    { expectedVersion },
    ['expectedVersion'],
  ),
  definition(
    'sg_test_design_freeze',
    'Read the clean committed test-design worktree, validate every file and AC mapping, then freeze immutable executable tests.',
    { expectedVersion },
    ['expectedVersion'],
  ),
  definition(
    'sg_test_replace_assets',
    'Request trusted H1 reopening before replacing frozen tests. Preserves old hashes and returns to test design; refreeze and a new real red baseline are mandatory.',
    { expectedVersion, reason },
    ['expectedVersion', 'reason'],
  ),
  definition(
    'sg_development_inspect',
    'Inspect the five fixed worktrees, red baseline evidence, role commits and integration state without writing.',
    {},
    [],
    true,
  ),
  definition(
    'sg_development_prepare',
    'Run the server-owned Test red baseline, create frontend, backend, integration, test and review worktrees from one freeze commit, and enter DEVELOPMENT.',
    { expectedVersion },
    ['expectedVersion'],
  ),
  definition(
    'sg_development_run',
    'Assign and run the real frontend and backend Codex role agents serially, enforce their boundaries, merge their exact commits through integration, and return conflicts to the owning role.',
    { expectedVersion },
    ['expectedVersion'],
  ),
  definition(
    'sg_development_rework',
    'Return blocking Review findings to new round-specific frontend/backend/format worktrees and restart development.',
    { expectedVersion },
    ['expectedVersion'],
  ),
  definition(
    'sg_development_repair',
    'Return failed quality defects to new round-specific frontend/backend/format worktrees and restart development.',
    { expectedVersion },
    ['expectedVersion'],
  ),
]);

export async function callPlanTool(services, name, args = {}, { signal } = {}) {
  const { plans, development } = services;
  switch (name) {
    case 'sg_plan_inspect':
      return plans.inspect();
    case 'sg_plan_generate':
      return plans.generate(args);
    case 'sg_plan_freeze_contracts':
      return plans.freezeContracts(args);
    case 'sg_plan_freeze_tests':
      return plans.freezeTests(args);
    case 'sg_test_design_prepare':
      return plans.testDesignPrepare(args);
    case 'sg_test_design_freeze':
      return plans.testDesignFreeze(args);
    case 'sg_test_replace_assets':
      return plans.reopenTests(args);
    case 'sg_development_inspect':
      return development.inspect();
    case 'sg_development_prepare':
      return development.prepare(args, { signal });
    case 'sg_development_run':
      return development.run(args, { signal });
    case 'sg_development_rework':
      return development.prepareRework(args);
    case 'sg_development_repair':
      return development.prepareRepair(args);
    default:
      return {
        ok: false,
        code: 'UNKNOWN_TOOL',
        message: 'Tool is not available',
      };
  }
}
