import path from 'node:path';
import { invalidateFrom, readGate } from './gates.js';
import { changeDir } from './openspec.js';
import {
  dispatchChange,
  runFormatAgent,
  runReviewAgent,
  runTestAgent,
} from './dispatch.js';
import { loadProject } from './project.js';
import { recordQualityResult, isQualityBlocked } from './quality.js';
import {
  currentRequirementChange,
  readRequirements,
  validateTestReport,
} from './requirements.js';
import { validateFormatReport, validateReviewReport } from './format.js';
import { inferTaskRoles, rolesToPrompt } from './roles.js';
import { buildWaves, parseTasks } from './task-graph.js';
import { readIfExists } from './util.js';

function roleContext(root, change) {
  const dir = changeDir(root, change);
  const requirements = readRequirements(root);
  return [
    requirements?.goals,
    requirements?.body,
    readIfExists(path.join(dir, 'change.md')),
    readIfExists(path.join(dir, 'change.json')),
    readIfExists(path.join(dir, 'design.md')),
  ]
    .filter(Boolean)
    .join('\n');
}

function nextStage(gate) {
  return {
    G7: 'G7.5',
    'G7.5': 'G8',
    G8: 'G9',
    G9: 'G10',
  }[gate] || null;
}

export async function applyChange(options) {
  const {
    root,
    change,
    parent,
    runner,
    planOnly = false,
    language = 'zh',
    maxConcurrency = 4,
  } = options;
  const projectRoot = path.resolve(root);
  const project = loadProject(projectRoot);
  if (!project.isV2) throw new Error('sg-apply v2 需要 requirements/REQUIREMENTS.md');
  const active = currentRequirementChange(projectRoot);
  if (!active || active.change !== change) throw new Error(`当前没有匹配的需求变更：${change}`);
  const tasksText = readIfExists(path.join(changeDir(projectRoot, change), 'tasks.md'));
  if (tasksText === null) throw new Error(`tasks.md 不存在：${change}`);
  const tasks = parseTasks(tasksText);
  const open = tasks.filter((task) => !task.done);
  const context = roleContext(projectRoot, change);
  const roles = inferTaskRoles(open, context);

  if (planOnly) {
    return {
      ok: true,
      planOnly: true,
      change,
      stage: open.length > 0 ? 'dev' : !readGate(projectRoot, 'G7.5').satisfied ? 'format' : !readGate(projectRoot, 'G8').satisfied ? 'test' : !readGate(projectRoot, 'G9').satisfied ? 'review' : 'done',
      roles: roles.results.map((entry) => ({
        id: entry.task.id,
        title: entry.task.title,
        role: entry.role,
        explicit: entry.explicit,
        confidence: entry.confidence,
        scores: entry.scores,
      })),
      unresolved: roles.unresolved.map((entry) => entry.task.id),
      waves: open.length > 0 ? buildWaves(tasks, maxConcurrency).map((wave) => wave.map((task) => task.id)) : [],
      text: roles.unresolved.length > 0 ? rolesToPrompt(roles.unresolved) : '计划可用',
    };
  }

  if (isQualityBlocked(projectRoot)) {
    return { ok: false, blocked: true, text: '质量阶段已阻塞（同一阶段失败 2 次）；请修复后清理 .specgate/state/quality.json 或重新确认。' };
  }

  if (open.length > 0) {
    if (!readGate(projectRoot, 'G7').satisfied) {
      return { ok: false, stage: 'dev', nextGate: 'G7', text: 'G7 尚未确认；确认 G7 后才能进入实施。' };
    }
    if (roles.unresolved.length > 0) {
      return {
        ok: false,
        stage: 'dev',
        unresolved: roles.unresolved.map((entry) => entry.task.id),
        text: rolesToPrompt(roles.unresolved),
      };
    }
    const roleOverrides = Object.fromEntries(
      roles.results.filter((entry) => entry.role).map((entry) => [entry.task.id, entry.role]),
    );
    const report = await dispatchChange({
      root: projectRoot,
      change,
      parent,
      runner,
      maxConcurrency,
      roleOverrides,
    });
    return {
      ok: report.ok,
      stage: 'dev',
      report,
      nextGate: 'G7.5',
      text: report.ok
        ? '开发阶段完成；再次执行 sg-apply 进入格式化/Lint（G7.5）。'
        : '开发阶段存在失败；查看报告。',
    };
  }

  if (!readGate(projectRoot, 'G7').satisfied) {
    return { ok: false, stage: 'dev', nextGate: 'G7', text: '开发任务已完成但 G7 尚未确认；先确认 G7。' };
  }

  if (!readGate(projectRoot, 'G7.5').satisfied) {
    const existing = validateFormatReport(projectRoot, change);
    if (existing.ok) {
      return { ok: true, stage: 'format', nextGate: 'G7.5', text: '格式化报告已通过；请确认 G7.5。' };
    }
    const result = await runFormatAgent({ root: projectRoot, change, parent, runner, language });
    recordQualityResult(projectRoot, 'format', result.ok, result.text);
    return {
      ok: result.ok,
      stage: 'format',
      result,
      nextGate: 'G7.5',
      text: result.ok ? '格式化/Lint 完成；停在 G7.5，请确认后继续 sg-apply。' : result.text,
    };
  }

  if (!readGate(projectRoot, 'G8').satisfied) {
    const existing = validateTestReport(projectRoot, change, {
      minLineCoverage: project.config.minLineCoverage,
      minBranchCoverage: project.config.minBranchCoverage,
    });
    if (existing.ok) {
      return { ok: true, stage: 'test', nextGate: 'G8', text: '测试报告已通过；请确认 G8。' };
    }
    const result = await runTestAgent({
      root: projectRoot,
      change,
      parent,
      runner,
      action: 'run',
      language,
    });
    recordQualityResult(projectRoot, 'test', result.ok, result.text);
    if (!result.ok) invalidateFrom(projectRoot, 'G7.5');
    return {
      ok: result.ok,
      stage: 'test',
      result,
      nextGate: 'G8',
      text: result.ok ? '测试完成；停在 G8，请确认后继续 sg-apply。' : result.text,
    };
  }

  if (!readGate(projectRoot, 'G9').satisfied) {
    const existing = validateReviewReport(projectRoot, change);
    if (existing.ok) {
      return { ok: true, stage: 'review', nextGate: 'G9', text: '审查报告已通过；请确认 G9。' };
    }
    const result = await runReviewAgent({ root: projectRoot, change, parent, runner, language });
    recordQualityResult(projectRoot, 'review', result.ok, result.text);
    if (!result.ok) invalidateFrom(projectRoot, 'G7.5');
    return {
      ok: result.ok,
      stage: 'review',
      result,
      nextGate: 'G9',
      text: result.ok ? '代码审查完成；停在 G9，请确认后继续。' : result.text,
    };
  }

  return { ok: true, stage: 'done', nextGate: 'G10', text: 'G9 已确认；进入 G10 验收。' };
}

export function renderApplyResult(result, language = 'zh') {
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  if (result.planOnly) {
    return [
      en ? `Plan for ${result.change} (stage ${result.stage})` : `${result.change} 计划（阶段 ${result.stage}）`,
      ...result.roles.map(
        (role) =>
          `  ${role.id}: ${role.role || 'UNRESOLVED'}${role.explicit ? ' (explicit)' : ` (score ${role.confidence})`}`,
      ),
      ...(result.unresolved.length > 0 ? ['', result.text] : []),
    ].join('\n');
  }
  return result.text || (result.ok ? '完成' : '失败');
}
