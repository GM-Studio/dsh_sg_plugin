import { findDependency, sideLabel } from './catalog.js';

function commandRows(side) {
  const stack = side.stack;
  const pm = side.packageManager || 'pnpm';
  if (stack === 'java') {
    const gradle = side.buildTool === 'gradle';
    return [
      ['install', gradle ? 'gradlew dependencies' : 'mvnw -B -ntp dependency:go-offline'],
      ['format', gradle ? 'gradlew spotlessApply' : 'mvnw -B -ntp spotless:apply'],
      ['lint', gradle ? 'gradlew checkstyleMain checkstyleTest' : 'mvnw -B -ntp checkstyle:check'],
      ['test', gradle ? 'gradlew check' : 'mvnw -B -ntp verify'],
      ['review', '内置走查（只读报告）'],
    ];
  }
  if (stack === 'python') {
    const py2 = String(side.pythonVersion || side.runtimeVersion) === '2.7';
    return [
      [
        'install',
        py2
          ? 'python -m pip install -r requirements.txt'
          : 'python -m venv .venv && .venv/bin/pip install -r requirements.txt',
      ],
      ['format', py2 ? 'autopep8 --in-place -r .' : 'ruff format .'],
      ['lint', py2 ? 'flake8 .' : 'ruff check .'],
      ['test', 'pytest -q tests'],
      ['review', '内置走查（只读报告）'],
    ];
  }
  if (stack === 'node' || stack === 'vue' || stack === 'react') {
    const run = pm === 'npm' ? 'npm run ' : pm === 'yarn' ? 'yarn ' : 'pnpm ';
    const install = pm === 'npm' ? 'npm install' : pm === 'yarn' ? 'yarn install' : 'pnpm install';
    return [
      ['install', install],
      ['format', run + 'format'],
      ['lint', run + 'lint'],
      ['test', run + 'test'],
      ['review', '内置走查（只读报告）'],
    ];
  }
  return [];
}

function dependencyLines(side, ids) {
  return (ids || [])
    .map((id) => {
      const item = findDependency(side, id);
      if (!item) return id;
      return item.label + (item.version ? ' ' + item.version : '');
    })
    .join('、');
}

export function planForSide(side) {
  return commandRows(side).map(([phase, command]) => ({ phase, command }));
}

export function approvalText(selection) {
  const lines = [
    '# SpecGate v4.1 执行审批',
    '',
    '将执行以下操作（一次审批覆盖 api + web）。批准后自动安装依赖并执行格式化/静态检查/测试/走查；跳过则只生成完整声明、配置和代码。',
    '',
  ];
  for (const side of selection.sides || []) {
    const deps = side.dependencies || {};
    lines.push('## [' + side.id + '] ' + sideLabel(side));
    lines.push('');
    lines.push('- 必选：' + (dependencyLines(side, deps.required) || '（无）'));
    lines.push('- 可选：' + (dependencyLines(side, deps.optional) || '（无）'));
    if (deps.dropped?.length) {
      lines.push(
        '- 已取消：' + deps.dropped.map((item) => item.id + '（' + item.reason + '）').join('；'),
      );
    }
    lines.push('');
    lines.push('命令：');
    for (const item of planForSide(side)) {
      lines.push('  - ' + item.phase + '：' + item.command);
    }
    lines.push('');
  }
  lines.push('网络：安装阶段需要访问包仓库；选择与生成阶段不需要。');
  lines.push(
    '失败策略：批准后任一阶段失败会停止该端后续质量阶段，继续生成并提交代码，init 标记 degraded。',
  );
  lines.push('');
  return lines.join('\n');
}

export async function askApproval({ userQuestions, agent, signal, selection }) {
  if (!userQuestions || typeof userQuestions.ask !== 'function') return 'skipped';
  try {
    const answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-v4-quality-approval',
          header: '依赖与质量审批',
          question: approvalText(selection),
          options: [
            { label: '批准并执行', description: '自动安装依赖并执行格式化、静态检查、测试、走查' },
            { label: '跳过，仅生成代码', description: '不安装、不执行质量阶段；声明与配置照写' },
            { label: '返回修改', description: '回到技术栈/依赖选择，不写任何文件' },
          ],
        },
      ],
      agent,
      signal,
    });
    const selected = answer?.answers?.[0]?.selected;
    const value = Array.isArray(selected) ? selected[0] : selected;
    if (value === '批准并执行') return 'approved';
    if (value === '返回修改') return 'modify';
    return 'skipped';
  } catch {
    return 'skipped';
  }
}

export function skipQuality(reason = '用户未批准安装依赖/质量阶段') {
  return async () => ({ ok: true, skipped: true, reason, stages: [] });
}
