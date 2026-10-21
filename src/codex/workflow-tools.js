import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOOLS as DIAGNOSTICS, callDiagnostic } from './tools.js';
import { createStateStore } from './state-machine.js';
import { createApprovalAuthority } from './approvals.js';
import { previewInit, executeInit } from './init.js';
import { JAVA_PRESETS } from '../v4/java-versions.js';
import { CHANGE_TOOLS, CHANGE_METHODS, callChangeTool } from './change-tools.js';
import { createChangeAddService } from './change-add.js';
import { createDevelopmentService, createPrecompletedRoleProvider } from './development.js';
import { createPlanService } from './plan.js';
import { PLAN_TOOLS, callPlanTool } from './plan-tools.js';
import { createQualityService } from './quality.js';
import { QUALITY_TOOLS, callQualityTool } from './quality-tools.js';
import { createReviewService } from './review.js';
import { REVIEW_TOOLS, callReviewTool } from './review-tools.js';
import { createReleaseService } from './release.js';
import { RELEASE_TOOLS, callReleaseTool } from './release-tools.js';
import { createPeerUserInputProvider } from './host-input.js';
import { createFormatService, createNativeFormatter } from './format.js';
import { FORMAT_TOOLS, callFormatTool } from './format-tools.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const NATIVE_RUNNER_ADAPTER = fileURLToPath(new URL('./native-test-runner.mjs', import.meta.url));
const version = {
  type: 'integer',
  minimum: 0,
  description: 'Current state version read from sg_state; stale versions are rejected.',
};
const target = {
  type: 'string',
  minLength: 1,
  maxLength: 32768,
  description: 'Project path; defaults to the host-bound project directory.',
};
const preset = {
  type: 'string',
  enum: JAVA_PRESETS.map((entry) => entry.id),
  description: 'Java/Vue preset; defaults to jdk8-boot2.7 (legacy).',
};
const reason = {
  type: 'string',
  maxLength: 2048,
  description: 'User-provided reason retained with the event.',
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

export function nativeTestRunnerSpec({ mode, worktree, testsDirectory, reportPath }) {
  const testRoot = path.join(testsDirectory, 'specgate-tests');
  const runner = path.join(testRoot, 'runner.mjs');
  return {
    command: process.execPath,
    args: [
      NATIVE_RUNNER_ADAPTER,
      runner,
      '--mode',
      mode,
      '--root',
      worktree,
      '--tests',
      testRoot,
      '--snapshot',
      testsDirectory,
      '--report',
      path.join(worktree, reportPath),
    ],
    cwd: worktree,
    reportPath,
    adapter: NATIVE_RUNNER_ADAPTER,
    runner,
    testRoot,
  };
}

const WORKFLOW_TOOLS = [
  definition(
    'sg_state',
    'Read and validate the authoritative Codex state and audit chain without writing or recovering files.',
    {},
    [],
    true,
  ),
  definition(
    'sg_pause',
    'Pause the active change at its stable checkpoint. Preserve worktrees, branches and evidence.',
    { expectedVersion: version },
    ['expectedVersion'],
  ),
  definition(
    'sg_resume',
    'Resume a paused or blocked change from its recorded stable checkpoint; never retry a failed push.',
    { expectedVersion: version },
    ['expectedVersion'],
  ),
  definition(
    'sg_cancel',
    'Cancel the active change while retaining all worktrees, branches and evidence.',
    { expectedVersion: version, reason },
    ['expectedVersion'],
  ),
  definition(
    'sg_init_preview',
    'Scan a Java/Vue initialization target without writing. Return conflicts, retained files, Git status and the preview hash.',
    { path: target, preset },
    [],
    true,
  ),
  definition(
    'sg_init',
    'Generate a Java/Vue project from the current preview hash and establish its local Git baseline. Does not build or verify. Nonempty targets require a trusted server approval provider.',
    {
      path: target,
      preset,
      previewHash: {
        type: 'string',
        pattern: '^[a-f0-9]{64}$',
        description: 'Unchanged previewHash returned by sg_init_preview.',
      },
    },
    ['previewHash'],
  ),
  {
    ...definition(
      'sg_verify',
      'Run real Java/Vue dependency, build, test, lint, format, coverage and HTTP checks. Reuse installed toolchains; SDK auto-download is disabled. Preserve failed and not-run evidence.',
      {
        path: target,
        javaHome: {
          type: 'string',
          minLength: 1,
          maxLength: 32768,
          description: 'Optional absolute path to an existing JDK installation.',
        },
        mavenHome: {
          type: 'string',
          minLength: 1,
          maxLength: 32768,
          description: 'Optional absolute path to an existing Maven installation.',
        },
        timeoutMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 1800000,
          description: 'Maximum time per quality command in milliseconds.',
        },
      },
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];

export function validArguments(schema, value) {
  if (schema.oneOf && schema.oneOf.filter((option) => validArguments(option, value)).length !== 1)
    return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (Object.hasOwn(schema, 'const') && schema.const !== value) return false;
  if (
    schema.required &&
    (!object(value) || schema.required.some((key) => !Object.hasOwn(value, key)))
  )
    return false;
  switch (schema.type) {
    case 'object': {
      if (!object(value)) return false;
      const properties = schema.properties || {};
      return Object.entries(value).every(([key, item]) =>
        Object.hasOwn(properties, key)
          ? validArguments(properties[key], item)
          : schema.additionalProperties !== false,
      );
    }
    case 'array':
      return (
        Array.isArray(value) &&
        value.length >= (schema.minItems || 0) &&
        value.length <= (schema.maxItems ?? Infinity) &&
        (!schema.items || value.every((item) => validArguments(schema.items, item)))
      );
    case 'integer':
      return (
        Number.isSafeInteger(value) &&
        value >= (schema.minimum ?? Number.MIN_SAFE_INTEGER) &&
        value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER)
      );
    case 'string':
      return (
        typeof value === 'string' &&
        value.length >= (schema.minLength || 0) &&
        value.length <= (schema.maxLength ?? 32768) &&
        (!schema.pattern || new RegExp(schema.pattern).test(value))
      );
    case 'boolean':
      return typeof value === 'boolean';
    case undefined:
      return true;
    default:
      return false;
  }
}

const result = (data) => ({
  isError: data.ok === false,
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});

export function createToolRegistry({
  projectRoot,
  requestPeer,
  peerCapabilities,
  initializationApprovalProvider,
  planRoleProvider,
  developmentRoleProvider,
  redRunner,
  qualityTestRunner,
  qualityVerifier,
  qualityTimeoutMs,
  reviewRoleProvider,
  trustedUserIdentity,
  nativeAgents = false,
  formatter,
} = {}) {
  const root = path.resolve(projectRoot);
  const effectiveDevelopmentRoleProvider =
    developmentRoleProvider || (nativeAgents ? createPrecompletedRoleProvider() : undefined);
  const effectiveRedRunner =
    redRunner ||
    (nativeAgents
      ? async () => {
          const checked = await plans().inspect();
          if (!checked.ok) throw Object.assign(new Error(checked.message), { code: checked.code });
          const testsDirectory = path.join(root, checked.ref.tests.directory);
          const reportPath = '.specgate/codex/native-red-report.json';
          const specification = nativeTestRunnerSpec({
            mode: 'red',
            worktree: root,
            testsDirectory,
            reportPath,
          });
          if (!fs.existsSync(specification.runner))
            throw Object.assign(new Error('Frozen native runner is unavailable'), {
              code: 'RED_RUNNER_UNAVAILABLE',
            });
          return specification;
        }
      : undefined);
  const effectiveQualityTestRunner =
    qualityTestRunner ||
    (nativeAgents
      ? async ({ worktree }) => {
          const checked = await plans().inspect();
          if (!checked.ok) throw Object.assign(new Error(checked.message), { code: checked.code });
          const testsDirectory = path.join(root, checked.ref.tests.directory);
          const reportPath = '.specgate/codex/native-green-report.json';
          const specification = nativeTestRunnerSpec({
            mode: 'green',
            worktree,
            testsDirectory,
            reportPath,
          });
          if (!fs.existsSync(specification.runner))
            throw Object.assign(new Error('Frozen native runner is unavailable'), {
              code: 'TEST_RUNNER_UNAVAILABLE',
            });
          return specification;
        }
      : undefined);
  const effectiveFormatter = formatter || (nativeAgents ? createNativeFormatter() : undefined);
  let store;
  const stateStore = () =>
    (store ||= createStateStore({ projectRoot: root, authorizeGate: authority.authorizeGate }));
  // No clientInfo, environment variable, tool flag or elicitation capability can
  // manufacture a trusted user identity. Gate integration stays unavailable.
  const authority = createApprovalAuthority({
    request: requestPeer,
    trustedPeerIdentity: trustedUserIdentity,
    resolveGateArtifact: ({ gate, state }) => ({
      scope: state?.changeId,
      artifactHash:
        gate === 'H1'
          ? state?.context?.artifacts?.requirements?.hash
          : state?.context?.artifacts?.h3?.hash,
    }),
    audit: async (event) => {
      const loaded = await stateStore().load();
      if (!loaded.ok) throw new Error('Cannot load approval audit state');
      const appended = await stateStore().recordEvent({
        expectedVersion: loaded.state.version,
        type: event.type,
        payload: event,
      });
      if (!appended.ok) throw new Error('Cannot persist approval audit');
    },
  });
  const effectiveInitializationApproval =
    initializationApprovalProvider || (trustedUserIdentity ? authority : undefined);
  let changeService;
  const changes = () =>
    (changeService ||= createChangeAddService({
      projectRoot: root,
      store: stateStore(),
      approvalAuthority: authority,
      userInputProvider: createPeerUserInputProvider({
        requestPeer,
        peerCapabilities,
        trustedUserIdentity,
      }),
    }));
  let planService;
  const plans = () =>
    (planService ||= createPlanService({
      projectRoot: root,
      store: stateStore(),
      roleProvider: planRoleProvider,
    }));
  let developmentService;
  const development = () =>
    (developmentService ||= createDevelopmentService({
      projectRoot: root,
      store: stateStore(),
      planService: plans(),
      roleProvider: effectiveDevelopmentRoleProvider,
      redRunner: effectiveRedRunner,
    }));
  let qualityService;
  const quality = () =>
    (qualityService ||= createQualityService({
      projectRoot: root,
      store: stateStore(),
      planService: plans(),
      testRunner: effectiveQualityTestRunner,
      verifier: qualityVerifier,
      timeoutMs: qualityTimeoutMs,
    }));
  let reviewService;
  const review = () =>
    (reviewService ||= createReviewService({
      projectRoot: root,
      store: stateStore(),
      planService: plans(),
      roleProvider: reviewRoleProvider,
      approvalAuthority: authority,
    }));
  let releaseService;
  const release = () =>
    (releaseService ||= createReleaseService({
      projectRoot: root,
      store: stateStore(),
      planService: plans(),
    }));
  let formatService;
  const formatting = () =>
    (formatService ||= createFormatService({
      projectRoot: root,
      store: stateStore(),
      planService: plans(),
      formatter: effectiveFormatter,
    }));
  const definitions = [
    ...DIAGNOSTICS,
    ...WORKFLOW_TOOLS,
    ...CHANGE_TOOLS,
    ...PLAN_TOOLS,
    ...QUALITY_TOOLS,
    ...FORMAT_TOOLS,
    ...REVIEW_TOOLS,
    ...RELEASE_TOOLS,
  ];
  return {
    definitions,
    validate(name, args) {
      const tool = definitions.find((entry) => entry.name === name);
      return Boolean(tool && validArguments(tool.inputSchema, args));
    },
    async call(name, args = {}, { signal } = {}) {
      const tool = definitions.find((entry) => entry.name === name);
      if (!tool)
        return result({ ok: false, code: 'UNKNOWN_TOOL', message: 'Tool is not available' });
      if (!validArguments(tool.inputSchema, args))
        return result({
          ok: false,
          code: 'INVALID_ARGUMENT',
          message: 'Tool arguments do not match the declared schema',
        });
      try {
        if (signal?.aborted && !tool.annotations.readOnlyHint)
          return result({
            ok: false,
            code: 'CANCELLED',
            message: 'Operation cancelled before execution',
          });
        if (DIAGNOSTICS.some((entry) => entry.name === name)) {
          const diagnostic = callDiagnostic(name, {
            projectRoot: root,
            protocolVersion: '2025-06-18',
          });
          const data = diagnostic.structuredContent;
          data.stage = 'P1';
          if (name === 'status') {
            const inspected = await stateStore().inspect();
            data.workflow = { status: 'kernel-only', ...inspected };
            const available = authority.availability();
            data.trustedApproval = {
              status: available.available ? 'available' : 'unavailable',
              reason: available.reason,
              elicitationSupported: peerCapabilities?.().elicitationSupported === true,
            };
            data.initialization = {
              status: 'generation-available',
              nonemptyApproval: 'unavailable',
              existingGitExecution: 'unsupported',
            };
            data.planning = {
              status: 'available',
              testRole:
                typeof planRoleProvider === 'function'
                  ? 'server-provider'
                  : nativeAgents
                    ? 'native-subagent'
                    : 'unavailable',
            };
            data.development = {
              status:
                typeof effectiveRedRunner === 'function' &&
                typeof effectiveDevelopmentRoleProvider === 'function'
                  ? 'available'
                  : 'unavailable',
              redRunner: typeof effectiveRedRunner === 'function' ? 'available' : 'unavailable',
              roleProvider:
                typeof effectiveDevelopmentRoleProvider === 'function'
                  ? 'available'
                  : 'unavailable',
              fixedWorktrees: ['frontend', 'backend', 'integration', 'test', 'review', 'format'],
            };
            data.quality = {
              status:
                typeof effectiveQualityTestRunner === 'function' ? 'available' : 'unavailable',
              testRunner:
                typeof effectiveQualityTestRunner === 'function' ? 'available' : 'unavailable',
              verifier: typeof qualityVerifier === 'function' ? 'custom' : 'verifyProject',
            };
            data.formatting = {
              status: typeof effectiveFormatter === 'function' ? 'available' : 'unavailable',
              worktree: 'dedicated',
              requiredAfterTests: true,
            };
            data.review = {
              status:
                typeof reviewRoleProvider === 'function' || nativeAgents
                  ? 'available'
                  : 'unavailable',
              reviewAgent:
                typeof reviewRoleProvider === 'function'
                  ? 'server-provider'
                  : nativeAgents
                    ? 'native-report'
                    : 'unavailable',
              h3Approval: available.available ? 'available' : 'unavailable',
            };
            data.release = {
              status: 'available',
              forcePush: 'forbidden',
            };
            if (fs.existsSync(path.join(root, '.specgate/codex-verify-report.json'))) {
              const { validateVerificationEvidence } = await import('./verify.js');
              const verified = validateVerificationEvidence({ root });
              data.verification = {
                status: verified.ok ? 'passed' : 'failed',
                runId: verified.runId || null,
                code: verified.code || null,
                report: verified.reportPath || '.specgate/codex-verify-report.json',
              };
            }
            if (!inspected.ok) data.ok = false;
          }
          return result(data);
        }
        if (Object.hasOwn(CHANGE_METHODS, name))
          return result(await callChangeTool(changes(), name, args, { signal }));
        if (PLAN_TOOLS.some((entry) => entry.name === name))
          return result(
            await callPlanTool({ plans: plans(), development: development() }, name, args, {
              signal,
            }),
          );
        if (name === 'sg_state') return result(await stateStore().inspect());
        if (name === 'sg_pause') return result(await stateStore().pause(args));
        if (name === 'sg_resume') return result(await stateStore().resume(args));
        if (name === 'sg_cancel') return result(await stateStore().cancel(args));
        if (QUALITY_TOOLS.some((entry) => entry.name === name))
          return result(await callQualityTool(quality(), name, args, { signal }));
        if (FORMAT_TOOLS.some((entry) => entry.name === name))
          return result(await callFormatTool(formatting(), name, args));
        if (REVIEW_TOOLS.some((entry) => entry.name === name))
          return result(await callReviewTool({ review: review() }, name, args, { signal }));
        if (RELEASE_TOOLS.some((entry) => entry.name === name))
          return result(await callReleaseTool(release(), name, args));
        const input = { root: path.resolve(root, args.path || '.'), preset: args.preset };
        if (name === 'sg_verify') {
          const { verifyProject } = await import('./verify.js');
          return result(
            await verifyProject(
              {
                root: input.root,
                ...(args.javaHome ? { javaHome: args.javaHome } : {}),
                ...(args.mavenHome ? { mavenHome: args.mavenHome } : {}),
                ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
              },
              { signal },
            ),
          );
        }
        if (name === 'sg_init_preview') return result(previewInit(input));
        if (name === 'sg_init')
          return result(
            await executeInit(
              { ...input, previewHash: args.previewHash },
              { approvalProvider: effectiveInitializationApproval, signal },
            ),
          );
        return result({ ok: false, code: 'UNKNOWN_TOOL', message: 'Tool is not available' });
      } catch {
        return result({
          ok: false,
          code: 'TOOL_FAILED',
          message: 'The operation failed; no success was recorded',
        });
      }
    },
  };
}
