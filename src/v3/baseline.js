import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite } from './util/fsx.js';
import { load, patchState } from './state.js';

export const MAX_BASELINE_SYNC_RETRIES = 2;
const preparedObjects = new WeakMap();
const approvals = new Map(); // Session-bound authority is deliberately never restored from disk.
const hash = (text) => 'sha256:' + crypto.createHash('sha256').update(text).digest('hex');
const fail = (code, message) => ({ ok: false, code, message });
const key = (root) => path.resolve(root);
const identity = (value) =>
  JSON.stringify([value.doc, value.version, value.contentHash, value.realPath]);

export function loadBaselineState(root) {
  const result = load(root);
  if (result.ok) return result;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(root, '.specgate', 'state.json'), 'utf8'));
    if (state.workflowVersion === 4 && typeof state.phase === 'string') return { ok: true, state };
  } catch {
    /* Return the original fail-closed result. */
  }
  return result;
}

export function patchBaselineState(root, mutate) {
  const loaded = loadBaselineState(root);
  if (!loaded.ok) return loaded;
  if (loaded.state.workflowVersion !== 4) return patchState(root, mutate);
  try {
    const state = structuredClone(loaded.state);
    mutate(state);
    state.updatedAt = new Date().toISOString();
    atomicWrite(path.join(root, '.specgate', 'state.json'), JSON.stringify(state, null, 2) + '\n');
    return { ok: true, state };
  } catch (error) {
    return fail('STATE_WRITE_FAILED', error.message);
  }
}

function checkedPath(root, doc) {
  const base = path.resolve(root);
  const file = path.resolve(base, doc);
  const relative = path.relative(base, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('基线路径超出项目');
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error('基线路径包含符号链接或路径跳转');
  }
  if (!fs.statSync(file).isFile()) throw new Error('基线不是普通文件');
  return fs.realpathSync(file);
}

export function nextBaselineVersion(version) {
  const match = /^v?(\d+)\.(\d+)$/.exec(String(version));
  if (!match) throw new Error('基线版本必须为 vN.N');
  return 'v' + match[1] + '.' + (Number(match[2]) + 1);
}

/** Called by initialization only after real acceptance; the req must already exist. */
export function establishInitialBaseline(
  root,
  { content, version = 'v1.0', doc = 'openspec/REQ.md' } = {},
) {
  const loaded = loadBaselineState(root);
  if (!loaded.ok) return loaded;
  if (typeof content !== 'string') return fail('REQ_BASELINE_INVALID', '初始 req 内容不能为空');
  const prior = loaded.state.projectReq;
  if (
    prior &&
    (prior.initialized ||
      prior.status !== 'pending' ||
      prior.doc !== doc ||
      prior.version !== version ||
      prior.contentHash !== hash(content))
  )
    return fail('REQ_ALREADY_MANAGED', '有效基线已经登记或待验收对象发生变化，不能重新初始化覆盖');
  try {
    nextBaselineVersion(version);
    const realPath = checkedPath(root, doc);
    const actual = fs.readFileSync(realPath, 'utf8');
    if (typeof content !== 'string' || actual !== content || !content.trim())
      return fail('REQ_BASELINE_DRIFT', '初始 req 与已验收内容不一致');
    return patchBaselineState(root, (draft) => {
      draft.projectReq = {
        doc,
        version,
        realPath,
        contentHash: hash(content),
        sourceChange: null,
        status: 'effective',
        initialized: true,
      };
    });
  } catch (error) {
    return fail('REQ_BASELINE_INVALID', error.message);
  }
}

export function readEffectiveBaseline(root, { allowPending = false } = {}) {
  const loaded = loadBaselineState(root);
  if (!loaded.ok) return loaded;
  const baseline = loaded.state.projectReq;
  if (!baseline)
    return fail('REQ_BASELINE_MISSING', '缺少当前有效工程 req；不能自动补造已完成基线');
  if (!baseline.initialized)
    return fail('REQ_INIT_INCOMPLETE', '初始化未完成，不能发起业务 change');
  if (baseline.status !== 'effective' && !allowPending)
    return fail('REQ_PENDING_SYNC', '需求基线待同步，禁止下一项 change');
  try {
    const realPath = checkedPath(root, baseline.doc);
    const content = fs.readFileSync(realPath, 'utf8');
    if (realPath !== baseline.realPath || hash(content) !== baseline.contentHash)
      return fail(
        'REQ_BASELINE_DRIFT',
        '有效 req 内容或路径发生变化，请重新核对；不会自动合并或覆盖',
      );
    return { ok: true, baseline: { ...baseline }, content };
  } catch (error) {
    return fail('REQ_BASELINE_INVALID', error.message);
  }
}

export function checkChangeBaseline(root, state, { allowPending = false } = {}) {
  if (state?.projectReqRoot) root = state.projectReqRoot;
  const currentState = loadBaselineState(root);
  if (!currentState.ok) return currentState;
  if (!currentState.state.projectReq && !state?.changeBaseline) return { ok: true, skipped: true };
  const current = readEffectiveBaseline(root, { allowPending });
  if (!current.ok) return current;
  if (!state?.changeBaseline || identity(current.baseline) !== identity(state.changeBaseline))
    return fail(
      'REQ_BASELINE_DRIFT',
      'change 起始基线版本、内容标识或目标路径已变化，停止并重新核对',
    );
  return current;
}

/** The replacement is the current full engineering req, not an appended history log. */
export function prepareBaselineUpdate(
  root,
  state,
  { content, sessionId, verification = '', unresolved = [] } = {},
) {
  const checked = checkChangeBaseline(root, state, {
    allowPending: state?.phase === 'BASELINE_PENDING_SYNC',
  });
  if (!checked.ok || checked.skipped) return checked;
  if (!['H3_PENDING', 'BASELINE_PENDING_SYNC'].includes(state.phase))
    return fail('REQ_COMPLETION_NOT_READY', '尚未进入完成关卡，失败或取消的 change 不推进基线');
  if (!sessionId || typeof content !== 'string' || !content.trim())
    return fail('REQ_UPDATE_INVALID', '基线更新需要当前会话及完整目标 req 内容');
  if (!verification || unresolved.length)
    return fail('REQ_ACCEPTANCE_INCOMPLETE', '必须提供真实验证结果并解决未完成事项后申请完成确认');
  let version;
  try {
    version = nextBaselineVersion(checked.baseline.version);
  } catch (error) {
    return fail('REQ_UPDATE_INVALID', error.message);
  }
  const baseline = {
    ...checked.baseline,
    version,
    contentHash: hash(content),
    sourceChange: state.change,
    status: 'effective',
  };
  const summary = [
    '# 完成确认与有效需求基线更新',
    '目标：' + baseline.doc,
    '版本：' + checked.baseline.version + ' → ' + version,
    '来源 change：' + state.change,
    '## 真实验证结果',
    String(verification),
    '## 未解决事项',
    '无',
    '## 原有效 req',
    checked.content,
    '## 批准后替换为当前工程 req（不是历史追加）',
    content,
  ].join('\n\n');
  const candidateFile = path.join(root, 'openspec', 'changes', state.change, 'req-next.md');
  const contentFile = fs.existsSync(candidateFile) ? candidateFile : null;
  try {
    if (
      contentFile &&
      fs.readFileSync(checkedPath(root, path.relative(root, contentFile)), 'utf8') !== content
    )
      return fail('REQ_UPDATE_INVALID', '目标 req 文件与展示内容不一致');
  } catch (error) {
    return fail('REQ_UPDATE_INVALID', '目标 req 路径或内容不可确认：' + error.message);
  }
  const prepared = {
    ok: true,
    contentFile,
    root: key(root),
    change: state.change,
    sessionId,
    previous: checked.baseline,
    baseline,
    content,
    summary,
    artifactHash: hash(summary),
    attempts: 0,
  };
  preparedObjects.set(prepared, JSON.stringify(prepared));
  return prepared;
}

/** Host H3 approval must be obtained for prepared.summary before this call. */
export function approveBaselineUpdate(root, state, prepared, { sessionId } = {}) {
  if (
    preparedObjects.get(prepared) !== JSON.stringify(prepared) ||
    prepared.root !== key(root) ||
    prepared.change !== state.change ||
    prepared.sessionId !== sessionId
  )
    return fail('REQ_APPROVAL_INVALID', '完成确认对象或当前会话不匹配');
  const checked = checkChangeBaseline(root, state, {
    allowPending: state.phase === 'BASELINE_PENDING_SYNC',
  });
  if (!checked.ok) return checked;
  if (
    identity(checked.baseline) !== identity(prepared.previous) ||
    hash(prepared.content) !== prepared.baseline.contentHash ||
    hash(prepared.summary) !== prepared.artifactHash
  )
    return fail('REQ_APPROVAL_INVALID', '完成确认后批准对象发生变化');
  approvals.set(key(root), JSON.parse(JSON.stringify(prepared)));
  preparedObjects.delete(prepared);
  return { ok: true, artifactHash: prepared.artifactHash };
}

/** This function runs no code, tests, git commands, or archive operations. */
export function syncBaselineUpdate(root, { sessionId, retry = false } = {}) {
  const approved = approvals.get(key(root));
  if (!approved || approved.sessionId !== sessionId)
    return fail(
      'REQ_RECONFIRM_REQUIRED',
      '会话结束或没有当前会话完成确认，请重新展示差异并取得明确确认',
    );
  if ((approved.attempts > 0 && !retry) || (retry && approved.attempts === 0))
    return fail('REQ_RETRY_INVALID', '仅失败后允许显式重试基线同步');
  if (approved.attempts >= 1 + MAX_BASELINE_SYNC_RETRIES)
    return fail('REQ_RETRY_LIMIT', '基线同步最多重试 2 次，请重新核对并确认');
  if (approved.contentFile) {
    try {
      if (
        fs.readFileSync(checkedPath(root, path.relative(root, approved.contentFile)), 'utf8') !==
        approved.content
      )
        return fail('REQ_RECONFIRM_REQUIRED', '目标 req 内容或位置变化，必须重新完成确认');
    } catch {
      return fail('REQ_RECONFIRM_REQUIRED', '目标 req 文件不可确认，必须重新完成确认');
    }
  }
  const loaded = loadBaselineState(root);
  if (!loaded.ok) return loaded;
  const state = loaded.state;
  if (
    state.change !== approved.change ||
    !['H3_PENDING', 'ARCHIVING', 'BASELINE_PENDING_SYNC'].includes(state.phase)
  )
    return fail('REQ_APPROVAL_INVALID', '当前 change 已变化、取消或不在完成关卡');
  const checked = checkChangeBaseline(root, state, { allowPending: true });
  if (!checked.ok || identity(checked.baseline) !== identity(approved.previous))
    return checked.ok ? fail('REQ_BASELINE_DRIFT', '旧基线发生变化') : checked;
  const pending = patchBaselineState(root, (draft) => {
    draft.phase = 'BASELINE_PENDING_SYNC';
    draft.projectReq.status = 'pending-sync';
    draft.baselineSync = {
      change: approved.change,
      artifactHash: approved.artifactHash,
      targetHash: approved.baseline.contentHash,
      attempts: approved.attempts + 1,
    };
  });
  if (!pending.ok) return pending;
  approved.attempts += 1;
  try {
    // Recheck immediately before the same-directory atomic publication.
    const again = checkChangeBaseline(root, pending.state, { allowPending: true });
    if (!again.ok) return again;
    atomicWrite(approved.baseline.realPath, approved.content);
  } catch (error) {
    return fail(
      'REQ_PENDING_SYNC',
      '代码验收及完成确认已通过，但基线保存失败，change 未完成：' + error.message,
    );
  }
  const saved = patchBaselineState(root, (draft) => {
    draft.projectReq = approved.baseline;
    draft.baselineSync = null;
    draft.phase = 'DONE';
  });
  if (!saved.ok) {
    // Restore only our own just-published content; never overwrite a concurrent user edit.
    try {
      const file = checkedPath(root, approved.previous.doc);
      if (
        file !== approved.previous.realPath ||
        hash(fs.readFileSync(file, 'utf8')) !== approved.baseline.contentHash
      )
        throw new Error('发布后出现外部修改');
      atomicWrite(file, checked.content);
    } catch (error) {
      approvals.delete(key(root));
      return fail(
        'REQ_SYNC_STATE_UNCERTAIN',
        '基线与状态保存无法确认一致，停止后续变更并人工核对：' + error.message,
      );
    }
    approvals.delete(key(root));
    return fail(
      'REQ_SYNC_STATE_UNCERTAIN',
      '生效状态保存失败，旧有效 req 已保留；需重新完成确认：' + saved.message,
    );
  }
  approvals.delete(key(root));
  return { ok: true, baseline: approved.baseline, state: saved.state };
}
