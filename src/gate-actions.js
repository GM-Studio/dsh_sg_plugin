import { GATE_REQUIRES, GATES } from './constants.js';
import { appendDeviation } from './deviations.js';
import {
  confirmGate,
  formatGateStatus,
  gateRequiredForParadigm,
  invalidateFrom,
  missingGates,
  readGate,
  waiveGate,
} from './gates.js';
import { gitClean } from './git.js';
import { loadProject } from './project.js';
import {
  applyRequirementChange,
  currentRequirementChange,
  isRequirementsProject,
  validateTestPlan,
  validateTestReport,
} from './requirements.js';
import { validateFormatReport, validateReviewReport } from './format.js';
import { invalidateStatusCache } from './status.js';

function requirementPreflight(root, gate, language = 'zh') {
  if (!isRequirementsProject(root)) return { ok: true };
  if (!['G5', 'G7.5', 'G8', 'G9'].includes(gate)) return { ok: true };
  const change = currentRequirementChange(root);
  if (!change) {
    return { ok: false, text: '当前没有需求变更包；先执行 /sg-change <name>。' };
  }
  if (gate === 'G5') {
    const plan = validateTestPlan(root, change.change);
    if (!plan.ok) return { ok: false, text: plan.reason };
  }
  if (gate === 'G7.5') {
    const format = validateFormatReport(root, change.change);
    if (!format.ok) return { ok: false, text: format.reason };
  }
  if (gate === 'G8') {
    const project = loadProject(root);
    const report = validateTestReport(root, change.change, {
      minLineCoverage: project.config.minLineCoverage,
      minBranchCoverage: project.config.minBranchCoverage,
    });
    if (!report.ok) return { ok: false, text: report.reason };
  }
  if (gate === 'G9') {
    const review = validateReviewReport(root, change.change);
    if (!review.ok) return { ok: false, text: review.reason };
  }
  return { ok: true, change };
}

function applyRequirementAfterConfirm(root, gate) {
  if (!isRequirementsProject(root) || gate !== 'G3') return { ok: true };
  const change = currentRequirementChange(root);
  if (!change) return { ok: true };
  try {
    const applied = applyRequirementChange(root, change.change);
    return { ok: true, version: applied.version };
  } catch (error) {
    invalidateFrom(root, 'G3');
    return { ok: false, text: `需求版本落盘失败：${error.message}` };
  }
}

function checkGit(root, language = 'zh') {
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  const project = loadProject(root);
  if (!project.gitEnabled) {
    return {
      ok: true,
      warning: en ? 'Warning: Git is disabled; commit discipline is inactive.' : '警告：Git 未启用，提交纪律未生效。',
    };
  }
  const clean = gitClean(root);
  if (!clean.ok) {
    const files = Array.isArray(clean.status?.changes)
      ? clean.status.changes.slice(0, 5).join('; ')
      : '';
    if (en) {
      return {
        ok: false,
        text: `The working tree is not clean${files ? ` (${files})` : ''}. Run /sg-commit <message> or git commit before confirming a gate.`,
      };
    }
    return {
      ok: false,
      text: `${clean.message}${files ? `（${files}）` : ''}。请先 /sg-commit <message> 或手工 git commit，再确认门控。`,
    };
  }
  return { ok: true, warning: null };
}

async function ask(ctx, agent, signal, header, question, options, waitOptions = {}) {
  let userQuestions;
  try {
    userQuestions = ctx.get('userQuestions');
  } catch {
    return { unavailable: true };
  }
  if (!userQuestions) return { unavailable: true };
  const request = {
    questions: [{ id: 'sg-gate', header, question, options }],
    agent,
    signal,
  };
  try {
    let answer;
    if (waitOptions.callId && typeof userQuestions.askTimed === 'function') {
      answer = await userQuestions.askTimed(
        request,
        waitOptions.callId,
        waitOptions.timeoutMs || 120000,
      );
      if (answer?.pending) return { pending: true };
    } else {
      answer = await userQuestions.ask(request);
    }
    const item = answer?.answers?.[0];
    return { selected: item?.selected?.[0] || null, custom: item?.custom || null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function performGateAction(ctx, agent, signal, root, args = {}) {
  const language = args.language || loadProject(root).language || 'zh';
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  const l = (zh, value) => (en ? value : zh);
  const gate = String(args.gate || '').trim();
  if (!GATES[gate]) {
    return {
      ok: false,
      text: en
        ? `Unknown gate: ${gate}. Available: ${Object.keys(GATES).join(', ')}`
        : `未知门控：${gate}。可用：${Object.keys(GATES).join('、')}`,
    };
  }
  const action = args.action || 'status';

  if (action === 'status') {
    const status = readGate(root, gate);
    return {
      ok: true,
      text: `${formatGateStatus(status, language)}${status.reason ? `\n${l('原因', 'Reason')}: ${status.reason}` : ''}`,
      gate: status,
    };
  }

  if (action === 'confirm') {
    const paradigm = loadProject(root).paradigm;
    const prerequisites = (GATE_REQUIRES[gate] || []).filter((item) =>
      gateRequiredForParadigm(item, paradigm),
    );
    const missing = missingGates(root, prerequisites);
    if (missing.length > 0) {
      return {
        ok: false,
        text: en
          ? `Cannot confirm ${gate}: missing prerequisite gates ${missing.join(', ')}. Complete them first.`
          : `无法确认 ${gate}：缺少前置门控 ${missing.join('、')}。请先完成前置门控。`,
      };
    }
    const git = checkGit(root, language);
    if (!git.ok) return { ok: false, text: git.text };

    const preflight = requirementPreflight(root, gate, language);
    if (!preflight.ok) return { ok: false, text: preflight.text };

    if (args.interactive === false) {
      if (args.confirmed !== true) {
        return {
          ok: false,
          requiresConfirmation: true,
          text: [
            formatGateStatus(readGate(root, gate), language),
            `${gate} ${l(GATES[gate].name, GATES[gate].nameEn || GATES[gate].name)}: ${l(GATES[gate].ask, GATES[gate].askEn || GATES[gate].ask)}`,
            en ? `Run /sg-gate ${gate} confirm --yes to confirm.` : `确认请执行：/sg-gate ${gate} confirm --yes`,
            en ? `Run /sg-gate ${gate} status to keep reviewing.` : `返回修改请执行：/sg-gate ${gate} status`,
          ].join('\n'),
        };
      }
    } else {
      const approve = en ? 'Approve' : '通过';
      const reject = en ? 'Request changes' : '需要修改';
      const result = await ask(
        ctx,
        agent,
        signal,
        `SpecGate ${gate}`,
        en
          ? `${gate} ${GATES[gate].nameEn || GATES[gate].name}: ${GATES[gate].askEn || GATES[gate].ask} Approve?`
          : `${gate} ${GATES[gate].name}：${GATES[gate].ask} 是否通过？`,
        en
          ? [
              { label: approve, description: 'Record the confirmation and continue' },
              { label: reject, description: 'Do not record; revise and review again' },
            ]
          : [
              { label: approve, description: '记录确认并继续' },
              { label: reject, description: '不记录，返回修改后重新评审' },
            ],
        { callId: args.callId },
      );
      if (result.unavailable) {
        return {
          ok: false,
          text: en
            ? `Structured confirmation is unavailable. Ask the user to reply "approve", then retry /sg-gate ${gate} confirm --yes.`
            : `当前环境不支持结构化确认。请让用户明确回复“通过”后，使用 /sg-gate ${gate} confirm --yes 重试。`,
        };
      }
      if (result.pending) {
        return {
          ok: false,
          text: en
            ? `${gate} confirmation timed out; the marker was not written. Ask again with ask_user_question, or run /sg-gate ${gate} confirm --yes.`
            : `${gate} 等待用户确认超时，未写入标记。请使用 ask_user_question 再次询问，或让用户执行 /sg-gate ${gate} confirm --yes。`,
        };
      }
      if (result.error) return { ok: false, text: `${l('确认失败', 'Confirmation failed')}: ${result.error}` };
      if (result.selected !== approve) {
        return {
          ok: false,
          text: en
            ? `${gate} not approved: user selected "${result.selected || 'nothing'}".`
            : `${gate} 未通过：用户选择“${result.selected || '未选择'}”。`,
        };
      }
    }

    const status = confirmGate(root, gate);
    invalidateStatusCache(root);
    const applied = applyRequirementAfterConfirm(root, gate);
    if (!applied.ok) return { ok: false, text: applied.text };
    return {
      ok: true,
      text: `${l('已确认', 'Confirmed')} ${gate} ${l(GATES[gate].name, GATES[gate].nameEn || GATES[gate].name)}。${applied.version ? `\n${l('需求版本', 'Requirement version')}: ${applied.version}` : ''}${git.warning ? `\n${git.warning}` : ''}`,
      gate: status,
    };
  }

  if (action === 'waive') {
    const reason = String(args.reason || '').trim();
    if (!reason) {
      return {
        ok: false,
        text: en
          ? `Waiving ${gate} requires a reason and writes .specgate/deviations.log.`
          : `跳过 ${gate} 必须提供 reason（原因），并写入 .specgate/deviations.log。`,
      };
    }
    const git = checkGit(root, language);
    if (!git.ok) return { ok: false, text: git.text };

    if (args.interactive === false) {
      if (args.confirmed !== true) {
        return {
          ok: false,
          requiresConfirmation: true,
          text: [
            en
              ? `Waive ${gate} ${GATES[gate].nameEn || GATES[gate].name} and record a deviation? Reason: ${reason}`
              : `确认跳过 ${gate} ${GATES[gate].name} 并记录偏离？原因：${reason}`,
            en ? `Run /sg-gate ${gate} waive --yes ${reason} to confirm.` : `确认请执行：/sg-gate ${gate} waive --yes ${reason}`,
            en ? 'Ignore this prompt to cancel.' : '取消请忽略本提示。',
          ].join('\n'),
        };
      }
    } else {
      const approve = en ? 'Confirm waive' : '确认跳过';
      const result = await ask(
        ctx,
        agent,
        signal,
        `SpecGate ${gate}`,
        en
          ? `Waive ${gate} ${GATES[gate].nameEn || GATES[gate].name} and record a deviation? Reason: ${reason}`
          : `确认跳过 ${gate} ${GATES[gate].name} 并记录偏离？原因：${reason}`,
        en
          ? [
              { label: approve, description: 'Write the deviation log and waived marker' },
              { label: 'Cancel', description: 'Do not waive; return to the gate' },
            ]
          : [
              { label: approve, description: '写入偏离日志和 waived 标记' },
              { label: '取消', description: '不跳过，返回门控' },
            ],
        { callId: args.callId },
      );
      if (result.unavailable) {
        return {
          ok: false,
          text: en
            ? 'Structured confirmation is unavailable; refusing to waive a gate unsafely.'
            : '当前环境不支持结构化确认，无法安全跳过门控。',
        };
      }
      if (result.pending) {
        return {
          ok: false,
          text: en
            ? `${gate} waiver timed out; the gate was not waived. Ask again with ask_user_question, or run /sg-gate ${gate} waive --yes ${reason}.`
            : `${gate} 等待用户确认超时，未跳过门控。请使用 ask_user_question 再次询问，或让用户执行 /sg-gate ${gate} waive --yes ${reason}。`,
        };
      }
      if (result.error) return { ok: false, text: `${l('跳过失败', 'Waiver failed')}: ${result.error}` };
      if (result.selected !== approve) {
        return { ok: false, text: `${gate} ${l('未跳过', 'was not waived')}。` };
      }
    }

    appendDeviation(root, { gate, reason, impact: args.impact || 'medium' });
    const status = waiveGate(root, gate, reason);
    invalidateStatusCache(root);
    return {
      ok: true,
      text: `${l('已跳过', 'Waived')} ${gate} ${l(GATES[gate].name, GATES[gate].nameEn || GATES[gate].name)}；${l('偏离已写入 .specgate/deviations.log', 'deviation written to .specgate/deviations.log')}。${git.warning ? `\n${git.warning}` : ''}`,
      gate: status,
    };
  }

  return {
    ok: false,
    text: en
      ? `Unknown action: ${action} (use status / confirm / waive)`
      : `未知动作：${action}（可用 status / confirm / waive）`,
  };
}
