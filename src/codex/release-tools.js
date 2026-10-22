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
    destructiveHint: name === 'sg_release_archive',
    idempotentHint: readOnly,
    openWorldHint: name === 'sg_release_archive',
  },
});

export const RELEASE_TOOLS = Object.freeze([
  definition(
    'sg_release_preview',
    'Read the target branch, remote, exact integration commit, changed files, tests, Review result, pending commits and untracked files. Read-only.',
    {},
    [],
    true,
  ),
  definition(
    'sg_release_archive',
    'After a consumed H3 approval, merge the exact integration commit and archive evidence. Push without force only when push=true and a remote URL is configured.',
    {
      expectedVersion,
      push: {
        type: 'boolean',
        description: 'Explicitly request a non-force push after H3 and archive; defaults to false.',
      },
    },
    ['expectedVersion'],
  ),
]);

export async function callReleaseTool(service, name, args = {}) {
  if (name === 'sg_release_preview') return service.preview();
  if (name === 'sg_release_archive') return service.run(args);
  return { ok: false, code: 'UNKNOWN_TOOL', message: 'Tool is not available' };
}
