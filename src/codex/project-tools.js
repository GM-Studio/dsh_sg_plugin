import { getAdoptionBaselineRun, startAdoptionBaseline } from './baseline.js';
import { getBaselineJob, startBaselineJob } from './baseline-job.js';
import { createArtifactStore } from './core/artifact-store.js';
import { applyAdoption, commitDirtyBaseline, previewAdoption } from './project-adopt.js';
import { detectProject } from './project-detect.js';
import { loadProjectReadiness } from './project-state.js';
import { recordNewProjectBaseline } from './project-new.js';

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

const previewHash = {
  type: 'string',
  minLength: 64,
  maxLength: 64,
  pattern: '^[a-f0-9]{64}$',
};

export const PROJECT_TOOLS = Object.freeze([
  definition(
    'sg_project_status',
    'Read project readiness, profile, baseline and detection without writing.',
    {},
    [],
    true,
  ),
  definition(
    'sg_adopt_preview',
    'Inspect an existing Java/Vue project and return a read-only adoption preview, dirty-file plan and preview hash.',
    {},
    [],
    true,
  ),
  definition(
    'sg_adopt_commit_dirty',
    'Create a baseline commit for exactly the approved dirty files after a bound native approval.',
    {
      previewHash,
      paths: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 1024 },
        minItems: 1,
        maxItems: 1000,
      },
      message: { type: 'string', minLength: 1, maxLength: 512 },
    },
    ['previewHash', 'paths', 'message'],
  ),
  definition(
    'sg_adopt_apply',
    'Start the confirmed adopted baseline. Poll sg_project_status until baselineRun completes or fails.',
    { previewHash },
    ['previewHash'],
  ),
  definition(
    'sg_project_finalize_new',
    'Persist a new-project profile and green baseline only when current complete verification evidence exists.',
    {},
    [],
  ),
]);

const valid = (schema, value) => {
  if (schema.type === 'object') {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (schema.required || []).every((key) => Object.hasOwn(value, key)) &&
      Object.entries(value).every(([key, entry]) => {
        if (!Object.hasOwn(schema.properties || {}, key)) return false;
        const child = schema.properties[key];
        if (child.type === 'string')
          return (
            typeof entry === 'string' &&
            entry.length >= (child.minLength || 0) &&
            entry.length <= (child.maxLength ?? 32768) &&
            (!child.pattern || new RegExp(child.pattern).test(entry))
          );
        if (child.type === 'array')
          return (
            Array.isArray(entry) &&
            entry.length >= (child.minItems || 0) &&
            entry.length <= (child.maxItems ?? 200) &&
            entry.every(
              (item) =>
                typeof item === 'string' &&
                item.length >= (child.items.minLength || 0) &&
                item.length <= (child.items.maxLength ?? 32768),
            )
          );
        return false;
      })
    );
  }
  return false;
};

export async function callProjectTool(services, name, args = {}, { signal } = {}) {
  const tool = PROJECT_TOOLS.find((entry) => entry.name === name);
  if (!tool) return { ok: false, code: 'UNKNOWN_TOOL', message: 'Project tool is unavailable' };
  if (!valid(tool.inputSchema, args))
    return { ok: false, code: 'INVALID_ARGUMENT', message: 'Project tool arguments are invalid' };
  const root = services?.projectRoot;
  if (name === 'sg_project_status') {
    const readiness = loadProjectReadiness({ projectRoot: root });
    if (readiness.ok)
      return {
        ok: true,
        projectReady: true,
        profile: readiness.profile,
        baseline: readiness.baseline,
        baselineRun: getAdoptionBaselineRun(root) || getBaselineJob(root),
      };
    const detected = detectProject({ root });
    return {
      ok: true,
      projectReady: false,
      readiness: readiness.code || readiness.message,
      baselineRun: getAdoptionBaselineRun(root) || getBaselineJob(root),
      detection: detected.ok
        ? { stack: detected.stack, git: detected.git, commands: detected.commands }
        : { code: detected.code, message: detected.message },
    };
  }
  if (name === 'sg_adopt_preview') return previewAdoption({ projectRoot: root });
  if (name === 'sg_adopt_commit_dirty')
    return commitDirtyBaseline(
      {
        projectRoot: root,
        previewHash: args.previewHash,
        paths: args.paths,
        message: args.message,
      },
      { approvalProvider: services?.dirtyApprovalProvider, signal },
    );
  if (name === 'sg_adopt_apply') {
    const preview = previewAdoption({ projectRoot: root });
    if (!preview.ok) return preview;
    if (preview.previewHash !== args.previewHash)
      return {
        ok: false,
        code: 'ADOPTION_PREVIEW_STALE',
        message: 'The project changed after adoption preview',
      };
    if (!services?.baselineRunner) return startBaselineJob({ projectRoot: root, preview });
    return startAdoptionBaseline({
      preview,
      runner: services.baselineRunner,
      persist: (baseline) =>
        applyAdoption({
          projectRoot: root,
          previewHash: args.previewHash,
          baseline,
        }),
      record: (baselineRun, run) => {
        const store = createArtifactStore({ projectRoot: root });
        return store.writeJson(`.specgate/codex/baseline-runs/${run.runId}/summary.json`, {
          schemaVersion: 1,
          runId: run.runId,
          previewHash: args.previewHash,
          projectId: preview.profile.projectId,
          commit: preview.git.commit,
          baseline: baselineRun.baseline,
          commands: baselineRun.results.map(({ command, result }) => ({
            id: command.id,
            kind: command.kind,
            cwd: command.cwd,
            argv: command.argv,
            status: result.status,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stdout: result.stdout,
            stderr: result.stderr,
          })),
        });
      },
    });
  }
  if (name === 'sg_project_finalize_new') {
    const verifier = services?.newProjectVerifier;
    if (typeof verifier !== 'function')
      return {
        ok: false,
        code: 'VERIFICATION_EVIDENCE_INVALID',
        message: 'A server-owned verification evidence provider is required',
      };
    const verification = await verifier({ root, projectRoot: root });
    if (!verification?.ok) return verification;
    return recordNewProjectBaseline({ projectRoot: root, verification });
  }
  return { ok: false, code: 'UNKNOWN_TOOL', message: 'Project tool is unavailable' };
}
