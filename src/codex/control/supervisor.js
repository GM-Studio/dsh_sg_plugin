import { hashValue } from '../events.js';
import { findLatestDeliveryRecord } from '../delivery.js';
import { extractSessionId } from './codex-execution-adapter.js';

const failure = (code, message) => ({ ok: false, code, message });

function eventText(event) {
  if (!event || typeof event !== 'object') return '';
  const strings = [];
  const visit = (value, depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (value.length <= 64000) strings.push(value);
      return;
    }
    if (typeof value !== 'object') return;
    for (const entry of Object.values(value)) visit(entry, depth + 1);
  };
  visit(event);
  return strings.join('\n');
}

export function parseWaitingMarker(events = []) {
  for (const event of [...events].reverse()) {
    const value = eventText(event);
    const index = value.lastIndexOf('SPECGATE_WAITING_FOR_USER:');
    if (index < 0) continue;
    const tail = value.slice(index + 'SPECGATE_WAITING_FOR_USER:'.length).trim();
    const end = tail.indexOf('\n');
    try {
      return JSON.parse(end >= 0 ? tail.slice(0, end) : tail);
    } catch {
      return null;
    }
  }
  return null;
}

function decisionPayloadText(item) {
  try {
    return JSON.stringify(item.resume?.payload || {});
  } catch {
    return '{}';
  }
}

export function buildWorkerPrompt(item, mode = 'start') {
  const resume = item?.resume || null;
  const sessionLine = resume
    ? [
        `Decision id: ${resume.decisionId || 'unknown'}`,
        `Session to restore: ${resume.sessionId || 'none'}`,
      ]
    : [];
  if (mode === 'resume') {
    return [
      'Resume this SpecGate WorkItem after a trusted user decision.',
      `WorkItem: ${item.workItemId}`,
      `Title: ${item.title}`,
      `Decision: ${resume?.action || 'resume'}`,
      `Decision payload: ${decisionPayloadText(item)}`,
      ...sessionLine,
      'Resume the recorded Codex session identified above; do not create a replacement session.',
      'Re-read sg_state and sg_project_status before changing state.',
      'Use the sg-codex Skill and the configured SpecGate project agents.',
      'Do not treat this message as H1 or H3 approval unless the cited artifact is unchanged.',
      'If a gate tool returns WAITING_FOR_USER, stop immediately and wait for the supervisor.',
      'If another human gate is reached, stop and emit one final line:',
      'SPECGATE_WAITING_FOR_USER:{"type":"H1_APPROVAL","reason":"...","question":"...","actions":["approve","request_changes"],"artifactHash":"<64 hex>"}',
    ].join('\n');
  }
  return [
    'Execute this SpecGate WorkItem autonomously.',
    `WorkItem: ${item.workItemId}`,
    `Title: ${item.title}`,
    `Request: ${item.request}`,
    ...(item.resume
      ? [
          `Prior user Decision: ${item.resume.action}`,
          `Decision payload: ${decisionPayloadText(item)}`,
          ...sessionLine,
          ...(item.resume.sessionId
            ? [
                'Resume the recorded Codex session identified above; do not create a replacement session.',
              ]
            : []),
          'Re-read current state and continue from the recorded checkpoint.',
        ]
      : []),
    'Use the sg-codex Skill, project AGENTS.md and packaged SpecGate tools.',
    'AI owns planning, tests, implementation, verification, bounded repair and delivery preparation.',
    'Do not ask for routine progress confirmation.',
    'If a gate tool returns WAITING_FOR_USER, stop immediately and wait for the supervisor.',
    'At H1, H3, missing required input, unrecoverable blockage, offline handling or budget escalation, stop and emit one final line:',
    'SPECGATE_WAITING_FOR_USER:{"type":"H1_APPROVAL","reason":"...","question":"...","actions":["approve","request_changes"],"artifactHash":"<64 hex>"}',
    'Never invent user approval and never substitute a summary for Evidence.',
  ].join('\n');
}

export const buildPrompt = buildWorkerPrompt;

function usageFromEvent(event) {
  if (!event || typeof event !== 'object') return { tokens: 0, toolCalls: 0 };
  const usage = event.usage || event.response?.usage || event.item?.usage || {};
  const tokens =
    Number.isFinite(usage.input_tokens) || Number.isFinite(usage.output_tokens)
      ? Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0)
      : 0;
  const toolCalls =
    /command|tool/i.test(String(event.type || '')) ||
    ['command_execution', 'tool_call', 'function_call'].includes(event.item?.type)
      ? 1
      : 0;
  return { tokens, toolCalls };
}

function sessionIdFrom(item) {
  return item.resume?.sessionId || null;
}

export function createControlSupervisor({
  service,
  adapter,
  controlRoot = null,
  ownerId = 'local-supervisor',
  leaseMs = 60000,
  heartbeatMs = 15000,
  clock = Date.now,
  logger = () => {},
  deliveryResolver = ({ projectRoot }) => findLatestDeliveryRecord({ projectRoot }),
} = {}) {
  if (!service || typeof service.claimNext !== 'function')
    throw new TypeError('A control service is required');
  if (!adapter || typeof adapter.run !== 'function')
    throw new TypeError('A Codex execution adapter is required');
  let stopped = false;
  const controllers = new Map();

  async function raiseAttention(item, { type, reason, question, actions, payload = null }) {
    const current = await service.getWorkItem(item.workItemId);
    if (!current.ok) return current;
    return service.requestAttention({
      workItemId: item.workItemId,
      expectedVersion: current.workItem.revision,
      type,
      reason,
      question,
      actions,
      summary:
        payload?.summary ||
        `Execution ${item.workItemId} requires a human decision at ${new Date(clock()).toISOString()}.`,
      risks: payload?.risks || [],
      evidence: payload?.evidence || [],
      artifactHash: hashValue({ workItemId: item.workItemId, type, payload }),
    });
  }

  async function runOnce({ signal } = {}) {
    if (stopped) return failure('SUPERVISOR_STOPPED', 'Supervisor is stopped');
    const reconciled = await service.reconcile({ now: clock() });
    if (!reconciled.ok) return reconciled;
    const claimed = await service.claimNext({ ownerId, leaseMs });
    if (!claimed.ok) return claimed;
    if (!claimed.workItem) return { ok: true, idle: true, status: 'idle' };
    const item = claimed.workItem;
    const run = claimed.run;
    const mode = item.resume && sessionIdFrom(item) ? 'resume' : 'start';
    const controller = new AbortController();
    controllers.set(run.runId, { controller, leaseToken: claimed.lease.token });
    const onExternalAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onExternalAbort, { once: true });
    const events = [];
    let runVersion = run.revision;
    let heartbeatError = null;
    let heartbeatChain = Promise.resolve();
    let lastPhase = mode === 'resume' ? 'RESUMING' : 'STARTING';
    let lastCommand = null;
    let sessionId = sessionIdFrom(item);
    let budgetLimit = null;
    let tokenUsage = 0;
    const baseUsage = item.budgetUsage || {};
    const startedAt = clock();

    const budgetSnapshot = () => ({
      elapsedMs: Number(baseUsage.elapsedMs || 0) + Math.max(0, clock() - startedAt),
      modelTokens: Number(baseUsage.modelTokens || 0) + tokenUsage,
      toolCalls: Number(baseUsage.toolCalls || 0) + events.length,
      repairRounds: Number(baseUsage.repairRounds || 0),
      evidenceBytes: Number(baseUsage.evidenceBytes || 0),
    });

    const checkBudget = () => {
      if (budgetLimit) return;
      const usage = budgetSnapshot();
      if (usage.elapsedMs >= item.budget.wallClockMs) budgetLimit = 'WALL_CLOCK_BUDGET';
      else if (usage.modelTokens >= item.budget.maxModelTokens) budgetLimit = 'MODEL_TOKEN_BUDGET';
      else if (usage.toolCalls >= item.budget.maxToolCalls) budgetLimit = 'TOOL_CALL_BUDGET';
      if (budgetLimit) controller.abort();
    };

    const requestHeartbeat = (updates = {}) => {
      heartbeatChain = heartbeatChain.then(async () => {
        if (heartbeatError) return heartbeatError;
        const result = await service.heartbeat({
          runId: run.runId,
          leaseToken: claimed.lease.token,
          expectedRunVersion: runVersion,
          updates: {
            currentPhase: lastPhase,
            currentCommand: lastCommand,
            ...(sessionId ? { sessionId } : {}),
            budgetUsage: budgetSnapshot(),
            ...updates,
          },
        });
        if (!result.ok) {
          heartbeatError = result;
          if (['RUN_STOPPED', 'LEASE_INVALID'].includes(result.code)) controller.abort();
          return result;
        }
        runVersion = result.run?.revision ?? runVersion + 1;
        return result;
      });
      return heartbeatChain;
    };

    const heartbeatTimer = setInterval(() => {
      checkBudget();
      void requestHeartbeat();
    }, heartbeatMs);
    heartbeatTimer.unref?.();
    const initialHeartbeat = await requestHeartbeat();
    if (!initialHeartbeat.ok) {
      clearInterval(heartbeatTimer);
      controllers.delete(run.runId);
      signal?.removeEventListener('abort', onExternalAbort);
      await service.finishRun({
        runId: run.runId,
        leaseToken: claimed.lease.token,
        status: 'FAILED',
        error: initialHeartbeat.code,
      });
      await raiseAttention(item, {
        type: 'FAILED',
        reason: 'Execution could not establish a valid lease heartbeat.',
        question: 'Retry, request changes, or cancel this WorkItem?',
        actions: ['retry', 'request_changes', 'cancel'],
        payload: { error: initialHeartbeat.code },
      });
      return initialHeartbeat;
    }

    let execution;
    try {
      execution = await adapter.run({
        mode,
        projectRoot: item.projectRoot,
        sessionId,
        prompt: buildWorkerPrompt(item, mode),
        signal: controller.signal,
        environment: {
          SPECGATE_WORK_ITEM_ID: item.workItemId,
          ...(controlRoot ? { SPECGATE_CONTROL_HOME: controlRoot } : {}),
        },
        onSession: (value) => {
          sessionId = value;
          void requestHeartbeat({ sessionId: value });
        },
        onEvent: (event) => {
          events.push(event);
          const usage = usageFromEvent(event);
          tokenUsage += usage.tokens;
          lastPhase = event?.type || 'RUNNING';
          lastCommand = event?.command || event?.item?.command || null;
          sessionId ||= extractSessionId(event);
          checkBudget();
          void requestHeartbeat();
        },
      });
    } catch (error) {
      execution = failure(error.code || 'CODEX_EXECUTION_FAILED', error.message);
    } finally {
      clearInterval(heartbeatTimer);
      signal?.removeEventListener('abort', onExternalAbort);
      await heartbeatChain;
    }
    controllers.delete(run.runId);
    if (execution.sessionId) {
      sessionId = execution.sessionId;
      await requestHeartbeat({ sessionId });
    }

    const currentState = await service.getWorkItem(item.workItemId);
    if (
      currentState.ok &&
      currentState.workItem.executionState === 'WAITING_FOR_USER' &&
      currentState.attention
    )
      return {
        ok: true,
        status: 'waiting',
        workItemId: item.workItemId,
        runId: run.runId,
        attention: currentState.attention,
        sessionId,
      };

    if (budgetLimit) {
      const attention = await raiseAttention(item, {
        type: 'BUDGET',
        reason: `Execution reached ${budgetLimit}.`,
        question: 'Increase the budget and resume, or cancel the WorkItem?',
        actions: ['resume', 'cancel'],
        payload: {
          budgetLimit,
          usage: budgetSnapshot(),
          sessionId,
          summary: `Execution reached ${budgetLimit}. Usage: ${JSON.stringify(budgetSnapshot())}.`,
          risks: ['Further execution may consume more model, time or tool budget.'],
          evidence: [`budget:${budgetLimit}`],
        },
      });
      return attention.ok
        ? {
            ok: true,
            status: 'waiting',
            workItemId: item.workItemId,
            runId: run.runId,
            attention: attention.attention,
            sessionId,
          }
        : attention;
    }

    const waiting = parseWaitingMarker(events);
    if (waiting) {
      const current = await service.getWorkItem(item.workItemId);
      if (!current.ok) return current;
      const requested = await service.requestAttention({
        workItemId: item.workItemId,
        expectedVersion: current.workItem.revision,
        type: waiting.type,
        reason: waiting.reason,
        question: waiting.question,
        actions: waiting.actions,
        summary: waiting.summary,
        risks: waiting.risks,
        evidence: waiting.evidence,
        artifactHash: waiting.artifactHash,
      });
      if (!requested.ok) return requested;
      return {
        ok: true,
        status: 'waiting',
        workItemId: item.workItemId,
        runId: run.runId,
        attention: requested.attention,
        sessionId,
      };
    }

    if (heartbeatError && ['RUN_STOPPED', 'LEASE_INVALID'].includes(heartbeatError.code))
      return {
        ...heartbeatError,
        status: 'stopped',
        workItemId: item.workItemId,
        runId: run.runId,
        sessionId,
      };

    if (stopped || signal?.aborted) {
      const interrupted = await service.interruptRun({
        runId: run.runId,
        leaseToken: claimed.lease.token,
        reason: 'SUPERVISOR_STOPPED',
      });
      return interrupted.ok
        ? {
            ok: true,
            status: 'interrupted',
            workItemId: item.workItemId,
            runId: run.runId,
            sessionId,
          }
        : interrupted;
    }

    if (!execution.ok) {
      const finished = await service.finishRun({
        runId: run.runId,
        leaseToken: claimed.lease.token,
        status: 'FAILED',
        error: execution.code || 'CODEX_EXECUTION_FAILED',
      });
      if (!finished.ok) return finished;
      const attention = await raiseAttention(item, {
        type: 'FAILED',
        reason: 'Codex execution could not continue safely.',
        question: 'Retry, request changes, or cancel this WorkItem?',
        actions: ['retry', 'request_changes', 'cancel'],
        payload: {
          error: execution.code || 'CODEX_EXECUTION_FAILED',
          summary: execution.message || 'Execution failed.',
          sessionId,
        },
      });
      return {
        ...execution,
        status: 'failed',
        workItemId: item.workItemId,
        runId: run.runId,
        attention: attention.ok ? attention.attention : null,
        sessionId,
      };
    }

    if (heartbeatError) {
      await service.finishRun({
        runId: run.runId,
        leaseToken: claimed.lease.token,
        status: 'FAILED',
        error: heartbeatError.code,
      });
      return heartbeatError;
    }

    let delivery = null;
    try {
      const resolved = await deliveryResolver({ projectRoot: item.projectRoot });
      if (resolved.ok && (resolved.delivery || resolved.deliveryId))
        delivery = {
          deliveryId: resolved.deliveryId || resolved.delivery?.deliveryId,
          projectId: resolved.delivery?.projectId || null,
          recordHash: resolved.recordHash || null,
          deliveryCommit: resolved.delivery?.deliveryCommit || null,
          releaseState: resolved.delivery?.releaseState || resolved.releaseState,
          customerAccepted:
            resolved.delivery?.releaseState === 'customer-accepted' &&
            resolved.delivery?.customerAcceptance?.status === 'accepted',
        };
    } catch {
      delivery = null;
    }
    const finished = await service.finishRun({
      runId: run.runId,
      leaseToken: claimed.lease.token,
      status: 'COMPLETED',
      outcome: {
        summary: delivery
          ? 'Codex execution completed and a DeliveryRecord is linked for review.'
          : 'Codex execution completed without a DeliveryRecord.',
        sessionId,
        delivery,
      },
    });
    if (!finished.ok) return finished;
    const acceptanceAvailable = delivery && !delivery.customerAccepted;
    const attention = await raiseAttention(item, {
      type: 'COMPLETION',
      reason: 'The AI execution reached a final stop point.',
      question: acceptanceAvailable
        ? 'Review the Outcome, then request changes or confirm delivery acceptance?'
        : 'Review the Outcome and request changes if needed.',
      actions: acceptanceAvailable ? ['request_changes', 'accept_delivery'] : ['request_changes'],
      payload: {
        summary: delivery
          ? 'Execution completed and the DeliveryRecord is linked. Review structured Evidence before acceptance.'
          : 'Execution completed, but no DeliveryRecord is available for customer acceptance.',
        risks: delivery ? [] : ['Customer acceptance is unavailable without a DeliveryRecord.'],
        evidence: delivery ? [`delivery:${delivery.deliveryId}`] : [],
        sessionId,
      },
    });
    logger({ event: 'work_item.completed', workItemId: item.workItemId, runId: run.runId });
    return {
      ok: true,
      status: 'completed',
      workItemId: item.workItemId,
      runId: run.runId,
      attention: attention.ok ? attention.attention : null,
      sessionId,
    };
  }

  return Object.freeze({
    runOnce,
    activeCount: () => controllers.size,
    stop() {
      stopped = true;
      for (const { controller } of controllers.values()) controller.abort();
    },
  });
}
