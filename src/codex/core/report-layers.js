// 分层报告与证据状态（M7 / SNA-0704、SNA-0705）。
//
// 目标：
// - AC-33 技术验证、人工验收、归档、推送、生产部署分别报告；
// - AC-34 仅存在脚本、报告模板或生成文档，不能生成执行通过结论；
// - AC-35 修改后的提交不能直接复用修改前的 PASS。

/** 五类独立结论（AC-33）。 */
export const REPORT_LAYERS = Object.freeze([
  'technical-verification',
  'human-acceptance',
  'archive',
  'push',
  'production-deployment',
]);

/** 单层状态：只有 passed 算通过。 */
export const LAYER_STATES = Object.freeze(['passed', 'failed', 'not-run', 'skipped']);

const COMMIT = /^[a-f0-9]{40,64}$/i;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * 构建分层报告。
 * 每层独立；任何一层为真都不蕴含其余（AC-33）。
 */
export function buildLayeredReport({ layers = {} } = {}) {
  if (!object(layers)) return failure('REPORT_INVALID', 'layers 必须是对象');
  const unknown = Object.keys(layers).filter((key) => !REPORT_LAYERS.includes(key));
  if (unknown.length > 0)
    return failure('REPORT_INVALID', '未知的报告层次', { unknown, allowed: REPORT_LAYERS });

  const rows = {};
  const issues = [];
  for (const layer of REPORT_LAYERS) {
    const entry = layers[layer];
    if (entry === undefined) {
      rows[layer] = { state: 'not-run', evidence: [], implied: false };
      continue;
    }
    const state = entry?.state;
    if (!LAYER_STATES.includes(state)) {
      issues.push({ layer, code: 'LAYER_STATE_INVALID', state: state ?? null });
      rows[layer] = { state: state ?? null, evidence: [], implied: false };
      continue;
    }
    const evidence = Array.isArray(entry.evidence) ? [...entry.evidence] : [];
    // passed 必须有可引用证据，否则是空口通过。
    if (state === 'passed' && evidence.length === 0)
      issues.push({ layer, code: 'PASS_WITHOUT_EVIDENCE' });
    rows[layer] = { state, evidence, implied: false };
  }

  return {
    ok: issues.length === 0,
    code: issues.length === 0 ? undefined : 'REPORT_INVALID',
    issues,
    rows,
    // 明确：任何一层都不由其他层推导。
    derivedFromOtherLayers: false,
    // 只有全部 passed 才能说「全部完成」。
    allPassed: REPORT_LAYERS.every((layer) => rows[layer].state === 'passed'),
    // 生产部署默认不因技术验证通过而自动发生。
    productionDeploymentTriggered: rows['production-deployment'].state === 'passed',
  };
}

/**
 * 判定一份证据是否能证明「执行通过」（AC-34）。
 * 脚本存在、报告模板、生成的文档都不能冒充执行结果。
 */
export function assertExecutionEvidence({ source } = {}) {
  if (!object(source)) return failure('EVIDENCE_INVALID', '证据来源必须是对象');
  const kind = source.kind ?? null;

  // 1. 文档/模板/脚本一律不能证明执行。
  const documentLike = ['report-template', 'requirement-baseline', 'generated-document', 'script'];
  if (documentLike.includes(kind))
    return failure('EVIDENCE_NOT_EXECUTION', '文档、模板或脚本不能作为执行通过的证据', { kind });
  if (source.generatedByDocument === true)
    return failure('EVIDENCE_NOT_EXECUTION', '文档生成不得产生执行结论');

  // 2. 状态必须是通过。
  if (source.state !== 'passed')
    return failure('EVIDENCE_NOT_PASSED', '该证据状态不是通过', { state: source.state ?? null });

  // 3. 必须有可核对要素：命令、退出码、时间。
  if (typeof source.command !== 'string' || source.command.length === 0)
    return failure('EVIDENCE_INCOMPLETE', '通过证据必须记录真实命令');
  if (source.exitCode !== 0)
    return failure('EVIDENCE_INCOMPLETE', '通过证据的退出码必须为 0', {
      exitCode: source.exitCode ?? null,
    });
  if (typeof source.recordedAt !== 'string' || !Number.isFinite(Date.parse(source.recordedAt)))
    return failure('EVIDENCE_INCOMPLETE', '通过证据必须记录时间');

  return { ok: true, kind, command: source.command, recordedAt: source.recordedAt };
}

/**
 * 判定一份 PASS 能否用于某个提交（AC-35）。
 * 修改后的提交不得复用修改前的 PASS。
 */
export function canReusePass({ passCommit, targetCommit, formattingRewroteCommit = false } = {}) {
  if (typeof passCommit !== 'string' || !COMMIT.test(passCommit))
    return failure('EVIDENCE_INVALID', 'PASS 必须绑定合法提交');
  if (typeof targetCommit !== 'string' || !COMMIT.test(targetCommit))
    return failure('EVIDENCE_INVALID', '目标必须绑定合法提交');
  if (passCommit !== targetCommit)
    return {
      ok: true,
      reusable: false,
      reason: 'commit-changed',
      // 修改后必须在该提交上完整重跑。
      requiresRerun: true,
    };
  if (formattingRewroteCommit === true)
    return {
      ok: true,
      reusable: false,
      reason: 'formatter-created-a-new-commit',
      requiresRerun: true,
    };
  return { ok: true, reusable: true, reason: null, requiresRerun: false };
}

/**
 * 区分只读格式检查与会写文件的格式化动作。
 * 自动发现的 format 脚本不能一律当作只读检查。
 */
export function classifyFormatCheck({ argv = [], writesFiles = null } = {}) {
  if (!Array.isArray(argv)) return failure('EVIDENCE_INVALID', 'argv 必须是数组');
  const joined = argv.join(' ');
  // 只要出现任一写入意图，就必须保守判为写入：
  // 把写操作误判成只读，会让格式化产生的新提交跳过质量门（AC-35）。
  const explicitWrite = /--write|--fix|\s-w\b|--apply/.test(joined);
  const writes = writesFiles !== null ? writesFiles === true : explicitWrite;
  return {
    ok: true,
    mode: writes ? 'write' : 'check',
    readOnly: !writes,
    // 会写文件的格式化会产生新提交，因此必须重跑质量门。
    changesWorkingTree: writes,
    rationale: writes ? '该命令会改写文件，属格式化动作而非只读检查' : '该命令只读，可安全作为检查',
  };
}
