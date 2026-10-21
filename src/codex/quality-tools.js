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

export const QUALITY_TOOLS = Object.freeze([
  definition(
    'sg_quality_inspect',
    'Read the latest hash-bound quality report, frozen case results, aggregate coverage and changed-line coverage without writing.',
    {},
    [],
    true,
  ),
  definition(
    'sg_quality_run',
    'Align the Test worktree to integration, run server-owned frozen tests and real Java/Vue verification, enforce coverage and P0/P1 gates, then enter Review only on complete evidence.',
    { expectedVersion },
    ['expectedVersion'],
  ),
]);

export async function callQualityTool(service, name, args = {}, { signal } = {}) {
  if (name === 'sg_quality_inspect') return service.inspect();
  if (name === 'sg_quality_run') return service.run(args, { signal });
  return { ok: false, code: 'UNKNOWN_TOOL', message: 'Tool is not available' };
}
