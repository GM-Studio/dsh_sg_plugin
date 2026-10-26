import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TOOLS as DIAGNOSTICS, callDiagnostic } from './tools.js';
import { createStateStore, publicWorkflowView } from './state-machine.js';
import { createApprovalAuthority } from './approvals.js';
import { createArtifactStore } from './core/artifact-store.js';
import { canonicalJson, hashValue } from './events.js';
import { JAVA_PRESETS } from './core/java/java-versions.js';
import { CHANGE_TOOLS, CHANGE_METHODS, callChangeTool } from './change-tools.js';
import { createChangeAddService } from './change-add.js';
import { createDevelopmentService } from './development.js';
import { createNativeCodexRoleProvider } from './native-role-agent.js';
import { createPlanService } from './plan.js';
import { PLAN_TOOLS, callPlanTool } from './plan-tools.js';
import { createQualityService } from './quality.js';
import { QUALITY_TOOLS, callQualityTool } from './quality-tools.js';
import { createReviewService } from './review.js';
import { REVIEW_TOOLS, callReviewTool } from './review-tools.js';
import { createReleaseService } from './release.js';
import { RELEASE_TOOLS, callReleaseTool } from './release-tools.js';
import { PROJECT_TOOLS, callProjectTool } from './project-tools.js';
import { createPeerUserInputProvider } from './host-input.js';
import { createFormatService, createNativeFormatter } from './format.js';
import { FORMAT_TOOLS, callFormatTool } from './format-tools.js';
import { CONTROL_TOOLS } from './core/optional-tool-definitions.js';
import { TOOL_DESCRIPTIONS } from './locale.js';
import { ENVIRONMENT_TOOLS, environmentConsent } from './environment-tools.js';
import { createEnvironmentService } from './core/environment.js';
import { insideSpecGateSource } from './core/project-path.js';
import { inspectProjectStatus } from './project-status.js';
import { ONBOARDING_TOOLS } from './core/onboarding-tool-definitions.js';
import { bindProject } from './core/project-binding.js';
import { prepareFrozenExecution } from './core/frozen-execution.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const OPTIONAL_TOOL_NAMES = new Set([
  'sg_init_preview',
  'sg_init',
  'sg_verify',
  'sg_project_verify',
  'sg_project_finalize_new',
  'sg_project_setup',
  'sg_project_create',
  'sg_env_prepare',
  ...CONTROL_TOOLS.map((entry) => entry.name),
]);
const NATIVE_RUNNER_ADAPTER = fileURLToPath(new URL('./native-test-runner.mjs', import.meta.url));
export const NATIVE_RED_REPORT_PATH = '.specgate/codex/runs/native-red-report.json';
export const NATIVE_GREEN_REPORT_PATH = '.specgate/codex/runs/native-green-report.json';
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
  description: '用户明确选择的 JDK / Spring Boot 技术栈；不得静默默认。',
};
const frontend = {
  type: 'string',
  enum: ['vue', 'react'],
  description: '用户明确选择的前端框架：Vue 3 或 React 18。',
};
const javaPackageSegment = {
  type: 'string',
  minLength: 2,
  maxLength: 63,
  pattern: '^[a-z][a-z0-9]{1,62}$',
  description:
    'Lowercase company or business package segment used to build com.<company>.<business>.',
};
const reason = {
  type: 'string',
  maxLength: 2048,
  description: 'User-provided reason retained with the event.',
};
const gitName = {
  type: 'string',
  minLength: 1,
  maxLength: 256,
  description: '用户指定的 Git 用户名；省略时复用 Git 环境/配置。',
};
const gitEmail = {
  type: 'string',
  minLength: 3,
  maxLength: 256,
  description: '用户指定的 Git 邮箱；缺失身份时必须先向用户采集。',
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

export function nativeTestRunnerSpec({
  mode,
  worktree,
  testsDirectory,
  reportPath,
  projectRoot,
  manifestPath,
  testsHash,
  platform = process.platform,
  temporaryRoot,
}) {
  const frozenExecution = prepareFrozenExecution({
    projectRoot,
    testsDirectory,
    manifestPath,
    testsHash,
    platform,
    temporaryRoot,
  });
  const testRoot = path.join(frozenExecution.directory, 'specgate-tests');
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
      frozenExecution.directory,
      '--report',
      path.join(worktree, reportPath),
    ],
    cwd: worktree,
    reportPath,
    adapter: NATIVE_RUNNER_ADAPTER,
    runner,
    testRoot,
    frozenExecution,
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
    'Scan a Java/Vue initialization target without writing. Return conflicts, retained files, namespace, Git status and the preview hash.',
    {
      path: target,
      preset,
      frontend,
      company: javaPackageSegment,
      business: javaPackageSegment,
      gitName,
      gitEmail,
    },
    ['company', 'business', 'preset', 'frontend'],
    true,
  ),
  definition(
    'sg_init',
    'Generate a Java/Vue project from the current preview hash and establish its local Git baseline. Does not build or verify. Nonempty targets require a trusted server approval provider.',
    {
      path: target,
      preset,
      frontend,
      company: javaPackageSegment,
      business: javaPackageSegment,
      gitName,
      gitEmail,
      previewHash: {
        type: 'string',
        pattern: '^[a-f0-9]{64}$',
        description: 'Unchanged previewHash returned by sg_init_preview.',
      },
    },
    ['previewHash', 'company', 'business', 'preset', 'frontend'],
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
  {
    ...definition(
      'sg_project_verify',
      'Project-scoped alias of sg_verify. Run real Java/frontend checks and write the same server-owned verification evidence before finalizing a new-project baseline.',
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

const result = (input) => {
  const data = publicWorkflowView(input);
  return {
    isError: data.ok === false,
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
};

function createBoundToolRegistry({
  projectRoot,
  requestPeer,
  peerCapabilities,
  initializationApprovalProvider,
  planRoleProvider,
  developmentRoleProvider,
  nativeRoleProvider,
  testDesignerRunner,
  redRunner,
  qualityTestRunner,
  qualityVerifier,
  qualityTimeoutMs,
  reviewRoleProvider,
  trustedUserIdentity,
  nativeAgents = false,
  formatter,
  baselineRunner,
  newProjectVerifier,
  dirtyApprovalProvider,
  controlService,
  environmentGate,
  optionalModules = false,
} = {}) {
  const root = path.resolve(projectRoot);
  const effectiveNativeRoleProvider =
    nativeRoleProvider ||
    (nativeAgents ? createNativeCodexRoleProvider({ projectRoot: root }) : undefined);
  const effectiveDevelopmentRoleProvider = developmentRoleProvider || effectiveNativeRoleProvider;
  const effectiveReviewRoleProvider = reviewRoleProvider || effectiveNativeRoleProvider;
  const effectiveTestDesignerRunner = testDesignerRunner || effectiveNativeRoleProvider;
  const effectiveRedRunner =
    redRunner ||
    (nativeAgents
      ? async () => {
          const checked = await plans().inspect();
          if (!checked.ok) throw Object.assign(new Error(checked.message), { code: checked.code });
          const testsDirectory = path.join(root, checked.ref.tests.directory);
          const reportPath = NATIVE_RED_REPORT_PATH;
          const specification = nativeTestRunnerSpec({
            mode: 'red',
            worktree: root,
            testsDirectory,
            reportPath,
            projectRoot: root,
            manifestPath: path.join(root, checked.ref.tests.path),
            testsHash: checked.ref.tests.hash,
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
          const reportPath = NATIVE_GREEN_REPORT_PATH;
          const specification = nativeTestRunnerSpec({
            mode: 'green',
            worktree,
            testsDirectory,
            reportPath,
            projectRoot: root,
            manifestPath: path.join(root, checked.ref.tests.path),
            testsHash: checked.ref.tests.hash,
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
  const controlWorkItemId =
    optionalModules && process.env.SPECGATE_CONTROL_MODE === '1'
      ? process.env.SPECGATE_WORK_ITEM_ID
      : null;
  let controlAuthority;
  const optionalAuthority = async () => {
    if (controlAuthority) return controlAuthority;
    const [{ createControlApprovalAuthority }, { createLocalControlRuntime }] = await Promise.all([
      import('./control/approval-bridge.js'),
      import('./control/runtime.js'),
    ]);
    controlAuthority = createControlApprovalAuthority({
      service: controlService || createLocalControlRuntime({ env: process.env }).service,
      workItemId: controlWorkItemId,
    });
    return controlAuthority;
  };
  // Native approvals remain the default. In control mode, H1/H3 can only be
  // authorized by a previously consumed, step-up control Decision.
  const authority = controlWorkItemId
    ? {
        availability: () => ({
          available: true,
          source: 'control-store',
          workItemId: controlWorkItemId,
        }),
        requestApproval: async (...args) => (await optionalAuthority()).requestApproval(...args),
        consumeApproval: async (...args) => (await optionalAuthority()).consumeApproval(...args),
        authorizeGate: async (...args) => (await optionalAuthority()).authorizeGate(...args),
      }
    : createApprovalAuthority({
        request: requestPeer,
        trustedPeerIdentity: trustedUserIdentity,
        resolveGateArtifact: ({ gate, state, to }) => ({
          scope: state?.changeId,
          artifactHash:
            to === 'TEST_DESIGN'
              ? state?.context?.artifacts?.testReplacement?.hash
              : gate === 'H1'
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
  let projectApprovalAuthority;
  const projectAuthority = () =>
    (projectApprovalAuthority ||= createApprovalAuthority({
      request: requestPeer,
      trustedPeerIdentity: trustedUserIdentity,
      audit: async (event) => {
        const store = createArtifactStore({ projectRoot: root });
        const written = store.writeJson(
          `.specgate/codex/project-approvals/${randomUUID()}-${hashValue(event).slice(0, 12)}.json`,
          event,
        );
        if (!written.ok) throw new Error('Cannot persist project approval audit');
      },
    }));
  const effectiveDirtyApprovalProvider =
    dirtyApprovalProvider ||
    (trustedUserIdentity
      ? {
          async requestApproval(challenge) {
            const binding = {
              schemaVersion: 1,
              kind: challenge.kind,
              previewHash: challenge.artifactHash,
              projectRoot: challenge.projectRoot,
              paths: challenge.paths,
              message: challenge.message,
            };
            const relative = `.specgate/codex/adoption/${challenge.artifactHash}-${hashValue(binding).slice(0, 12)}.json`;
            const store = createArtifactStore({ projectRoot: root });
            const written = store.writeJson(relative, binding);
            if (!written.ok) return written;
            const artifactHash = `sha256:${written.hash}`;
            const scope = path.resolve(root);
            const approved = await projectAuthority().requestApproval({
              gate: 'BASELINE',
              scope,
              artifactHash,
              readArtifactHash: async () => {
                const current = store.readJson(relative);
                if (!current.ok) throw new Error(current.message);
                return `sha256:${current.hash}`;
              },
              summary: canonicalJson(binding),
              signal: challenge.signal,
            });
            if (!approved.ok) return approved;
            const consumed = await projectAuthority().consumeApproval({
              approval: approved.approval,
              gate: 'BASELINE',
              scope,
              artifactHash,
            });
            if (!consumed.ok) return consumed;
            return {
              ok: true,
              record: {
                decision: 'approve',
                artifactHash: challenge.artifactHash,
                paths: [...challenge.paths],
                approval: consumed.record,
              },
            };
          },
        }
      : undefined);
  const effectiveInitializationApproval =
    initializationApprovalProvider ||
    (trustedUserIdentity && requestPeer
      ? {
          async requestApproval(challenge) {
            if (peerCapabilities?.().elicitationSupported !== true) return { approved: false };
            const response = await requestPeer(
              'elicitation/create',
              {
                message: `初始化非空目录：${challenge.root}\n保留所有现有文件；逐项保留冲突：${challenge.conflicts.map((entry) => entry.path).join('、') || '无'}\n预览：${challenge.previewHash}`,
                requestedSchema: {
                  type: 'object',
                  properties: {
                    decision: {
                      type: 'string',
                      title: '是否按当前预览补齐缺失文件',
                      enum: ['approve', 'cancel'],
                    },
                  },
                  required: ['decision'],
                },
              },
              { signal: challenge.signal },
            );
            return {
              approved: response?.action === 'accept' && response.content?.decision === 'approve',
              previewHash: challenge.previewHash,
              conflicts: challenge.conflicts.map((entry) => ({
                path: entry.path,
                decision: 'keep',
              })),
              receipt: { source: trustedUserIdentity.source, actor: trustedUserIdentity.id },
            };
          },
        }
      : undefined);
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
      approvalAuthority: authority,
      testDesignerRunner: effectiveTestDesignerRunner,
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
      nativeVerification: nativeAgents,
      timeoutMs: qualityTimeoutMs,
    }));
  let reviewService;
  const review = () =>
    (reviewService ||= createReviewService({
      projectRoot: root,
      store: stateStore(),
      planService: plans(),
      roleProvider: effectiveReviewRoleProvider,
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
      qualityService: quality(),
    }));
  const definitions = [
    ...DIAGNOSTICS,
    ...WORKFLOW_TOOLS.filter((entry) => optionalModules || !OPTIONAL_TOOL_NAMES.has(entry.name)),
    ...PROJECT_TOOLS.filter((entry) => optionalModules || !OPTIONAL_TOOL_NAMES.has(entry.name)),
    ...CHANGE_TOOLS,
    ...PLAN_TOOLS,
    ...QUALITY_TOOLS,
    ...FORMAT_TOOLS,
    ...REVIEW_TOOLS,
    ...RELEASE_TOOLS,
    ...(optionalModules ? CONTROL_TOOLS : []),
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
              status: optionalModules ? 'generation-available' : 'non-default',
              nonemptyApproval: 'unavailable',
              existingGitExecution: 'unsupported',
            };
            data.planning = {
              status: 'available',
              testRole:
                typeof planRoleProvider === 'function'
                  ? 'server-provider'
                  : nativeAgents
                    ? 'native-codex-exec'
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
              verifier:
                typeof qualityVerifier === 'function' ? 'custom' : 'project-profile-or-template',
            };
            data.formatting = {
              status: typeof effectiveFormatter === 'function' ? 'available' : 'unavailable',
              worktree: 'dedicated',
              requiredAfterTests: true,
            };
            data.review = {
              status:
                typeof effectiveReviewRoleProvider === 'function' ? 'available' : 'unavailable',
              reviewAgent:
                typeof effectiveReviewRoleProvider === 'function'
                  ? 'server-provider'
                  : 'unavailable',
              h3Approval: available.available ? 'available' : 'unavailable',
            };
            data.release = {
              status: 'available',
              forcePush: 'forbidden',
            };
            if (
              optionalModules &&
              fs.existsSync(path.join(root, '.specgate/codex-verify-report.json'))
            ) {
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
        if (optionalModules && CONTROL_TOOLS.some((entry) => entry.name === name)) {
          const { callControlTool } = await import('./control/tools.js');
          return result(
            await callControlTool(
              {
                projectRoot: root,
                clock: Date.now,
                ...(controlService ? { service: controlService } : {}),
              },
              name,
              args,
            ),
          );
        }
        if (PROJECT_TOOLS.some((entry) => entry.name === name))
          return result(
            await callProjectTool(
              {
                projectRoot: root,
                optionalModules,
                ...(baselineRunner ? { baselineRunner } : {}),
                dirtyApprovalProvider: effectiveDirtyApprovalProvider,
                newProjectVerifier:
                  newProjectVerifier ||
                  (async ({ root: projectRoot }) => {
                    const { validateVerificationEvidence } = await import('./verify.js');
                    return validateVerificationEvidence({ root: projectRoot });
                  }),
              },
              name,
              args,
              { signal },
            ),
          );
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
        const input = {
          root: path.resolve(root, args.path || '.'),
          preset: args.preset,
          frontend: args.frontend,
          company: args.company,
          business: args.business,
          gitName: args.gitName,
          gitEmail: args.gitEmail,
        };
        if (name === 'sg_verify' || name === 'sg_project_verify') {
          const { verifyProject } = await import('./verify.js');
          const verified = await verifyProject(
            {
              root: input.root,
              ...(args.javaHome ? { javaHome: args.javaHome } : {}),
              ...(args.mavenHome ? { mavenHome: args.mavenHome } : {}),
              ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
            },
            { signal },
          );
          return result({
            ...verified,
            evidenceWritten: verified.ok === true,
            reportPath: '.specgate/codex-verify-report.json',
            nextAction: verified.ok ? 'FINALIZE_BASELINE' : 'FIX_AND_RETRY_VERIFY',
          });
        }
        if (name === 'sg_init_preview') {
          const { previewInit } = await import('./init.js');
          return result(previewInit(input));
        }
        if (name === 'sg_init') {
          const { executeInit } = await import('./init.js');
          return result(
            await executeInit(
              { ...input, previewHash: args.previewHash },
              { approvalProvider: effectiveInitializationApproval, signal, environmentGate },
            ),
          );
        }
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

const PROJECT_NOT_BOUND_MESSAGE =
  '当前会话尚未绑定业务项目；SpecGate 插件源码或缓存目录不能作为业务项目。' +
  '请先调用 sg_project_bind 绑定用户给出的已有 Git 业务项目绝对路径。';

const projectNotBound = (nextAction = 'BIND_PROJECT') => ({
  ok: false,
  code: 'PROJECT_NOT_BOUND',
  projectReady: false,
  projectRoot: null,
  nextAction,
  nextTool: nextAction === 'CREATE_PROJECT' ? 'sg_project_create' : 'sg_project_bind',
  message: PROJECT_NOT_BOUND_MESSAGE,
});

const unboundProjectStatus = () => ({
  ...projectNotBound('BIND_PROJECT'),
  ok: true,
  projectRoot: null,
  detection: null,
  baselineRun: null,
  message:
    PROJECT_NOT_BOUND_MESSAGE +
    ' 如果用户已经在消息中给出了项目路径，直接绑定该路径，不要再次要求用户确认。',
});

const unboundSessionStatus = () => ({
  ...projectNotBound('BIND_PROJECT'),
  ok: true,
  stage: 'P1',
  projectRoot: null,
  environment: { status: 'not-checked', environmentReady: false },
  project: { ready: false, generated: false, baseline: null },
  workflow: { ok: true, phase: null, changeId: null, pendingApproval: null },
  workItems: { status: 'unavailable', items: [] },
  verification: { status: 'not-run', ok: false, nextAction: 'RUN_SG_VERIFY' },
  delivery: null,
  message:
    PROJECT_NOT_BOUND_MESSAGE +
    ' 如果用户已经在消息中给出了项目路径，直接绑定该路径，不要再次要求用户确认。',
});

// Keep project selection at the session boundary so all lazily created services
// are rebuilt together. A generated target becomes the active business project.
export function createToolRegistry(options = {}) {
  const optionalModules =
    options.optionalModules === true ||
    (options.optionalModules === undefined && process.env.SPECGATE_OPTIONAL_MODULES === '1');
  const configured = { ...options, optionalModules };
  const initialRoot = path.resolve(options.projectRoot || process.cwd());
  let root = initialRoot;
  let projectBound =
    options.projectBound === undefined
      ? !insideSpecGateSource(initialRoot)
      : options.projectBound === true;
  const environments = new Map();
  const environmentFor = (target) => {
    target = path.resolve(target);
    if (!environments.has(target))
      environments.set(
        target,
        options.environmentService ||
          createEnvironmentService({ root: target, consent: environmentConsent(options) }),
      );
    return environments.get(target);
  };
  const environmentGate = ({ root: target, ...selection }) =>
    environmentFor(target).check(selection);
  let bound = createBoundToolRegistry({ ...configured, projectRoot: root, environmentGate });
  let environment = environmentFor(root);
  const onboardingDraft = {};
  const definitions = [...bound.definitions, ...ONBOARDING_TOOLS, ...ENVIRONMENT_TOOLS]
    .filter((entry) => optionalModules || !OPTIONAL_TOOL_NAMES.has(entry.name))
    .map((entry) => ({
      ...entry,
      description: TOOL_DESCRIPTIONS[entry.name] || entry.description,
    }));
  const bind = (selected) => {
    root = bindProject(selected);
    projectBound = true;
    bound = createBoundToolRegistry({ ...configured, projectRoot: root, environmentGate });
    environment = environmentFor(root);
    return root;
  };
  const unboundAllowed = new Set([
    'health',
    'version',
    'status',
    'sg_status',
    'sg_project_status',
    'sg_project_bind',
    'sg_project_create',
    'sg_project_setup',
  ]);
  const registry = {
    definitions,
    validate(name, args) {
      const tool = definitions.find((entry) => entry.name === name);
      return Boolean(tool && validArguments(tool.inputSchema, args));
    },
    async call(name, args = {}, context = {}) {
      if (!definitions.some((entry) => entry.name === name))
        return result({ ok: false, code: 'UNKNOWN_TOOL', message: 'Tool is not available' });
      if (!registry.validate(name, args))
        return result({
          ok: false,
          code: 'INVALID_ARGUMENT',
          message: '工具参数不符合声明的格式。',
        });
      if (
        context.signal?.aborted &&
        !definitions.find((entry) => entry.name === name).annotations.readOnlyHint
      )
        return result({ ok: false, code: 'CANCELLED', message: '操作已取消。' });
      try {
        // The MCP launch directory can be the plugin cache even when the chat
        // is inside a business repository. An explicit check path is session
        // selection only; it never writes project configuration or files.
        if (name === 'sg_env_check' && args.path) bind(args.path);
        if (!projectBound) {
          if (name === 'sg_project_status') return result(unboundProjectStatus());
          if (name === 'sg_status') return result(unboundSessionStatus());
          if (name === 'status')
            return result({ ...unboundSessionStatus(), service: 'specgate', transport: 'stdio' });
          if (!unboundAllowed.has(name)) return result(projectNotBound());
        }
        if (name === 'sg_env_check') {
          const selection = { ...args };
          delete selection.path;
          return result({ ...(await environment.check(selection)), projectRoot: root });
        }
        if (name === 'sg_env_prepare') return result(await environment.prepare(args, context));
        if (name === 'sg_status') return result(await inspectProjectStatus({ root, environment }));
        if (name === 'sg_project_bind')
          return result({
            ok: true,
            projectRoot: bind(args.path),
            message: '已绑定业务项目，请先检查 sg_project_status。',
          });
        if (name === 'sg_project_setup') {
          if (!projectBound && !args.path) return result(projectNotBound('BIND_OR_CREATE_PROJECT'));
          const { installProject } = await import('./onboarding.js');
          const installed = installProject(args.path || root);
          return result({ ...installed, projectRoot: bind(installed.project) });
        }
        if (name === 'sg_project_create') {
          const { createProjectInteractively } = await import('./onboarding.js');
          const created = await createProjectInteractively({
            ...options,
            projectRoot: projectBound ? root : null,
            call: registry.call,
            signal: context.signal,
            draft: onboardingDraft,
            initialPath: args.path,
            reset: args.reset,
            environmentGate,
          });
          if (created.ok && created.root) {
            created.projectRoot = bind(created.root);
            created.nextAction ||= 'VERIFY_PROJECT_THEN_WAIT_FOR_USER_REQUIREMENTS';
          }
          return result(created);
        }
        if (
          [
            'sg_adopt_apply',
            'sg_verify',
            'sg_project_verify',
            'sg_development_prepare',
            'sg_development_run',
            'sg_development_repair',
            'sg_development_rework',
            'sg_quality_run',
            'sg_format_run',
            'sg_review_run',
            'sg_release_archive',
            'sg_resume',
          ].includes(name) &&
          (fs.existsSync(path.join(root, '.specgate/monorepo.json')) ||
            fs.existsSync(path.join(root, '.specgate/codex/project.json')) ||
            fs.existsSync(path.join(root, 'backend/pom.xml')))
        ) {
          const ready = await environment.check();
          if (!ready.environmentReady)
            return result({ ...ready, ok: false, code: ready.code || 'ENV_NOT_READY' });
        }
        const response = await bound.call(name, args, context);
        if (name === 'sg_init' && response.structuredContent?.ok) {
          const projectRoot = bind(response.structuredContent.root);
          return result({
            ...response.structuredContent,
            projectRoot,
            nextAction: 'VERIFY_PROJECT_THEN_WAIT_FOR_USER_REQUIREMENTS',
          });
        }
        return response;
      } catch (error) {
        return result({
          ok: false,
          code: error.code || 'PROJECT_OPERATION_FAILED',
          message: error.message,
        });
      }
    },
  };
  return registry;
}
