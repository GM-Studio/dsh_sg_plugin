import path from 'node:path';
import { GATE_ORDER } from './constants.js';
import { readDeviations } from './deviations.js';
import { formatGitStatus, gitStatus } from './git.js';
import { readGate } from './gates.js';
import { findStaleLocks } from './idempotency.js';
import { listChanges } from './openspec.js';
import { loadProject } from './project.js';
import { computeStatus } from './status.js';
import { exists, readIfExists, walkFiles } from './util.js';

function issue(level, code, message, fix) {
  return { level, code, message, fix };
}

export function runDoctor(root) {
  const project = loadProject(root);
  const status = computeStatus(project.root, { fresh: true });
  const issues = [];
  const checks = [];

  checks.push({ name: 'project-root', ok: true, detail: project.root });
  checks.push({ name: 'specgate-dir', ok: project.hasSpecgate, detail: project.specgateDir });
  checks.push({ name: 'openspec-dir', ok: exists(path.join(project.root, 'openspec')), detail: path.join(project.root, 'openspec') });

  const git = gitStatus(project.root);
  checks.push({
    name: 'git-repo',
    ok: git.isRepo,
    detail: git.isRepo ? `${git.branch || '(no branch)'}${git.lastCommit ? ` @ ${git.lastCommit.hash}` : ''}` : '未初始化',
  });
  if (!git.isRepo && project.gitEnabled) {
    issues.push(
      issue('error', 'GIT_NOT_INITIALIZED', 'Git 未初始化；门控提交纪律无法执行', '执行 /sg-init 或 git init 后提交'),
    );
  } else if (!git.isRepo && !project.gitEnabled) {
    issues.push(
      issue('warn', 'GIT_DISABLED', 'Git 未启用（--no-git）；提交纪律未生效', '需要时执行 /sg-enable 并手工 git init'),
    );
  }
  if (git.isRepo && git.dirty > 0) {
    issues.push(
      issue(
        'warn',
        'GIT_DIRTY',
        `工作区有 ${git.dirty} 个未提交改动`,
        '执行 /sg-commit <message> 或手工 git commit；门控确认前必须 clean',
      ),
    );
  }
  checks.push({
    name: 'git-status',
    ok: git.isRepo && git.dirty === 0,
    detail: formatGitStatus(git),
  });

  if (!project.hasSpecgate) {
    issues.push(
      issue('error', 'SPECGATE_NOT_INITIALIZED', '未检测到 .specgate/，插件不会拦截写入', '执行 /sg-init 初始化'),
    );
  }
  if (!exists(path.join(project.root, 'openspec', 'changes'))) {
    issues.push(
      issue('error', 'OPENSPEC_MISSING', 'openspec/changes/ 不存在', '执行 /sg-init 或手工创建目录'),
    );
  }
  if (status.changes.length > 0 && !project.paradigm) {
    issues.push(
      issue('warn', 'PARADIGM_MISSING', '存在活跃 Change，但尚未确认 L1/L2/L3 范式', '执行 /sg-classify <描述> 并确认 G2'),
    );
  }

  const contradictions = [
    ['G3', 'proposal'],
    ['G4', 'design'],
    ['G5', 'specs'],
    ['G6', 'tasks'],
  ];
  for (const change of status.changes) {
    for (const [gate, artifact] of contradictions) {
      if (readGate(project.root, gate).confirmed && change.artifacts[artifact] === 'not-started') {
        issues.push(
          issue(
            'error',
            'GATE_ARTIFACT_CONTRADICTION',
            `${gate} 已确认，但 ${change.name} 的 ${artifact} 不存在`,
            `补齐 ${artifact}，或清除 .specgate/gates/${gate}.confirmed 后重新评审`,
          ),
        );
      }
    }
    for (const [artifact, state] of Object.entries(change.artifacts)) {
      if (state === 'drafting') {
        issues.push(
          issue(
            'warn',
            'ARTIFACT_DRAFTING',
            `${change.name} 的 ${artifact} 仍是 drafting`,
            '补齐完成标记（如 ## Intent / ## Scope、## Architecture、Scenario:、任务勾选）',
          ),
        );
      }
    }
  }

  const deviations = readDeviations(project.root);
  for (const [index, entry] of deviations.entries()) {
    if (!entry.reason) {
      issues.push(
        issue('warn', 'DEVIATION_WITHOUT_REASON', `第 ${index + 1} 条偏离记录缺少 reason`, '手工补齐 .specgate/deviations.log'),
      );
    }
  }
  checks.push({ name: 'deviations', ok: true, detail: `${deviations.length} 条` });

  if (exists(project.skillsDir)) {
    const skillFiles = walkFiles(project.skillsDir).filter((file) => /[\\/]SKILL\.md$/i.test(file));
    const ok = skillFiles.length >= 30;
    checks.push({ name: 'materialized-skills', ok, detail: `${skillFiles.length}/30` });
    if (!ok) {
      issues.push(
        issue('warn', 'SKILLS_INCOMPLETE', `物化技能只有 ${skillFiles.length}/30`, '重新执行 /sg-init --force（待实现）或手工补齐'),
      );
    }
  } else {
    checks.push({ name: 'materialized-skills', ok: false, detail: '未物化；将使用插件内置技能' });
  }

  const confirmed = GATE_ORDER.filter((gate) => readGate(project.root, gate).confirmed);
  checks.push({ name: 'gates', ok: true, detail: `${confirmed.length} 个已确认` });

  const stateText = readIfExists(path.join(project.root, '.specgate', 'state', 'idempotency.json'));
  if (stateText !== null) {
    try {
      const store = JSON.parse(stateText);
      const count = Object.keys(store.operations || {}).length;
      checks.push({ name: 'idempotency', ok: true, detail: `${count} 条操作记录` });
    } catch {
      checks.push({ name: 'idempotency', ok: false, detail: 'idempotency.json 无法解析' });
      issues.push(
        issue('warn', 'IDEMPOTENCY_CORRUPT', '幂等记录无法解析', '删除 .specgate/state/idempotency.json 后重试'),
      );
    }
  }

  const staleLocks = findStaleLocks(project.root);
  checks.push({
    name: 'stale-locks',
    ok: staleLocks.length === 0,
    detail: staleLocks.length === 0 ? '无' : `${staleLocks.length} 个`,
  });
  if (staleLocks.length > 0) {
    issues.push(
      issue(
        'warn',
        'STALE_OPERATION_LOCK',
        `存在 ${staleLocks.length} 个过期操作锁`,
        '确认没有命令在运行后删除系统临时目录 specgate-locks 中对应的 .lock 文件',
      ),
    );
  }

  const dispatchText = readIfExists(path.join(project.root, '.specgate', 'state', 'dispatch.json'));
  if (dispatchText !== null) {
    try {
      const store = JSON.parse(dispatchText);
      const count = Object.keys(store.tasks || {}).length;
      checks.push({ name: 'dispatch-state', ok: true, detail: `${count} 个任务记录` });
    } catch {
      checks.push({ name: 'dispatch-state', ok: false, detail: 'dispatch.json 无法解析' });
    }
  }

  return {
    ok: issues.every((item) => item.level !== 'error'),
    root: project.root,
    checks,
    issues,
    status,
    git,
  };
}

const ISSUE_EN = {
  GIT_NOT_INITIALIZED: {
    message: 'Git is not initialized; commit discipline cannot run.',
    fix: 'Run /sg-init or git init, then commit.',
  },
  GIT_DISABLED: {
    message: 'Git is disabled (--no-git); commit discipline is inactive.',
    fix: 'Run /sg-enable and initialize Git manually when needed.',
  },
  SPECGATE_NOT_INITIALIZED: {
    message: '.specgate/ was not detected; the plugin will not guard writes.',
    fix: 'Run /sg-init.',
  },
  OPENSPEC_MISSING: {
    message: 'openspec/changes/ does not exist.',
    fix: 'Run /sg-init or create the directory manually.',
  },
  PARADIGM_MISSING: {
    message: 'An active change exists but L1/L2/L3 is not confirmed.',
    fix: 'Run /sg-classify <description> and confirm G2.',
  },
  GATE_ARTIFACT_CONTRADICTION: {
    message: 'A gate is confirmed but its artifact is missing.',
    fix: 'Fill the artifact or clear the gate marker and review again.',
  },
  ARTIFACT_DRAFTING: {
    message: 'An artifact is still in drafting state.',
    fix: 'Complete the required sections and markers.',
  },
  DEVIATION_WITHOUT_REASON: {
    message: 'A deviation entry is missing its reason.',
    fix: 'Fill the reason in .specgate/deviations.log.',
  },
  SKILLS_INCOMPLETE: {
    message: 'Materialized skills are incomplete.',
    fix: 'Run /sg-init --force or add the missing skills.',
  },
  IDEMPOTENCY_CORRUPT: {
    message: 'The idempotency record cannot be parsed.',
    fix: 'Delete .specgate/state/idempotency.json and retry.',
  },
  STALE_OPERATION_LOCK: {
    message: 'Stale operation locks exist.',
    fix: 'Confirm no command is running and remove the matching .lock files.',
  },
};

export function renderDoctor(result, language = 'zh') {
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  const lines = [en ? 'SpecGate health check' : 'SpecGate 体检'];
  lines.push(en ? `Project: ${result.root}` : `项目：${result.root}`);
  lines.push(en ? `Result: ${result.ok ? 'passed' : 'issues found'}` : `结论：${result.ok ? '通过' : '存在问题'}`);
  lines.push(formatGitStatus(result.git || { isRepo: false }, language));
  lines.push('');
  lines.push(en ? 'Checks:' : '检查项：');
  for (const check of result.checks) {
    lines.push(`  [${check.ok ? 'OK' : '--'}] ${check.name}: ${check.detail}`);
  }
  if (result.issues.length > 0) {
    lines.push('');
    lines.push(en ? 'Issues:' : '问题：');
    for (const item of result.issues) {
      const translated = en ? ISSUE_EN[item.code] : null;
      lines.push(
        `  [${item.level}] ${item.code}: ${translated?.message || item.message}`,
      );
      const fix = translated?.fix || item.fix;
      if (fix) lines.push(en ? `       Fix: ${fix}` : `       修复：${fix}`);
    }
  }
  return lines.join('\n');
}

export function listChangesForDoctor(root) {
  const project = loadProject(root);
  return listChanges(project.root, project.paradigm || 'L1');
}
