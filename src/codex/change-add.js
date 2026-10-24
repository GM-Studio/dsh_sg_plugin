import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildChangeContract, normalizeChangeInput, validateChangeInput } from './change-policy.js';
import { createIncrementalPlan } from './incremental.js';
import { canonicalJson, hashValue } from './events.js';
import { gitSafeDirectory } from './git-path.js';
import { categoryLabel, renderChineseData } from './locale.js';
import { readDeliveryRecord } from './delivery.js';
import { loadProjectReadiness, PROJECT_PROFILE_PATH } from './project-state.js';

const SOURCE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TERMINAL = new Set(['ARCHIVED', 'ARCHIVED_NOT_PUSHED', 'CANCELLED']);
const CATEGORIES = new Set([
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
]);
const FINDINGS = [
  'ambiguities',
  'contradictions',
  'infeasibleItems',
  'nonFunctionalRisks',
  'securityPerformanceConcurrencyRisks',
  'testBlindSpots',
  'suggestedQuestions',
];
const QUESTION_INPUTS = new Set(['text', 'choice', 'multi-choice']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const text = (value, max = 16000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const rawHash = (content) => 'sha256:' + createHash('sha256').update(content, 'utf8').digest('hex');
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const keys = (value, allowed) =>
  object(value) && Object.keys(value).every((key) => allowed.includes(key));
const questionInput = (question) => question?.input ?? 'text';
const validOptions = (options) =>
  Array.isArray(options) &&
  options.length >= 2 &&
  options.length <= 20 &&
  options.every((option) => text(option, 200)) &&
  new Set(options.map((option) => option.trim())).size === options.length;
const validQuestion = (question, seen = new Set()) => {
  const input = questionInput(question);
  const valid =
    keys(question, ['id', 'category', 'text', 'input', 'options']) &&
    id(question.id) &&
    !seen.has(question.id) &&
    CATEGORIES.has(question.category) &&
    text(question.text, 2000) &&
    QUESTION_INPUTS.has(input) &&
    (input === 'text' ? question.options === undefined : validOptions(question.options));
  seen.add(question?.id);
  return valid;
};
const validAnswer = (question, answer) => {
  const input = questionInput(question);
  if (input === 'text') return text(answer, 8000);
  if (input === 'choice') return typeof answer === 'string' && question.options.includes(answer);
  return (
    Array.isArray(answer) &&
    answer.length >= 1 &&
    answer.length <= question.options.length &&
    answer.every((value) => typeof value === 'string' && question.options.includes(value)) &&
    new Set(answer).size === answer.length
  );
};
const IMPACT_KEYS = ['affectedAcIds', 'reusedAcIds'];
const idList = (value) => Array.isArray(value) && value.every((entry) => id(entry));
// Only the shape is enforced here; the incremental algebra (unknown ACs,
// inconsistent reuse) stays in incremental.js and is surfaced verbatim.
const validImpact = (value) =>
  value === undefined ||
  (keys(value, IMPACT_KEYS) &&
    (value.affectedAcIds === undefined || idList(value.affectedAcIds)) &&
    (value.reusedAcIds === undefined || idList(value.reusedAcIds)));
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const secret = (value) =>
  /(?:\bBearer\s+[A-Za-z0-9._~+/-]{12,}|\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*[^\s,;]{6,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i.test(
    canonicalJson(value),
  );

export function stableChangeName(request) {
  const slug = request
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 55)
    .replace(/-$/, '');
  return `${slug || 'change'}-${hashValue(request).slice(0, 12)}`;
}

const INTAKE_QUESTIONS = Object.freeze([
  {
    id: 'Q-INTAKE-1',
    category: 'functional',
    text: '这个变更要解决的核心问题是什么？目标用户和期望结果是什么？',
  },
  {
    id: 'Q-INTAKE-2',
    category: 'constraint',
    text: '哪些内容明确在范围内，哪些明确不在范围内？',
  },
  {
    id: 'Q-INTAKE-3',
    category: 'acceptance',
    text: '完成后有哪些可观察、可验证的验收标准？',
  },
  {
    id: 'Q-INTAKE-4',
    category: 'failure',
    text: '需要覆盖哪些失败、边界或兼容场景？',
  },
  {
    id: 'Q-INTAKE-5',
    category: 'security',
    text: '有哪些安全、性能或并发约束？',
  },
]);

const INPUT_ERROR_CODES = Object.freeze({
  ELICITATION_UNSUPPORTED: 'USER_INPUT_UNAVAILABLE',
  TRUSTED_USER_INPUT_UNAVAILABLE: 'USER_INPUT_UNAVAILABLE',
  PEER_CANCELLED: 'CANCELLED',
  CANCELLED: 'USER_INPUT_CANCELLED',
  PEER_TIMEOUT: 'USER_INPUT_TIMEOUT',
  USER_INPUT_REJECTED: 'USER_INPUT_REJECTED',
  USER_INPUT_INVALID: 'USER_INPUT_INVALID',
});

const inputFailure = (error, actualVersion) => {
  const code = INPUT_ERROR_CODES[error?.code] ?? 'USER_INPUT_FAILED';
  if (code === 'CANCELLED')
    return failure('CANCELLED', 'The server cancelled this requirements operation', {
      actualVersion,
    });
  const messages = {
    USER_INPUT_UNAVAILABLE:
      '原生澄清通道当前不可用；变更已保留为待用户澄清状态。请重新加载 SpecGate 插件连接并新建会话后重试。',
    USER_INPUT_CANCELLED: '用户取消了原生澄清表单；变更仍保留待澄清状态。',
    USER_INPUT_TIMEOUT: '原生澄清表单等待超时；变更仍保留待澄清状态。',
    USER_INPUT_REJECTED: '用户未提交澄清回答；变更仍保留待澄清状态。',
    USER_INPUT_INVALID: '原生回答与待答问题不匹配；变更仍保留待澄清状态。',
    USER_INPUT_FAILED: '原生澄清表单未成功完成；变更仍保留待澄清状态。',
  };
  return failure(code, messages[code], {
    status: 'WAITING_FOR_USER',
    nextAction: 'RESUME_CLARIFICATION',
    actualVersion,
  });
};

function clarificationGate(data, actualVersion) {
  const answered = data?.rounds?.filter((round) => round.status === 'answered') ?? [];
  const pending = data?.rounds?.find((round) => round.status === 'pending') ?? null;
  const native =
    answered.length > 0 &&
    answered.every(
      (round) =>
        Array.isArray(round.answers) &&
        round.answers.length > 0 &&
        round.answers.every(
          (answer) =>
            answer?.source === 'native-user-provider' &&
            object(answer.actor) &&
            answer.actor.kind === 'user' &&
            text(answer.actor.id) &&
            text(answer.actor.source),
        ),
    );
  if (!pending && native) return null;
  return failure(
    'CLARIFICATION_REQUIRED',
    pending
      ? '存在尚未回答的原生澄清轮次；请先恢复该轮并取得真实用户回答。'
      : '至少需要一轮真实原生用户澄清回答，才能继续批判分析或请求 H1 审批。',
    {
      status: 'WAITING_FOR_USER',
      nextAction: pending ? 'RESUME_CLARIFICATION' : 'ASK_CLARIFICATION',
      actualVersion,
    },
  );
}
const abortError = () => Object.assign(new Error('Operation cancelled'), { code: 'CANCELLED' });

// Providers may ignore AbortSignal. Stop awaiting them and never apply their
// late answer; Promise.race also observes any later provider rejection.
async function raceAbort(operation, signal) {
  if (!signal) return operation();
  if (signal.aborted) throw abortError();
  let aborted;
  const cancellation = new Promise((_, reject) => {
    aborted = () => reject(abortError());
    signal.addEventListener('abort', aborted, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (signal.aborted) throw abortError();
        return operation();
      }),
      cancellation,
    ]);
  } finally {
    signal.removeEventListener('abort', aborted);
  }
}

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function checkedFile(root, relative) {
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('Unsafe workflow artifact path');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (
      stat.isSymbolicLink() ||
      (current === target
        ? !stat.isFile() || stat.nlink > 1 || stat.size > 4 * 1024 * 1024
        : !stat.isDirectory())
    )
      throw new Error('Unsafe workflow artifact');
  }
  return target;
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(checkedFile(root, relative), 'utf8'));
}

function readMarkdown(root, relative) {
  const content = fs.readFileSync(checkedFile(root, relative));
  const decoded = content.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(content))
    throw new Error('Workflow document is not valid UTF-8');
  return decoded;
}

function writeImmutableText(root, relative, content) {
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('Unsafe snapshot path');
  if (typeof content !== 'string') throw new Error('Snapshot content must be text');
  let current = root;
  for (const part of path.relative(root, path.dirname(target)).split(path.sep)) {
    current = path.join(current, part);
    try {
      fs.mkdirSync(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe snapshot directory');
  }
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.byteLength > 4 * 1024 * 1024)
    throw new Error('Snapshot exceeds the artifact size limit');
  let descriptor;
  let created = false;
  let failure = null;
  try {
    descriptor = fs.openSync(target, 'wx', 0o600);
    created = true;
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } catch (error) {
    failure = error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (failure) {
    if (created) {
      try {
        fs.rmSync(target, { force: true, maxRetries: 20, retryDelay: 100 });
      } catch {
        // preserve the original write failure; the partial snapshot is never treated as frozen
      }
    }
    if (failure.code !== 'EEXIST' || !fs.readFileSync(checkedFile(root, relative)).equals(bytes))
      throw failure;
  }
  if (process.platform !== 'win32') {
    const directory = fs.openSync(path.dirname(target), 'r');
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  }
  return relative;
}

function writeImmutable(root, relative, value) {
  return writeImmutableText(root, relative, canonicalJson(value) + '\n');
}

function validDraft(args) {
  if (
    !Array.isArray(args.requirements) ||
    !args.requirements.length ||
    args.requirements.length > 200 ||
    !Array.isArray(args.assumptions) ||
    !Array.isArray(args.openIssues) ||
    args.assumptions.length > 200 ||
    args.openIssues.length > 200
  )
    return false;
  const reqIds = new Set();
  const acIds = new Set();
  for (const req of args.requirements) {
    if (
      !keys(req, ['id', 'category', 'text', 'acceptanceCriteria']) ||
      !id(req.id) ||
      reqIds.has(req.id) ||
      !CATEGORIES.has(req.category) ||
      !text(req.text) ||
      !Array.isArray(req.acceptanceCriteria) ||
      !req.acceptanceCriteria.length ||
      req.acceptanceCriteria.length > 100
    )
      return false;
    reqIds.add(req.id);
    for (const ac of req.acceptanceCriteria) {
      if (!keys(ac, ['id', 'text']) || !id(ac.id) || acIds.has(ac.id) || !text(ac.text))
        return false;
      acIds.add(ac.id);
    }
  }
  const assumptionIds = new Set();
  for (const assumption of args.assumptions) {
    if (
      !keys(assumption, ['id', 'text', 'risk', 'pendingConfirmation']) ||
      !id(assumption.id) ||
      assumptionIds.has(assumption.id) ||
      !text(assumption.text) ||
      !text(assumption.risk) ||
      assumption.pendingConfirmation !== true
    )
      return false;
    assumptionIds.add(assumption.id);
  }
  const issueIds = new Set();
  return args.openIssues.every((issue) => {
    const valid =
      keys(issue, ['id', 'text', 'blocking', 'assumptionId']) &&
      id(issue.id) &&
      !issueIds.has(issue.id) &&
      text(issue.text) &&
      typeof issue.blocking === 'boolean' &&
      (issue.blocking || assumptionIds.has(issue.assumptionId));
    issueIds.add(issue?.id);
    return valid;
  });
}

function validCritique(report, requirements) {
  if (
    !keys(report, ['restatement', ...FINDINGS]) ||
    Object.keys(report).length !== FINDINGS.length + 1 ||
    !Array.isArray(report.restatement)
  )
    return false;
  const reqIds = new Set(requirements.map((req) => req.id));
  const covered = new Set();
  for (const item of report.restatement) {
    if (
      !keys(item, ['requirementId', 'text']) ||
      !reqIds.has(item.requirementId) ||
      covered.has(item.requirementId) ||
      !text(item.text)
    )
      return false;
    covered.add(item.requirementId);
  }
  if (covered.size !== reqIds.size) return false;
  const findingIds = new Set();
  return FINDINGS.every(
    (category) =>
      Array.isArray(report[category]) &&
      report[category].every((finding) => {
        const valid =
          keys(finding, ['id', 'requirementIds', 'text', 'severity', 'suggestion']) &&
          id(finding.id) &&
          !findingIds.has(finding.id) &&
          Array.isArray(finding.requirementIds) &&
          finding.requirementIds.length > 0 &&
          finding.requirementIds.every((ref) => reqIds.has(ref)) &&
          text(finding.text) &&
          ['blocking', 'non-blocking'].includes(finding.severity) &&
          text(finding.suggestion);
        findingIds.add(finding?.id);
        return valid;
      }),
  );
}

function snapshot(state, data) {
  const revision = data.revisions.at(-1);
  return {
    schemaVersion: 1,
    changeId: state.changeId,
    revision: revision.revision,
    request: data.request,
    requirements: revision.requirements,
    assumptions: revision.assumptions,
    openIssues: revision.openIssues,
    clarifications: data.rounds,
    critique: data.critique,
    change: data.change,
    changeContract: data.changeContract,
  };
}

function renderRequirements(candidate, legacyRequest = false) {
  // Storage canonicalizes object key order. Render the same bytes before and
  // after a reload so document hashes remain stable across MCP calls.
  candidate = JSON.parse(canonicalJson(candidate));
  const lines = [
    `# 需求文档：${candidate.changeId}（修订 ${candidate.revision}）`,
    '',
    '## 用户原始需求',
    legacyRequest
      ? candidate.request
      : typeof candidate.request === 'string'
        ? candidate.request
        : (candidate.request?.text ?? ''),
    '',
    '## 需求与验收标准',
  ];
  for (const requirement of candidate.requirements) {
    lines.push(
      `\n### ${requirement.id} [${categoryLabel(requirement.category)}]`,
      requirement.text,
    );
    for (const ac of requirement.acceptanceCriteria) lines.push(`- ${ac.id}：${ac.text}`);
  }
  lines.push('\n## 待用户确认的假设与风险');
  for (const assumption of candidate.assumptions)
    lines.push(`- ${assumption.id}：${assumption.text}\n  风险：${assumption.risk}`);
  lines.push('\n## 未决问题', renderChineseData(candidate.openIssues));
  lines.push('\n## 用户澄清记录', renderChineseData(candidate.clarifications));
  lines.push('\n## 反向复述与批判分析', renderChineseData(candidate.critique));
  lines.push(
    '\n## 变更范围与约束契约',
    renderChineseData({ change: candidate.change, changeContract: candidate.changeContract }),
  );
  return lines.join('\n');
}

export function renderRequirementsForUser(candidate) {
  return renderRequirements(candidate);
}

export function renderH1Summary(candidate, documentPath) {
  const brief = (value, limit = 64) => {
    const valueText = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return valueText.length > limit ? valueText.slice(0, limit - 1) + '…' : valueText;
  };
  const requirements = candidate.requirements || [];
  const details = candidate.change?.details || {};
  const functional = requirements.filter((item) => item.category === 'functional');
  const changes = (functional.length ? functional : requirements).slice(0, 3);
  const coreRequirements = requirements
    .filter((item) => ['non-functional', 'constraint', 'compatibility'].includes(item.category))
    .slice(0, 2);
  const target =
    candidate.request?.text || details.desiredBehavior || details.expectedBehavior || '';
  const type =
    { feature: '新增功能', modify: '修改功能', fix: '修复问题' }[candidate.change?.type] ||
    '需求变更';
  const lines = [
    `变更类型：${type} · ${brief(candidate.changeId, 48)}`,
    `变更目标：${brief(target) || '详见需求文档'}`,
    '涉及功能：',
    ...(changes.length ? changes.map((item) => '- ' + brief(item.text)) : ['- 详见需求文档。']),
  ];
  if (coreRequirements.length)
    lines.push('核心要求：', ...coreRequirements.map((item) => '- ' + brief(item.text)));
  lines.push(
    `验收标准：${requirements.reduce(
      (count, item) => count + item.acceptanceCriteria.length,
      0,
    )} 项`,
    `需求文档：[打开完整文档](${pathToFileURL(documentPath).href})`,
  );
  return lines.join('\n');
}

/** Dependencies are server-owned closures. No user identity, answers, receipt or
 * approval handle can be submitted through a workflow method's tool arguments.
 * This is a controlled proposal/recording core, not an autonomous LLM runner. */
export function createChangeAddService({
  projectRoot,
  store,
  approvalAuthority,
  userInputProvider,
  verifyPrerequisites = async ({ root }) =>
    (await import('./verify.js')).validateVerificationEvidence({ root }),
} = {}) {
  const root = fs.realpathSync(projectRoot);
  if (!store || typeof store.inspect !== 'function')
    throw new TypeError('A server state store is required');
  const safeRoot =
    !inside(path.resolve(SOURCE_ROOT), root) && !inside(root, path.resolve(SOURCE_ROOT));
  const now = () => new Date().toISOString();
  const gitEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
    ),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
  const git = (args) =>
    spawnSync(
      'git',
      [
        '-c',
        `safe.directory=${gitSafeDirectory(root)}`,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.hooksPath=' + path.join(root, '.specgate/codex/disabled-hooks'),
        ...args,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        env: gitEnv,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      },
    );

  async function inspectPrerequisites() {
    if (!safeRoot)
      return failure(
        'SOURCE_REPOSITORY_FORBIDDEN',
        'The plugin source repository cannot host an active product change',
      );
    let project = null;
    let verification = null;
    if (fs.existsSync(path.join(root, PROJECT_PROFILE_PATH))) {
      const readiness = loadProjectReadiness({ projectRoot: root });
      if (!readiness.ok) return readiness;
      project = {
        mode: readiness.profile.mode,
        projectId: readiness.profile.projectId,
        baselineId: readiness.baseline.baselineId,
        baselineStatus: readiness.baseline.status,
        environmentFingerprint: readiness.baseline.environmentFingerprint,
      };
    } else {
      let init;
      try {
        init = readJson(root, '.specgate/init-report.json');
        checkedFile(root, '.specgate/config.yaml');
        readJson(root, '.specgate/monorepo.json');
      } catch {
        return failure(
          'PROJECT_NOT_READY',
          'Adopt or initialize and verify the project before adding a change',
        );
      }
      if (init.initializationComplete !== true || init.phase === 'GENERATED_ONLY')
        return failure(
          'INITIALIZATION_NOT_VERIFIED',
          'Generation alone is insufficient; real verification must pass',
        );
      try {
        verification = await verifyPrerequisites({ root });
      } catch {
        return failure(
          'VERIFICATION_EVIDENCE_INVALID',
          'Real verification evidence could not be validated',
        );
      }
      if (verification?.ok !== true)
        return failure(
          verification?.code || 'VERIFICATION_EVIDENCE_INVALID',
          verification?.message || 'Real verification evidence is required',
        );
    }
    const repository = git(['rev-parse', '--show-toplevel']);
    if (repository.status !== 0 || path.resolve(repository.stdout.trim()) !== root)
      return failure(
        'GIT_REPOSITORY_REQUIRED',
        'A Git repository rooted at the project is required',
      );
    const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
    if (status.status !== 0)
      return failure('GIT_STATUS_UNAVAILABLE', 'Cannot inspect the project Git state');
    if (status.stdout.trim())
      return failure(
        'GIT_NOT_CLEAN',
        'Tracked changes and untracked files must be resolved before adding a change',
      );
    const loaded = await store.inspect();
    if (!loaded.ok) return loaded;
    if (loaded.state.changeId && !TERMINAL.has(loaded.state.phase))
      return failure('ACTIVE_CHANGE', 'Only one active change is permitted');
    return {
      ok: true,
      state: loaded.state,
      project,
      verification: verification
        ? { sourceHash: verification.sourceHash, runId: verification.runId ?? null }
        : null,
    };
  }

  async function current(args, allowed) {
    if (!safeRoot)
      return failure(
        'SOURCE_REPOSITORY_FORBIDDEN',
        'The plugin source repository cannot host an active product change',
      );
    if (!Number.isSafeInteger(args.expectedVersion) || args.expectedVersion < 0)
      return failure('INVALID_ARGUMENT', 'A nonnegative expectedVersion is required');
    const loaded = await store.load();
    if (!loaded.ok) return loaded;
    if (loaded.state.version !== args.expectedVersion)
      return failure('VERSION_CONFLICT', 'Read the current state before retrying', {
        actualVersion: loaded.state.version,
      });
    if (!allowed.includes(loaded.state.phase) || !loaded.state.context.changeAdd)
      return failure(
        'INVALID_TRANSITION',
        'This requirements operation is not permitted in the current phase',
      );
    return loaded;
  }

  const update = (state, data, artifact = null) =>
    store.update({
      expectedVersion: state.version,
      patch: {
        context: {
          changeAdd: data,
          artifacts: { ...state.context.artifacts, requirements: artifact },
        },
      },
    });

  async function startCommon(
    args,
    type,
    details,
    parentDeliveryId = null,
    impact = null,
    { signal } = {},
  ) {
    const validation = validateChangeInput({ type, request: args.request, details });
    if (!validation.ok) return validation;
    const ready = await inspectPrerequisites();
    if (!ready.ok) return ready;
    const changeId = args.name ?? stableChangeName(args.request);
    let incremental = null;
    if (parentDeliveryId) {
      if (!ready.project)
        return failure(
          'PARENT_DELIVERY_PROJECT_REQUIRED',
          'Incremental delivery requires a ProjectProfile-backed project',
        );
      const parent = readDeliveryRecord({
        projectRoot: root,
        deliveryId: parentDeliveryId,
      });
      if (!parent.ok) return parent;
      if (parent.delivery.projectId !== ready.project.projectId)
        return failure(
          'PARENT_DELIVERY_PROJECT_MISMATCH',
          'Parent delivery belongs to another project',
        );
      if (
        parent.delivery.state !== 'delivery-accepted' &&
        parent.delivery.releaseState !== 'customer-accepted'
      )
        return failure('PARENT_DELIVERY_NOT_ACCEPTED', 'Parent delivery is not accepted');
      // The contract only supplies identity here; requirements (and their ACs)
      // arrive later, so allowed ACs come from the accepted parent delivery.
      const plan = createIncrementalPlan({
        projectId: ready.project.projectId,
        parent: parent.delivery,
        contract: {
          changeId,
          parentDeliveryId: parent.delivery.deliveryId,
          acceptance: [],
        },
        impact: {
          affectedAcIds: impact?.affectedAcIds,
          reusedAcIds: impact?.reusedAcIds ?? [],
        },
      });
      if (!plan.ok) return plan;
      const hash = 'sha256:' + hashValue(plan.plan);
      const artifactPath =
        `.specgate/codex/changes/${changeId}/incremental/plan-` +
        `${hash.replace(/^sha256:/, '')}.json`;
      try {
        writeImmutable(root, artifactPath, plan.plan);
      } catch {
        return failure(
          'SNAPSHOT_CONFLICT',
          'The incremental delivery plan could not be safely written',
        );
      }
      incremental = { hash, path: artifactPath, plan: clone(plan.plan) };
    }
    const created = await store.create({
      expectedVersion: args.expectedVersion,
      changeId,
      context: {
        changeAdd: {
          request: { text: args.request, source: 'command-input', at: now() },
          change: {
            type,
            details: clone(details),
            parentDeliveryId,
            baselineId: ready.project?.baselineId ?? 'baseline-legacy',
          },
          incremental,
          revisions: [],
          rounds: [],
          critique: null,
          candidate: null,
          document: null,
          frozen: null,
          changeContract: null,
        },
        project: ready.project,
        prerequisiteVerification: ready.verification,
      },
    });
    if (!created.ok) return created;
    const moved = await store.transition({
      expectedVersion: created.state.version,
      to: 'REQ_CLARIFYING',
    });
    if (!moved.ok) return moved;
    const clarification = await requestClarification({
      state: moved.state,
      questions: INTAKE_QUESTIONS,
      source: 'server-intake',
      signal,
    });
    if (!clarification.ok) {
      if (clarification.code === 'CANCELLED') return clarification;
      const latest = await store.load();
      if (!latest.ok) return latest;
      return {
        ...clarification,
        changeId: latest.state.changeId ?? moved.state.changeId,
        state: latest.state,
        actualVersion: latest.state.version,
        status: clarification.status ?? 'WAITING_FOR_USER',
        nextAction: clarification.nextAction ?? 'RESUME_CLARIFICATION',
        clarification: {
          code: clarification.code,
          message: clarification.message,
        },
      };
    }
    return clarification;
  }

  async function start(args = {}, { signal } = {}) {
    if (
      !keys(args, ['name', 'request', 'expectedVersion']) ||
      !text(args.request) ||
      (args.name !== undefined && !id(args.name))
    )
      return failure(
        'INVALID_ARGUMENT',
        'A bounded request and optional valid change name are required',
      );
    if (secret(args.request))
      return failure('SENSITIVE_INPUT', 'Remove credentials from the change request');
    return startCommon(args, 'feature', {}, null, null, { signal });
  }

  async function startTyped(args = {}, { signal } = {}) {
    // Keep the human gate reachable through the unified entry when a host
    // exposes only a subset of the server's tool catalogue.
    if (args.action === 'request_h1') {
      if (!keys(args, ['expectedVersion', 'action']))
        return failure('INVALID_ARGUMENT', 'H1 only accepts an action and current version');
      return requestH1({ expectedVersion: args.expectedVersion }, { signal });
    }
    if (
      !keys(args, [
        'name',
        'request',
        'expectedVersion',
        'type',
        'details',
        'parentDeliveryId',
        'impact',
      ]) ||
      !text(args.request) ||
      (args.name !== undefined && !id(args.name))
    )
      return failure(
        'INVALID_ARGUMENT',
        'A bounded request, type and optional valid change name are required',
      );
    const normalized = normalizeChangeInput({
      request: args.request,
      type: args.type,
      details: args.details ?? {},
    });
    if (!normalized.ok) return normalized;
    if (!validImpact(args.impact))
      return failure(
        'INVALID_ARGUMENT',
        'Impact may only contain affectedAcIds and reusedAcIds identifier lists',
      );
    return startCommon(
      args,
      normalized.type,
      normalized.details,
      args.parentDeliveryId ?? null,
      args.impact,
      { signal },
    );
  }

  async function cancelled() {
    const inspected = await store.inspect();
    return failure(
      'CANCELLED',
      'The server cancelled this requirements operation',
      inspected.ok ? { actualVersion: inspected.state.version } : {},
    );
  }

  async function propose(args = {}) {
    if (!keys(args, ['expectedVersion', 'requirements', 'assumptions', 'openIssues']))
      return failure('INVALID_ARGUMENT', 'Only a requirements proposal may be submitted');
    const loaded = await current(args, ['REQ_INTAKE', 'REQ_CLARIFYING', 'H1_PENDING']);
    if (!loaded.ok) return loaded;
    const gate = clarificationGate(loaded.state.context.changeAdd, loaded.state.version);
    if (gate) return gate;
    if (!validDraft(args))
      return failure(
        'REQUIREMENTS_INVALID',
        'Requirements, acceptance criteria, assumptions and unresolved issues must be structured and referenced',
      );
    if (secret(args))
      return failure('SENSITIVE_INPUT', 'Remove credentials from the requirements proposal');
    let state = loaded.state;
    if (state.phase !== 'REQ_CLARIFYING') {
      const moved = await store.transition({
        expectedVersion: state.version,
        to: 'REQ_CLARIFYING',
      });
      if (!moved.ok) return moved;
      state = moved.state;
    }
    const data = clone(state.context.changeAdd);
    data.document = null;
    data.revisions.push({
      revision: data.revisions.length + 1,
      at: now(),
      source: 'model-proposal',
      requirements: args.requirements,
      assumptions: args.assumptions,
      openIssues: args.openIssues,
    });
    data.critique = null;
    data.candidate = null;
    data.frozen = null;
    data.changeContract = null;
    return update(state, data, null);
  }

  async function requestClarification({ state, questions, source, round, signal }) {
    const resume = Number.isSafeInteger(round);
    const roundIndex = resume ? round - 1 : state.context.changeAdd.rounds.length;
    const questionIds = new Set(questions.map((question) => question.id));
    const data = clone(state.context.changeAdd);
    let saved = { ok: true, state };
    if (!resume) {
      data.rounds.push({
        round: roundIndex + 1,
        at: now(),
        status: 'pending',
        questions: clone(questions),
        source,
        answers: [],
      });
      data.critique = null;
      data.candidate = null;
      data.document = null;
      if (signal?.aborted) return cancelled();
      saved = await update(state, data, null);
      if (!saved.ok) return saved;
    }
    const identity = userInputProvider?.trustedUserIdentity;
    if (
      typeof userInputProvider?.request !== 'function' ||
      !object(identity) ||
      identity.kind !== 'user' ||
      !text(identity.id) ||
      !text(identity.source) ||
      /(?:client[-_ ]?info|capabilit)|^(?:client|mcp-client)$/i.test(identity.source)
    )
      return inputFailure({ code: 'TRUSTED_USER_INPUT_UNAVAILABLE' }, saved.state.version);
    const actor = { id: identity.id, source: identity.source, kind: 'user' };
    let response;
    try {
      response = await raceAbort(
        () =>
          userInputProvider.request(
            {
              changeId: saved.state.changeId,
              round: roundIndex + 1,
              questions: clone(questions),
            },
            { signal },
          ),
        signal,
      );
    } catch (error) {
      if (signal?.aborted) return cancelled();
      return inputFailure(error, saved.state.version);
    }
    if (signal?.aborted) return cancelled();
    const questionsById = new Map(questions.map((question) => [question.id, question]));
    if (
      !keys(response, ['answers']) ||
      !Array.isArray(response.answers) ||
      response.answers.length !== questions.length ||
      new Set(response.answers.map((a) => a?.questionId)).size !== questions.length ||
      !response.answers.every(
        (a) =>
          keys(a, ['questionId', 'answer']) &&
          questionIds.has(a.questionId) &&
          validAnswer(questionsById.get(a.questionId), a.answer),
      )
    )
      return inputFailure({ code: 'USER_INPUT_INVALID' }, saved.state.version);
    if (secret(response))
      return failure(
        'SENSITIVE_INPUT',
        'Native answers contain apparent credentials and were not recorded',
        { actualVersion: saved.state.version },
      );
    data.rounds[roundIndex].status = 'answered';
    data.rounds[roundIndex].answers = response.answers.map((a) => ({
      ...a,
      source: 'native-user-provider',
      actor,
      at: now(),
    }));
    if (signal?.aborted) return cancelled();
    return update(saved.state, data);
  }

  async function askQuestions(args = {}, { signal } = {}) {
    if (!keys(args, ['expectedVersion', 'questions', 'round']))
      return failure(
        'INVALID_ARGUMENT',
        'Answers and user provenance cannot be submitted as tool arguments',
      );
    if (signal?.aborted) return cancelled();
    const loaded = await current(args, ['REQ_CLARIFYING']);
    if (!loaded.ok) return loaded;
    const data = loaded.state.context.changeAdd;
    const resume = args.round !== undefined;
    if (
      resume &&
      (args.questions !== undefined ||
        !Number.isSafeInteger(args.round) ||
        args.round < 1 ||
        args.round > data.rounds.length ||
        data.rounds[args.round - 1].status !== 'pending')
    )
      return failure('INVALID_ARGUMENT', 'Only an existing unanswered round may be resumed');
    if (!resume && data.rounds.some((round) => round.status === 'pending'))
      return failure(
        'CLARIFICATION_PENDING',
        'Resume the unanswered clarification round before opening another',
        {
          status: 'WAITING_FOR_USER',
          nextAction: 'RESUME_CLARIFICATION',
          actualVersion: loaded.state.version,
        },
      );
    const questions = resume ? data.rounds[args.round - 1].questions : args.questions;
    if (
      !Array.isArray(questions) ||
      questions.length < 1 ||
      questions.length > 5 ||
      (!resume && data.rounds.length >= 3)
    )
      return failure(
        'QUESTION_LIMIT',
        'At most three rounds with at most five questions are permitted',
      );
    const seen = new Set();
    if (!questions.every((question) => validQuestion(question, seen)))
      return failure(
        'INVALID_ARGUMENT',
        'Questions require unique IDs, categories, text and valid native input options',
      );
    if (secret(questions))
      return failure('SENSITIVE_INPUT', 'Remove credentials from clarification questions');
    return requestClarification({
      state: loaded.state,
      questions,
      source: resume ? data.rounds[args.round - 1].source : 'model-proposal',
      round: resume ? args.round : undefined,
      signal,
    });
  }
  async function critique(args = {}) {
    if (!keys(args, ['expectedVersion', 'report']))
      return failure('INVALID_ARGUMENT', 'Only a structured critique report may be submitted');
    const loaded = await current(args, ['REQ_CLARIFYING', 'REQ_CRITIQUE']);
    if (!loaded.ok) return loaded;
    const gate = clarificationGate(loaded.state.context.changeAdd, loaded.state.version);
    if (gate) return gate;
    const revision = loaded.state.context.changeAdd.revisions.at(-1);
    if (!revision || !validCritique(args.report, revision.requirements))
      return failure(
        'CRITIQUE_INVALID',
        'Critique must cover every requirement and reference valid requirement IDs in every finding',
      );
    if (secret(args.report))
      return failure('SENSITIVE_INPUT', 'Remove credentials from the critique report');
    let state = loaded.state;
    if (state.phase !== 'REQ_CRITIQUE') {
      const moved = await store.transition({ expectedVersion: state.version, to: 'REQ_CRITIQUE' });
      if (!moved.ok) return moved;
      state = moved.state;
    }
    const data = clone(state.context.changeAdd);
    data.document = null;
    data.critique = { source: 'model-proposal', at: now(), report: clone(args.report) };
    const contract = buildChangeContract({
      changeId: state.changeId,
      parentDeliveryId: data.change?.parentDeliveryId ?? null,
      type: data.change?.type,
      request: data.request.text,
      details: data.change?.details ?? {},
      requirements: revision.requirements,
      baselineId: data.change?.baselineId,
      status: 'H1_PENDING',
    });
    if (!contract.ok) return contract;
    data.changeContract = contract.contract;
    const artifact = snapshot(state, data);
    const artifactHash = 'sha256:' + hashValue(artifact);
    data.candidate = { hash: artifactHash, snapshot: artifact };
    const saved = await update(state, data, { hash: artifactHash, revision: revision.revision });
    if (!saved.ok) return saved;
    const pending = await store.transition({
      expectedVersion: saved.state.version,
      to: 'H1_PENDING',
    });
    if (!pending.ok) return pending;
    return prepareRequirementsDocument(pending.state, data);
  }

  async function prepareRequirementsDocument(state, data) {
    const revision = data.revisions.at(-1);
    const fingerprint = data.candidate.hash.replace(/^sha256:/, '');
    const base = `.specgate/codex/changes/${state.changeId}/requirements/`;
    const candidatePath = base + 'candidate-' + fingerprint + '.json';
    const documentPath =
      base + 'revision-' + revision.revision + '-' + fingerprint + '-review-v2.md';
    const markdown = renderRequirementsForUser(data.candidate.snapshot) + '\n';
    const documentHash = rawHash(markdown);
    try {
      writeImmutable(root, candidatePath, data.candidate.snapshot);
      writeImmutableText(root, documentPath, markdown);
    } catch {
      return failure(
        'SNAPSHOT_CONFLICT',
        'An immutable requirements review document could not be safely written',
        {
          actualVersion: state.version,
        },
      );
    }
    data.document = {
      rendererVersion: 2,
      path: documentPath,
      hash: documentHash,
      candidateHash: data.candidate.hash,
      preparedAt: now(),
    };
    const saved = await update(state, data, {
      hash: data.candidate.hash,
      revision: revision.revision,
      candidatePath,
      documentPath,
      documentHash,
    });
    if (!saved.ok) return saved;
    return {
      ok: true,
      code: 'H1_DOCUMENT_READY',
      message:
        '需求审查文档已写入，请展示文档链接供用户查看和修改。修改后须重新执行 sg_change_propose 和 sg_change_critique。用户查看后调用 sg_request_h1；若该工具未暴露，使用 sg_change({ action: "request_h1", expectedVersion }) 打开同一可信审批表单。',
      status: 'AWAITING_REQUIREMENTS_REVIEW',
      nextAction: 'REVIEW_AND_REQUEST_H1_APPROVAL',
      document: {
        path: documentPath,
        absolutePath: path.resolve(root, documentPath),
        hash: documentHash,
      },
      state: saved.state,
      actualVersion: saved.state.version,
    };
  }

  async function requestH1(args = {}, { signal } = {}) {
    if (!keys(args, ['expectedVersion']))
      return failure(
        'INVALID_ARGUMENT',
        'Approval credentials cannot be submitted as tool arguments',
      );
    if (signal?.aborted) return cancelled();
    const loaded = await current(args, ['H1_PENDING']);
    if (!loaded.ok) return loaded;
    const gate = clarificationGate(loaded.state.context.changeAdd, loaded.state.version);
    if (gate) return gate;
    const data = clone(loaded.state.context.changeAdd);
    const revision = data.revisions.at(-1);
    if (
      !data.candidate ||
      !data.critique ||
      !revision ||
      data.candidate.hash !== 'sha256:' + hashValue(snapshot(loaded.state, data))
    )
      return failure(
        'REQUIREMENTS_CHANGED',
        '需求文档已变化；请重新执行批判分析（sg_change_critique）后再请求 H1 审批',
      );
    if (
      revision.openIssues.some((issue) => issue.blocking) ||
      FINDINGS.some((category) =>
        data.critique.report[category].some((finding) => finding.severity === 'blocking'),
      )
    )
      return failure(
        'REQUIREMENTS_BLOCKED',
        '存在阻塞性未决问题、阻塞性批判发现或未回答的澄清轮次；必须先解决，才能请求 H1 审批',
      );
    const base = `.specgate/codex/changes/${loaded.state.changeId}/requirements/`;
    const fingerprint = data.candidate.hash.replace(/^sha256:/, '');
    const candidatePath = base + 'candidate-' + fingerprint + '.json';
    const markdown = renderRequirementsForUser(data.candidate.snapshot) + '\n';
    const documentHash = rawHash(markdown);
    const documentPath =
      data.document?.path ?? base + 'revision-' + revision.revision + '-' + fingerprint + '.md';

    // A direct approval request must open the native form in this invocation,
    // including older changes that have not generated their review document.
    if (!data.document) {
      const prepared = await prepareRequirementsDocument(loaded.state, data);
      if (!prepared.ok) return prepared;
      return requestH1({ expectedVersion: prepared.state.version }, { signal });
    }

    // Upgrade only an untouched document produced by the known old renderer.
    // Keep the immutable old file and the exact requirements candidate; user
    // edits must still go through proposal and critique instead of being lost.
    if (data.document.rendererVersion !== 2 && data.document.hash !== documentHash) {
      const legacyHash = rawHash(renderRequirements(data.candidate.snapshot, true) + '\n');
      try {
        if (
          data.document.hash === legacyHash &&
          rawHash(readMarkdown(root, documentPath)) === legacyHash &&
          data.document.candidateHash === data.candidate.hash &&
          loaded.state.context.artifacts.requirements?.documentHash === legacyHash &&
          loaded.state.context.artifacts.requirements?.documentPath === documentPath &&
          loaded.state.context.artifacts.requirements?.candidatePath === candidatePath &&
          loaded.state.context.artifacts.requirements?.hash === data.candidate.hash &&
          'sha256:' + hashValue(readJson(root, candidatePath)) === data.candidate.hash
        ) {
          const prepared = await prepareRequirementsDocument(loaded.state, data);
          if (!prepared.ok) return prepared;
          return requestH1({ expectedVersion: prepared.state.version }, { signal });
        }
      } catch {
        return failure('REQUIREMENTS_CHANGED', '旧需求审查文档无法核对；请重新提案和批判分析');
      }
    }

    if (
      data.document.path !== documentPath ||
      data.document.hash !== documentHash ||
      data.document.candidateHash !== data.candidate.hash ||
      loaded.state.context.artifacts.requirements?.hash !== data.candidate.hash ||
      loaded.state.context.artifacts.requirements?.candidatePath !== candidatePath ||
      loaded.state.context.artifacts.requirements?.documentPath !== documentPath ||
      loaded.state.context.artifacts.requirements?.documentHash !== documentHash
    )
      return failure(
        'REQUIREMENTS_CHANGED',
        '需求审查文档或审批指纹已变化；请重新执行 sg_change_propose 和 sg_change_critique',
      );
    try {
      if ('sha256:' + hashValue(readJson(root, candidatePath)) !== data.candidate.hash)
        return failure('REQUIREMENTS_CHANGED', '需求候选文档已变化；请重新执行批判分析');
      if (rawHash(readMarkdown(root, documentPath)) !== documentHash)
        return failure(
          'REQUIREMENTS_CHANGED',
          '需求审查文档已被编辑；请重新执行 sg_change_propose 和 sg_change_critique',
        );
    } catch {
      return failure(
        'REQUIREMENTS_CHANGED',
        '需求审查文档无法读取或已失效；请重新执行 sg_change_propose 和 sg_change_critique',
      );
    }
    if (typeof approvalAuthority?.requestApproval !== 'function')
      return failure(
        'TRUSTED_APPROVAL_UNAVAILABLE',
        '缺少原生人工审批通道：请重新加载包含 sg_request_h1 的 SpecGate 插件连接（或以 SPECGATE_INTERACTIVE_APPROVAL=1 启动）并新建会话后重试；普通聊天确认不能作为 H1 审批。',
      );
    if (signal?.aborted) return cancelled();

    let artifactPath = candidatePath;
    const readArtifactHash = async () => {
      if (signal?.aborted) throw abortError();
      const candidateHash = 'sha256:' + hashValue(readJson(root, artifactPath));
      if (candidateHash !== data.candidate.hash) return candidateHash;
      const currentDocumentHash = rawHash(readMarkdown(root, documentPath));
      if (currentDocumentHash !== documentHash) return currentDocumentHash;
      return data.candidate.hash;
    };
    const approved = await approvalAuthority.requestApproval({
      gate: 'H1',
      scope: loaded.state.changeId,
      artifactHash: data.candidate.hash,
      readArtifactHash,
      summary: renderH1Summary(data.candidate.snapshot, path.resolve(root, documentPath)),
      documentPath,
      signal,
    });
    const fresh = await store.load();
    if (!fresh.ok) return fresh;
    if (
      fresh.state.phase !== 'H1_PENDING' ||
      fresh.state.context.changeAdd?.candidate?.hash !== data.candidate.hash ||
      fresh.state.context.changeAdd?.document?.hash !== documentHash
    )
      return failure('REQUIREMENTS_CHANGED', 'H1 审批期间需求文档发生变化；请重新请求审批');
    if (!approved.ok) {
      if (approved.record?.decision === 'cancel') {
        const cancelledState = await store.cancel({
          expectedVersion: fresh.state.version,
          reason: 'Native user cancelled H1',
        });
        if (!cancelledState.ok) return cancelledState;
        return {
          ...approved,
          state: cancelledState.state,
          actualVersion: cancelledState.state?.version,
        };
      }
      if (approved.record?.decision === 'modify') {
        const moved = await store.transition({
          expectedVersion: fresh.state.version,
          to: 'REQ_CLARIFYING',
        });
        if (!moved.ok) return moved;
        return { ...approved, state: moved.state, actualVersion: moved.state?.version };
      }
      return {
        ...approved,
        status: 'WAITING_FOR_USER',
        state: fresh.state,
        actualVersion: fresh.state.version,
        nextAction: 'REQUEST_H1_APPROVAL',
      };
    }
    if (signal?.aborted) return cancelled();
    const frozenPath = base + 'revision-' + revision.revision + '-' + fingerprint + '.json';
    try {
      writeImmutable(root, frozenPath, data.candidate.snapshot);
    } catch {
      return failure(
        'SNAPSHOT_CONFLICT',
        'The immutable approved revision could not be safely written',
      );
    }
    artifactPath = frozenPath;
    data.frozen = {
      path: frozenPath,
      hash: data.candidate.hash,
      revision: revision.revision,
      authority: 'REQ_FROZEN-gate-transition',
    };
    const saved = await update(fresh.state, data, {
      ...fresh.state.context.artifacts.requirements,
      hash: data.candidate.hash,
      revision: revision.revision,
      candidatePath,
      documentPath,
      documentHash,
      frozenPath,
    });
    if (!saved.ok) return saved;
    if (signal?.aborted) return cancelled();
    const frozen = await store.transition({
      expectedVersion: saved.state.version,
      to: 'REQ_FROZEN',
      approval: approved.approval,
    });
    return frozen.ok
      ? {
          ...frozen,
          code: 'H1_APPROVED',
          message: 'H1 已批准，需求已冻结，可继续生成实现计划。',
          actualVersion: frozen.state.version,
        }
      : frozen;
  }
  return Object.freeze({
    inspectPrerequisites,
    start,
    startTyped,
    propose,
    askQuestions,
    critique,
    requestH1,
  });
}
