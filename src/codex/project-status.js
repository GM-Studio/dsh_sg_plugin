import fs from 'node:fs';
import path from 'node:path';
import { createStateStore } from './state-machine.js';
import { loadProjectReadiness } from './project-state.js';
import { projectEnvironmentSelection, readEnvironmentJson } from './core/environment.js';

// 不构造 supervisor/runtime/projection；它们的构造过程可能初始化状态目录。
export async function inspectProjectStatus({ root, environment, env = process.env } = {}) {
  const profile = readEnvironmentJson(path.join(root, '.specgate/codex/project.json'));
  const readiness = loadProjectReadiness({ projectRoot: root });
  const workflow = await createStateStore({ projectRoot: root }).inspect();
  const state = workflow.ok ? workflow.state : null;
  const verified = readEnvironmentJson(path.join(root, '.specgate/codex-verify-report.json'));
  let control = { ok: false, code: 'OPTIONAL_MODULE_DISABLED' };
  let items = [];
  if (env.SPECGATE_OPTIONAL_MODULES === '1') {
    const [{ readControlStore }, { resolveControlRoot }, { sameProject, workItemProjectRoot }] =
      await Promise.all([
        import('./control/store.js'),
        import('./control/config.js'),
        import('./core/project-path.js'),
      ]);
    control = readControlStore(resolveControlRoot({ env }));
    items = Object.values(control.state?.workItems || {}).filter((item) =>
      sameProject(workItemProjectRoot(item), root),
    );
  }
  const pendingApproval = ['H1_PENDING', 'H3_PENDING'].includes(state?.phase) ? state.phase : null;
  return {
    ok: true,
    projectRoot: path.resolve(root),
    profile,
    selection: projectEnvironmentSelection(root),
    environment: environment?.inspect()?.checkedAt
      ? {
          ...environment.inspect(),
          status: 'last-check',
          lastObservedReady: environment.inspect().environmentReady,
          note: '上次环境检查结果；本次只读查询未重新执行工具探测。',
        }
      : { status: 'not-checked', environmentReady: false },
    project: {
      ready: readiness.ok,
      code: readiness.code || null,
      baseline: readiness.baseline || null,
      generated: fs.existsSync(path.join(root, '.specgate/init-report.json')),
    },
    workflow: {
      ok: workflow.ok,
      code: workflow.code || null,
      changeId: state?.changeId || null,
      phase: state?.phase || null,
      version: state?.version ?? null,
      pendingApproval,
      retryState: state?.retries || {},
    },
    workItems: {
      status: control.ok ? 'read' : 'unavailable',
      code: control.code || null,
      items: items.map((item) => ({
        id: item.workItemId,
        title: item.title,
        status: item.executionState,
        businessMilestone: item.businessMilestone,
        attention: item.currentAttentionId
          ? {
              type: control.state.attention[item.currentAttentionId]?.type,
              reason: control.state.attention[item.currentAttentionId]?.reason,
              question: control.state.attention[item.currentAttentionId]?.question,
              actions: control.state.attention[item.currentAttentionId]?.actions,
            }
          : null,
        updatedAt: item.updatedAt,
      })),
    },
    verification: verified
      ? {
          status: 'historical',
          checkedAt: verified.checkedAt || verified.finishedAt || null,
          commit: verified.commit || verified.environment?.gitCommit || null,
          note: '历史证据，未重新执行当前提交验证。',
        }
      : { status: 'not-run' },
    delivery: state?.context?.archive?.delivery || null,
    nextAction: pendingApproval
      ? 'WAIT_FOR_USER_APPROVAL'
      : state?.changeId
        ? 'INSPECT_CURRENT_CHANGE'
        : !readiness.ok
          ? 'PREPARE_PROJECT'
          : 'WAIT_FOR_USER_REQUIREMENTS',
    message: '仅返回已读取的事实；未执行安装、初始化、修复、恢复或审批。',
  };
}
