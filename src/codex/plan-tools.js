const expectedVersion = {
  type: 'integer',
  minimum: 0,
  description: 'Current state version; stale versions are rejected.',
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
    { expectedVersion },
    ['expectedVersion'],
  ),
  definition(
    'sg_plan_freeze_contracts',
    'Freeze the versioned API contract and data model before test design or parallel development.',
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
    'Run frontend and backend role providers concurrently, enforce their boundaries, merge their exact commits through integration, and return conflicts to the owning role.',
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
    case 'sg_development_inspect':
      return development.inspect();
    case 'sg_development_prepare':
      return development.prepare(args, { signal });
    case 'sg_development_run':
      return development.run(args, { signal });
    default:
      return {
        ok: false,
        code: 'UNKNOWN_TOOL',
        message: 'Tool is not available',
      };
  }
}
