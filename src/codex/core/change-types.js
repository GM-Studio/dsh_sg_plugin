// 变更类型词表的单一来源（M1 / SNA-0103）。
//
// 此前三处各自维护：change-policy.js 只有 feature/modify/fix，
// 而 core/state.js 与 core/change.js 已接受 remove。同一概念两套词表，
// 属于必须收敛的语义漂移（计划 D-01）。
//
// 说明：refactor 由 M5 / SNA-0501 引入，本任务**不**加入，
// 以保证 M1 只统一既有语义、不新增场景。

/** 合法的变更类型（唯一权威集合）。 */
export const CHANGE_TYPES = Object.freeze(['feature', 'modify', 'fix', 'remove']);

const CHANGE_TYPE_SET = new Set(CHANGE_TYPES);

export function isChangeType(value) {
  return typeof value === 'string' && CHANGE_TYPE_SET.has(value);
}

/** 供错误信息复用的可读列表。 */
export const CHANGE_TYPE_HINT = CHANGE_TYPES.join(' / ');
