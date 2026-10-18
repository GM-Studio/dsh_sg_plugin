import { GATE_ORDER, GATES, PARADIGM_LABELS } from './constants.js';
import { gateLabel } from './config.js';
import { countDeviations } from './deviations.js';
import { formatGitStatus, gitStatus } from './git.js';
import { gateRequiredForParadigm, gateSummary } from './gates.js';
import { listChanges, projectState } from './openspec.js';
import { loadProject } from './project.js';
import { currentRequirementChange, readRequirements, testPaths } from './requirements.js';
import { readIfExists } from './util.js';

const cache = new Map();
const CACHE_TTL_MS = 400;

function effectiveParadigm(project) {
  return project.paradigm || 'L1';
}

function pickCurrentChange(changes) {
  if (changes.length === 0) return null;
  return (
    changes.find((change) => change.state === 'implementing') ||
    changes.find((change) => change.state === 'reviewing') ||
    changes[0]
  );
}

export function computeStatus(root, options = {}) {
  const key = root;
  const now = Date.now();
  if (!options.fresh) {
    const cached = cache.get(key);
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  }

  const project = loadProject(root);
  const paradigm = effectiveParadigm(project);
  const changes = listChanges(project.root, paradigm);
  const gateInfo = gateSummary(project.root);
  const currentChange = pickCurrentChange(changes);
  const requirements = project.isV2 ? readRequirements(project.root) : null;
  const requirementChange = project.isV2 ? currentRequirementChange(project.root) : null;
  const testReport = project.isV2 && requirementChange
    ? readIfExists(testPaths(project.root, requirementChange.change).report)
    : null;
  const uninitialized = !project.hasSpecgate && !project.hasMaterializedSkills;
  const git = gitStatus(project.root);

  let nextStep;
  if (uninitialized) {
    nextStep = {
      action: 'init',
      text: '项目未初始化：执行 /sg-init 或调用 sg_init 生成 .specgate/、openspec/、AGENTS.md',
    };
  } else if (!project.enabled) {
    nextStep = {
      action: 'enable',
      text: 'SpecGate 已初始化但已停用：执行 /sg-enable 恢复门控与提示',
    };
  } else if (currentChange) {
    nextStep = currentChange.nextStep;
  } else {
    const required = (gate) => gateRequiredForParadigm(gate, paradigm);
    const gateValue = (gate) => gateInfo.gates.find((item) => item.id === gate);
    const missing = [];
    if (required('G1') && !gateValue('G1').satisfied) missing.push('G1');
    if (required('G2') && !gateValue('G2').satisfied) missing.push('G2');
    nextStep = {
      action: 'create-change',
      text:
        missing.length > 0
          ? `先完成 ${missing.join('/')}，然后创建 ${project.isV2 ? 'requirements/changes/<name>/change.md' : 'openspec/changes/<name>/proposal.md'}`
          : project.isV2
            ? '创建新需求变更：执行 /sg-change <name>（G1/G2 已确认）'
            : '创建新 Change：执行 /sg-propose <name>（G1/G2 已确认）',
    };
  }

  const pendingRequired = gateInfo.gates
    .filter((gate) => gateRequiredForParadigm(gate.id, paradigm) && !gate.satisfied)
    .map((gate) => gate.id);

  const status = {
    root: project.root,
    enabled: project.enabled,
    uninitialized,
    paradigm: project.paradigm,
    paradigmLabel: project.paradigm ? PARADIGM_LABELS[project.paradigm] : '未分类',
    enforcement: project.enforcement,
    gitEnabled: project.gitEnabled,
    git,
    minimal: project.minimal,
    projectState: projectState(project.root, changes),
    isV2: project.isV2,
    requirements: requirements
      ? {
          version: requirements.version,
          status: requirements.status,
          change: requirements.changeId,
        }
      : null,
    requirementChange: requirementChange
      ? { name: requirementChange.change, version: requirementChange.version || null }
      : null,
    testReport: testReport ? { path: testPaths(project.root, requirementChange.change).report } : null,
    changes,
    currentChange,
    gates: gateInfo.gates,
    confirmedGates: gateInfo.confirmed,
    waivedGates: gateInfo.waived,
    pendingGates: gateInfo.pending,
    pendingRequired,
    nextStep,
    deviations: countDeviations(project.root),
    timestamp: new Date().toISOString(),
  };

  cache.set(key, { at: now, value: status });
  return status;
}

export function invalidateStatusCache(root) {
  cache.delete(root);
}

export function clearStatusCache() {
  cache.clear();
}

export function currentGate(status) {
  const gate = status.gates.find(
    (item) => gateRequiredForParadigm(item.id, status.paradigm || 'L1') && !item.satisfied,
  );
  return gate ? gate.id : null;
}

export function renderStatus(status, language = 'zh') {
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  const lines = [];
  lines.push(en ? 'SpecGate status' : 'SpecGate 状态');
  lines.push(en ? `Project: ${status.root}` : `项目：${status.root}`);
  lines.push(
    en
      ? `Enabled: ${status.enabled ? 'yes' : 'no'} | Paradigm: ${status.paradigm || 'unclassified'} | Mode: ${status.enforcement}`
      : `启用：${status.enabled ? '是' : '否'} ｜ 范式：${status.paradigm || '未分类'} ｜ 模式：${status.enforcement}`,
  );
  lines.push(formatGitStatus(status.git || { isRepo: false }, language));
  if (status.requirements) {
    lines.push(
      en
        ? `Requirements: v${status.requirements.version} (${status.requirements.status})${status.requirementChange ? ` | change ${status.requirementChange.name}` : ''}${status.testReport ? ' | test report present' : ''}`
        : `需求版本：v${status.requirements.version}（${status.requirements.status}）${status.requirementChange ? ` ｜ change ${status.requirementChange.name}` : ''}${status.testReport ? ' ｜ 已有测试报告' : ''}`,
    );
  }
  if (status.uninitialized) {
    lines.push(en ? 'Initialization: not initialized (/sg-init)' : '初始化：未初始化（/sg-init）');
  } else if (!status.enabled) {
    lines.push(en ? 'Initialization: initialized but disabled (/sg-enable)' : '初始化：已初始化但已停用（/sg-enable）');
  }
  lines.push(en ? `Project state: ${status.projectState}` : `项目阶段：${status.projectState}`);
  lines.push('');
  if (status.changes.length === 0) {
    lines.push(en ? 'Changes: none' : 'Change：无');
  } else {
    lines.push(en ? `Changes (${status.changes.length}):` : `Change（${status.changes.length}）：`);
    for (const change of status.changes) {
      const marker = status.currentChange && change.name === status.currentChange.name ? '*' : ' ';
      lines.push(
        `${marker} ${change.name}  [${change.state}]  tasks ${change.tasks.done}/${change.tasks.total}`,
      );
      lines.push(
        `    proposal=${change.artifacts.proposal} design=${change.artifacts.design} specs=${change.artifacts.specs} tasks=${change.artifacts.tasks}`,
      );
    }
  }
  lines.push('');
  lines.push(en ? 'Gates:' : '门控：');
  for (const gate of status.gates) {
    let state = en ? 'pending' : '待确认';
    if (gate.confirmed) state = en ? 'confirmed' : '已确认';
    else if (gate.waived) state = en ? `waived (${gate.reason || 'no reason'})` : `已跳过（${gate.reason || '未记录原因'}）`;
    else if (gate.id === 'G6.5' && !gateRequiredForParadigm(gate.id, status.paradigm || 'L1')) {
      state = en ? 'optional' : '可选';
    }
    lines.push(`  ${gate.id.padEnd(4)} ${gateLabel(gate.id, language)}：${state}`);
  }
  lines.push('');
  lines.push(en ? `Next: ${nextStepText(status, language)}` : `下一步：${status.nextStep.text}`);
  lines.push(en ? `Deviations: ${status.deviations}` : `偏离记录：${status.deviations} 条`);
  return lines.join('\n');
}

export function renderNext(status, language = 'zh') {
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  const gate = currentGate(status);
  return [
    en ? `Next: ${nextStepText(status, language)}` : `下一步：${status.nextStep.text}`,
    gate
      ? en
        ? `Pending gate: ${gate} (${gateLabel(gate, language)})`
        : `当前待确认门控：${gate}（${GATES[gate]?.name || gate}）`
      : en
        ? 'No required gate is pending'
        : '当前无必需门控待确认',
    formatGitStatus(status.git || { isRepo: false }, language),
    en
      ? 'Status: /sg-status | Gates: /sg-gate <Gx> | Commit: /sg-commit <message>'
      : '状态查询：/sg-status ｜ 门控操作：/sg-gate <Gx> ｜ 提交：/sg-commit <message>',
  ].join('\n');
}

function nextStepText(status, language = 'zh') {
  if (String(language || 'zh').toLowerCase().startsWith('en')) {
    if (status.uninitialized) return 'Project is not initialized; run /sg-init.';
    if (!status.enabled) return 'SpecGate is disabled; run /sg-enable.';
    if (status.nextStep.action === 'create-change') {
      return 'Confirm G1/G2, then create openspec/changes/<name>/proposal.md.';
    }
    if (status.currentChange) {
      return `Continue ${status.currentChange.name}: inspect its artifacts and gates.`;
    }
    return 'Run /sg-next to inspect the next gate.';
  }
  return status.nextStep.text;
}

export function statusSummary(status) {
  const gate = currentGate(status);
  return {
    root: status.root,
    enabled: status.enabled,
    uninitialized: status.uninitialized,
    paradigm: status.paradigm,
    projectState: status.projectState,
    requirementsVersion: status.requirements?.version || null,
    requirementChange: status.requirementChange?.name || null,
    currentChange: status.currentChange?.name || null,
    currentGate: gate,
    nextStep: status.nextStep.text,
    pendingGates: status.pendingGates,
    deviations: status.deviations,
    git: {
      isRepo: status.git?.isRepo || false,
      branch: status.git?.branch || null,
      dirty: status.git?.dirty || 0,
      lastCommit: status.git?.lastCommit || null,
    },
  };
}

export function promptTextFor(root, language = 'zh') {
  let status;
  try {
    status = computeStatus(root);
  } catch {
    return '';
  }
  if (!status.enabled) return '';
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  const gate = currentGate(status);
  if (en) {
    return [
      'SpecGate workflow is enabled.',
      `Paradigm: ${status.paradigm || 'unclassified'}; project state: ${status.projectState}.`,
      formatGitStatus(status.git || { isRepo: false }, 'en'),
      status.currentChange
        ? `Current change: ${status.currentChange.name} (${status.currentChange.state}, tasks ${status.currentChange.tasks.done}/${status.currentChange.tasks.total}).`
        : 'No active change.',
      gate ? `Pending gate: ${gate} ${gateLabel(gate, 'en')}.` : 'No required gate is pending.',
      `Next: ${nextStepText(status, 'en')}`,
      'Hard rules: proposal needs G1/G2; design needs G3; specs need G4; tasks need G5; source needs G6/G7.',
      'Commit discipline: the working tree must be clean before every gate; use /sg-commit <message>.',
      'Skipping a gate requires the sg_gate waive action and a .specgate/deviations.log entry.',
      'Advance one gate at a time; "continue" does not skip a gate.',
    ].join('\n');
  }
  return [
    'SpecGate 工作流已启用。',
    `范式：${status.paradigm || '未分类'}；项目阶段：${status.projectState}。`,
    formatGitStatus(status.git || { isRepo: false }),
    status.currentChange
      ? `当前 Change：${status.currentChange.name}（${status.currentChange.state}，tasks ${status.currentChange.tasks.done}/${status.currentChange.tasks.total}）。`
      : '当前没有活跃 Change。',
    gate ? `当前待确认门控：${gate} ${GATES[gate]?.name || ''}。` : '当前无必需门控待确认。',
    `下一步：${status.nextStep.text}`,
    '硬规则：写 proposal 前需 G1/G2；写 design 前需 G3；写 specs 前需 G4；写 tasks 前需 G5；写源码前需 G6/G7。',
    '提交纪律：每个门控确认前工作区必须 clean；用 /sg-commit <message> 提交。',
    '跳过门控必须调用 sg_gate 的 waive 动作，并写入 .specgate/deviations.log。',
    '一次只推进一个门控；用户说“继续”不等于跳过门控。',
  ].join('\n');
}

export function gateOrder() {
  return GATE_ORDER;
}
