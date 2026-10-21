import path from 'node:path';
import { ensureDir, exists, readText, writeText } from './util/fsx.js';

export const REQ_VERSION = 'v1.0';
export const MAX_CONFIRM_ROUNDS = 6;

export const DIMENSIONS = [
  {
    key: 'functional',
    label: '功能需求（MVP 能力清单）',
    question: '第一版必须提供哪些功能？一条一行，只列 MVP 必需能力。',
    default: ['用户可注册并登录', '用户可查看健康检查状态'],
  },
  {
    key: 'nonFunctional',
    label: '非功能需求（性能 / 安全 / 可用性 / 兼容性）',
    question: '对性能、安全、可用性、兼容性有什么要求？一条一行。',
    default: [
      '接口 P95 响应时间小于 300ms',
      '登录凭证加盐哈希存储，传输使用 HTTPS',
      '单实例故障后 1 分钟内自动恢复，数据不丢失',
      '支持 Chrome / Edge 最近两个大版本',
    ],
  },
  {
    key: 'constraints',
    label: '约束与依赖',
    question: '有哪些硬约束或外部依赖？例如合规要求、既有系统、部署环境、期限。一条一行。',
    default: ['必须兼容现有生产数据库结构，不做破坏性变更', '不引入付费第三方服务'],
  },
];

export const ACCEPTANCE_DIMENSION = {
  key: 'acceptance',
  label: '验收标准',
  question: '每条功能需求如何验收？一条一行，顺序与功能需求一致。',
  default: [],
};

export const ALL_DIMENSION_KEYS = ['functional', 'nonFunctional', 'constraints', 'acceptance'];

/** REQ-002: the four dimensions are asked in this order, all before the tech stack. */
export const ASK_ORDER = [DIMENSIONS[0], DIMENSIONS[1], DIMENSIONS[2], ACCEPTANCE_DIMENSION];

export function answerOf(answer, index = 0) {
  const item = answer && answer.answers ? answer.answers[index] : null;
  if (!item) return undefined;
  const custom = typeof item.custom === 'string' ? item.custom.trim() : '';
  if (custom) return custom;
  if (Array.isArray(item.selected)) return item.selected[0];
  return item.selected;
}

export function normalizeRequirements(input) {
  const source = input && typeof input === 'object' ? input : {};
  const fresh = {};
  for (const key of ALL_DIMENSION_KEYS) {
    const value = source[key];
    const list = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/\r?\n/)
        : [];
    fresh[key] = list.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return fresh;
}

export function requirementsSummaryText(requirements) {
  const data = normalizeRequirements(requirements);
  return ALL_DIMENSION_KEYS.map((key) => data[key].join(' / ')).join(' | ');
}

/**
 * REQ-001 / REQ-002: requirements questions run before any tech-stack question.
 * The four dimensions are functional capability list, non-functional qualities,
 * constraints and dependencies, and acceptance criteria.
 */
export async function collectRequirements({
  userQuestions,
  agent,
  signal,
  initial = {},
  keys = null,
}) {
  const requirements = normalizeRequirements(initial);
  for (const dimension of ASK_ORDER) {
    if (keys && !keys.includes(dimension.key)) continue;
    const preset = requirements[dimension.key].join('；');
    const options = [
      ...(preset ? [{ label: preset, description: '使用已填写内容' }] : []),
      { label: '留空', description: '该维度留空，后续可补' },
    ];
    let answer;
    try {
      answer = await userQuestions.ask({
        questions: [
          {
            id: 'sg-init-req-' + dimension.key,
            header: dimension.label,
            question: dimension.question,
            options,
          },
        ],
        agent,
        signal,
      });
    } catch (error) {
      const wrapped = new Error('用户问答不可用：' + (error?.message || String(error)));
      wrapped.code = 'E_QUESTIONS_UNAVAILABLE';
      throw wrapped;
    }
    const selected = answerOf(answer);
    const value = typeof selected === 'string' ? selected.trim() : '';
    // 不做默认值兜底：留空/跳过就是空，由用户后续补充。
    requirements[dimension.key] = value && value !== '跳过' && value !== '留空' ? [value] : [];
  }
  return requirements;
}

function pad(index) {
  return String(index).padStart(3, '0');
}

function cleanTitle(item) {
  return (
    String(item)
      .replace(/^[-*\d.\s]+/, '')
      .trim() || String(item)
  );
}

function pushSection(lines, heading, items, startIndex) {
  const entries = [];
  lines.push('## ' + heading);
  lines.push('');
  items.forEach((item, offset) => {
    const id = 'REQ-' + pad(startIndex + offset);
    const title = cleanTitle(item);
    entries.push({ id, title });
    lines.push('### ' + id + ' ' + title);
    lines.push('');
    lines.push('- 需求：' + title);
    lines.push('');
  });
  return entries;
}

/**
 * REQ-004: sequential REQ-xxx clauses across all four dimensions with matching
 * AC-xxx acceptance cases, and every AC declaring which REQ it covers.
 */
export function renderRequirementsDoc(requirements, options = {}) {
  const data = normalizeRequirements(requirements);
  // 不再回落到示例默认值：空就是空，避免把占位需求写进基线。
  const functional = data.functional;
  const nonFunctional = data.nonFunctional;
  const constraints = data.constraints;

  const lines = [];
  lines.push('# 项目需求基线');
  lines.push('');
  lines.push(
    '> 版本：' + (options.version || REQ_VERSION) + '　｜　状态：已确认　｜　生成：SpecGate Codex',
  );
  if (options.source) {
    lines.push(
      '> 派生自：' +
        options.source +
        (options.sourceHash
          ? '（' +
            String(options.sourceHash)
              .replace(/^sha256:/, '')
              .slice(0, 19) +
            '…）'
          : ''),
    );
  }
  lines.push('');
  lines.push(
    '本文件是项目唯一的需求基线。后续需求变更只能通过 openspec/changes/vX.Y/delta.md 提出，并同步更新本文件。',
  );
  lines.push('');

  const functionalReqs = pushSection(lines, '功能需求（MVP）', functional, 1);
  const nonFunctionalReqs = pushSection(
    lines,
    '非功能需求',
    nonFunctional,
    functionalReqs.length + 1,
  );
  const constraintReqs = pushSection(
    lines,
    '约束与依赖',
    constraints,
    functionalReqs.length + nonFunctionalReqs.length + 1,
  );

  lines.push('## 验收标准');
  lines.push('');
  const acs = [];
  const pushAc = (req, title) => {
    const id = 'AC-' + pad(acs.length + 1);
    acs.push({ id, title, covers: [req.id] });
    lines.push('#### ' + id + ' ' + title);
    lines.push('');
    lines.push('- covers: ' + req.id);
    lines.push('');
  };
  functionalReqs.forEach((req, index) => {
    const provided = data.acceptance[index];
    pushAc(req, provided ? cleanTitle(provided) : '实现并通过自动化测试：' + req.title);
  });
  for (const req of [...nonFunctionalReqs, ...constraintReqs]) {
    pushAc(req, '验证：' + req.title);
  }

  return {
    text: lines.join('\n'),
    reqs: [...functionalReqs, ...nonFunctionalReqs, ...constraintReqs],
    acs,
  };
}

export function renderRequirementsSummary(requirements) {
  const data = normalizeRequirements(requirements);
  const lines = ['# 需求草案（确认前不落盘）', ''];
  for (const dimension of [...DIMENSIONS, ACCEPTANCE_DIMENSION]) {
    lines.push('## ' + dimension.label);
    const items = data[dimension.key];
    if (!items.length) lines.push('- （待补充，将使用示例模板）');
    else items.forEach((item) => lines.push('- ' + item));
    lines.push('');
  }
  return lines.join('\n');
}

export function renderInitConfirmation({ requirementsBlock, contextBlock }) {
  return [
    '# SpecGate Codex 初始化确认',
    '',
    requirementsBlock,
    '',
    contextBlock,
    '',
    '确认后写入 openspec/REQ.md、只读快照与技术栈文件。',
  ].join('\n');
}

/**
 * REQ-006: one confirmation point for both the requirements draft and the tech
 * stack. The caller re-asks only the section the user picks, then re-renders.
 */
export async function askInitConfirmation({ userQuestions, agent, signal, question }) {
  try {
    const answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-init-h0',
          header: 'SpecGate 初始化确认',
          question,
          options: [
            { label: '确认', description: '按草案写入需求基线与技术栈文件' },
            { label: '修改需求', description: '重新回答功能/非功能/约束/验收' },
            { label: '修改技术栈', description: '重新回答技术栈相关问题' },
            { label: '修改其他确认点', description: '重新回答背景/团队/实施步骤' },
          ],
        },
      ],
      agent,
      signal,
    });
    const selected = answerOf(answer);
    return { ok: true, action: selected || '取消' };
  } catch (error) {
    return {
      ok: false,
      code: 'QUESTIONS_UNAVAILABLE',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function reqDocPath(root) {
  return path.join(root, 'openspec', 'REQ.md');
}

export function historyReqPath(root, version = REQ_VERSION) {
  return path.join(root, 'openspec', 'history', version, 'REQ.md');
}

/** REQ-010: never overwrite an existing baseline; report idempotent skips. */
export function writeRequirementsBaseline(root, requirements, options = {}) {
  const version = options.version || REQ_VERSION;
  const doc = renderRequirementsDoc(requirements, {
    version,
    source: options.source || null,
    sourceHash: options.sourceHash || null,
  });
  const mainRelative = 'openspec/REQ.md';
  const snapshotRelative = 'openspec/history/' + version + '/REQ.md';
  const created = [];
  const skipped = [];
  const main = reqDocPath(root);
  if (exists(main)) {
    skipped.push(mainRelative);
  } else {
    writeText(main, doc.text);
    created.push(mainRelative);
  }
  const snapshot = historyReqPath(root, version);
  if (exists(snapshot)) {
    skipped.push(snapshotRelative);
  } else {
    ensureDir(path.dirname(snapshot));
    writeText(snapshot, doc.text);
    created.push(snapshotRelative);
  }
  return { ok: true, doc, created, skipped };
}

export function isRequirementsFrozen(root, version = REQ_VERSION) {
  const main = reqDocPath(root);
  const snapshot = historyReqPath(root, version);
  if (!exists(main)) {
    return {
      ok: false,
      code: 'REQ_BASELINE_MISSING',
      message: '缺少 openspec/REQ.md 需求基线，请先执行 /sg-init',
    };
  }
  if (!exists(snapshot)) {
    return {
      ok: false,
      code: 'REQ_BASELINE_NOT_FROZEN',
      message: '缺少 openspec/history/' + version + '/REQ.md 只读快照',
    };
  }
  const current = readText(main).replace(/\r\n/g, '\n').trim();
  const frozen = readText(snapshot).replace(/\r\n/g, '\n').trim();
  if (current !== frozen) {
    return {
      ok: false,
      code: 'REQ_BASELINE_DRIFT',
      message: 'REQ.md 与 ' + version + ' 快照不一致，需求变更应通过 change delta 提出',
    };
  }
  return { ok: true };
}

export function extractReqIds(text) {
  const ids = new Set();
  const pattern = /REQ-\d{3,}/g;
  let match = pattern.exec(String(text || ''));
  while (match) {
    ids.add(match[0]);
    match = pattern.exec(String(text || ''));
  }
  return ids;
}

export function parseReqBaseline(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const reqs = [];
  const acs = [];
  for (const line of lines) {
    const reqMatch = /^###\s+(REQ-\d{3,})\s*(.*)$/.exec(line);
    if (reqMatch) {
      reqs.push({ id: reqMatch[1], title: reqMatch[2].trim() });
      continue;
    }
    const acMatch = /^####\s+(AC-\d{3,})\s*(.*)$/.exec(line);
    if (acMatch) {
      acs.push({ id: acMatch[1], title: acMatch[2].trim(), covers: [] });
      continue;
    }
    const coverMatch = /^-\s*covers:\s*(.+)$/.exec(line);
    if (coverMatch && acs.length) {
      acs[acs.length - 1].covers = Array.from(extractReqIds(coverMatch[1]));
    }
  }
  return { reqs, acs };
}
