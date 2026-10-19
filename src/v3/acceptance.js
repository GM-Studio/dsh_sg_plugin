export function generateAcceptance({ change, type, acs, report, exitCode, evidence, commit, validator }) {
  const cases = Array.isArray(report?.cases) ? report.cases : [];
  const rows = [...acs].sort().map((ac) => {
    const pass = cases.find((item) => item.status === 'pass' && (item.ac || []).includes(ac));
    return {
      ac,
      result: pass ? 'pass' : 'fail',
      file: pass?.file || '-',
      exitCode,
      commit,
    };
  });

  const conclusion = rows.every((row) => row.result === 'pass') ? '可验收' : '不可验收';
  const lines = [
    `# 验收报告：${change}`,
    '',
    `- 变更类型：${type}`,
    `- 结论：${conclusion}`,
    `- 校验器：${validator}`,
    `- 证据 head：${evidence?.headSeq ?? 0} / ${evidence?.headHash ?? '-'}`,
    `- integration commit：${commit}`,
    '',
    '| AC | 结果 | 用例文件 | exitCode | commit |',
    '|---|---|---|---|---|',
    ...rows.map((row) => `| ${row.ac} | ${row.result} | ${row.file} | ${row.exitCode} | ${row.commit} |`),
    '',
  ];
  return { text: lines.join('\n'), rows, conclusion };
}
