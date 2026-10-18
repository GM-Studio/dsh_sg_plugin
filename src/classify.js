import { PARADIGM_LABELS } from './constants.js';

const L3_PATTERNS = [
  /bug/i,
  /报错/,
  /异常/,
  /崩溃/,
  /修复/,
  /不工作/,
  /失败/,
  /回归/,
  /regression/i,
  /hotfix/i,
  /crash/i,
];

const L1_PATTERNS = [
  /需求/,
  /PRD/i,
  /用户故事/,
  /新功能/,
  /产品/,
  /验收/,
  /业务/,
  /feature/i,
  /requirement/i,
  /user story/i,
];

const L2_PATTERNS = [
  /重构/,
  /架构/,
  /技术方案/,
  /迁移/,
  /升级/,
  /性能/,
  /接口/,
  /模块/,
  /refactor/i,
  /architecture/i,
  /migration/i,
  /implementation/i,
];

export function classifyRequest(description) {
  const text = String(description || '');
  const score = (patterns) => patterns.reduce((total, re) => total + (re.test(text) ? 1 : 0), 0);
  const l3 = score(L3_PATTERNS);
  const l1 = score(L1_PATTERNS);
  const l2 = score(L2_PATTERNS);

  let paradigm = 'L2';
  let reason = '未命中明确关键词，按技术实现（L2）处理';
  if (l3 > 0 && l3 >= l1 && l3 >= l2) {
    paradigm = 'L3';
    reason = '命中缺陷/修复类关键词，按缺陷修复（L3）处理';
  } else if (l1 > 0 && l1 >= l2) {
    paradigm = 'L1';
    reason = '命中需求/产品类关键词，按需求驱动（L1）处理';
  } else if (l2 > 0) {
    paradigm = 'L2';
    reason = '命中架构/实现类关键词，按技术实现（L2）处理';
  }

  return {
    paradigm,
    label: PARADIGM_LABELS[paradigm],
    reason,
    nextAction:
      paradigm === 'L3'
        ? '确认 G2 后可直接进入 tasks；G1/G3/G4/G5 可跳过'
        : '确认 G2 后按标准门控推进',
  };
}
