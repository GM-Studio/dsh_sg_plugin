import { resolveControlRoot } from './config.js';
import { createLocalControlRuntime } from './runtime.js';
import { hashValue } from '../events.js';
import { sameProject, workItemProjectRoot } from '../core/project-path.js';

export { CONTROL_TOOLS } from '../core/optional-tool-definitions.js';

function workItemNotFound() {
  return { ok: false, code: 'WORK_ITEM_NOT_FOUND', message: 'WorkItem does not exist' };
}

async function ownedWorkItem(control, workItemId, projectRoot) {
  const current = await control.projection.getWorkItem(workItemId);
  if (!current.ok) return current;
  if (
    !sameProject(workItemProjectRoot(current.workItem) || current.project?.projectRoot, projectRoot)
  )
    return workItemNotFound();
  return current;
}

export function controlControlService({ env = process.env, clock = Date.now } = {}) {
  return createLocalControlRuntime({ env, clock });
}

export async function callControlTool(
  { projectRoot, env = process.env, clock = Date.now, service } = {},
  name,
  args = {},
) {
  const runtime = service ? null : controlControlService({ env, clock });
  const control = service || runtime.service;
  if (name === 'sg_work_item_create') {
    const created = await control.createWorkItem({
      title: args.title,
      request: args.request,
      priority: args.priority,
      budget: args.budget,
      projectRoot,
    });
    return created.ok
      ? {
          ...created,
          controlRoot: service ? null : resolveControlRoot({ env }),
          next: 'Start or keep the local supervisor running, then monitor this WorkItem.',
        }
      : created;
  }
  if (name === 'sg_work_item_status') {
    const workItemId = args.workItemId || env.SPECGATE_WORK_ITEM_ID;
    if (!workItemId) {
      const listed = await control.projection.listWorkItems();
      if (!listed.ok) return listed;
      return {
        ok: true,
        workItems: listed.workItems.filter((item) =>
          sameProject(workItemProjectRoot(item), projectRoot),
        ),
        controlRoot: resolveControlRoot({ env }),
      };
    }
    const item = await ownedWorkItem(control, workItemId, projectRoot);
    return item.ok ? { ...item, controlRoot: resolveControlRoot({ env }) } : item;
  }
  if (name === 'sg_work_item_wait') {
    const configuredWorkItem = env.SPECGATE_WORK_ITEM_ID;
    if (configuredWorkItem && args.workItemId !== configuredWorkItem)
      return {
        ok: false,
        code: 'WORK_ITEM_SCOPE_MISMATCH',
        message: 'A worker may only request attention for its own WorkItem',
      };
    if (['H1_APPROVAL', 'H3_APPROVAL', 'CUSTOMER_ACCEPTANCE'].includes(args.type))
      return {
        ok: false,
        code: 'CONTROL_GATE_TOOL_REQUIRED',
        message: 'H1/H3 and customer acceptance must use their bound gate workflows',
      };
    let result = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await ownedWorkItem(control, args.workItemId, projectRoot);
      if (!current.ok) return current;
      result = await control.requestAttention({
        workItemId: args.workItemId,
        scope: args.scope,
        expectedVersion: current.workItem.revision,
        type: args.type,
        reason: args.reason,
        question: args.question,
        actions: args.actions,
        artifactHash: hashValue({
          workItemId: args.workItemId,
          type: args.type,
          revision: current.workItem.revision,
        }),
        summary: args.summary,
        risks: args.risks,
        evidence: args.evidence,
        expiresAt: args.expiresAt,
      });
      if (result.code !== 'VERSION_CONFLICT') return result;
    }
    return result;
  }
  return { ok: false, code: 'UNKNOWN_TOOL', message: 'Control tool is unavailable' };
}
