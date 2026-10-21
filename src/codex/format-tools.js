const expectedVersion = {
  type: 'integer',
  minimum: 0,
  description: 'Current state version from sg_state.',
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

export const FORMAT_TOOLS = Object.freeze([
  definition(
    'sg_format_inspect',
    'Read the fixed formatting report and changed-file evidence without writing.',
    {},
    [],
    true,
  ),
  definition(
    'sg_format_run',
    'Run the server-owned Formatter in the dedicated clean worktree after tests pass, validate its scope, merge it, and enter Review.',
    { expectedVersion },
    ['expectedVersion'],
  ),
]);

export async function callFormatTool(service, name, args = {}) {
  if (name === 'sg_format_inspect') return service.inspect();
  if (name === 'sg_format_run') return service.run(args);
  return { ok: false, code: 'UNKNOWN_TOOL', message: 'Tool is not available' };
}
