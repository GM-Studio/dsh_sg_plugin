const expectedVersion = {
  type: 'integer',
  minimum: 0,
  description: 'Current state version; stale versions are rejected.',
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
export const REVIEW_TOOLS = Object.freeze([
  definition(
    'sg_review_inspect',
    'Read the hash-bound Review report, selected mode, risks, findings and H3 readiness without writing.',
    {},
    [],
    true,
  ),
  definition(
    'sg_review_prepare',
    'Align the dedicated review worktree, compute Review mode/risks/diff and return a read-only challenge for the Reviewer Agent.',
    {
      expectedVersion,
      mode: {
        type: 'string',
        enum: ['lenient', 'standard', 'strict'],
      },
    },
    ['expectedVersion'],
  ),
  definition(
    'sg_review_run',
    'Run a server-owned read-only Review Agent at the integration commit, enforce the lenient/standard/strict severity gate and enter H3 only on a complete visible pass.',
    {
      expectedVersion,
      mode: {
        type: 'string',
        enum: ['lenient', 'standard', 'strict'],
        description: 'Optional user override; otherwise selected from structured risk signals.',
      },
    },
    ['expectedVersion'],
  ),
  definition(
    'sg_review_request_h3',
    'Show the Review, tests and archive preview through the trusted native H3 approval channel, then consume H3 and enter ARCHIVING only when approved.',
    { expectedVersion },
    ['expectedVersion'],
  ),
]);

export async function callReviewTool(services, name, args = {}, { signal } = {}) {
  const { review } = services;
  if (name === 'sg_review_inspect') return review.inspect();
  if (name === 'sg_review_prepare') return review.prepare(args);
  if (name === 'sg_review_run') return review.run(args, { signal });
  if (name === 'sg_review_request_h3') return review.requestH3(args, { signal });
  return { ok: false, code: 'UNKNOWN_TOOL', message: 'Tool is not available' };
}
