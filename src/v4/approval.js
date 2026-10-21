import { sideLabel } from './catalog.js';

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

export function planForSide(side) {
  return commandRows(side).map(([phase, command]) => ({ phase, command }));
}

export function approvalText(selection, options = {}) {
  const lines = ['操作目录：', options.root || selection.root || '当前工作目录', '', '技术栈：'];
  for (const side of selection.sides || []) {
    const role = side.role === 'frontend' ? '前端' : '后端';
    lines.push(role + '：' + sideLabel(side));
  }
  return lines.join('\n');
}

export async function askApproval({ userQuestions, agent, signal, selection, root }) {
  if (!userQuestions || typeof userQuestions.ask !== 'function') return 'skipped';
  try {
    const answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-v4-quality-approval',
          header: '最终确认与审批',
          question: approvalText(selection, { root }),
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
