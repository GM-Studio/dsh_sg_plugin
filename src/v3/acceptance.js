export function generateAcceptance({
  change,
  type,
  changeKey,
  acs,
  report,
  exitCode,
  evidence,
  commit,
  validator,
}) {
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
  const stats = {
    total: cases.length,
    pass: cases.filter((item) => item.status === 'pass').length,
    fail: cases.filter((item) => item.status === 'fail').length,
    skip: cases.filter((item) => item.status === 'skip').length,
  };
  const lines = [
    `# 验收报告：${change}`,
    '',
    `- 变更类型：${type}`,
    ...(changeKey ? [`- changeKey：${changeKey}`] : []),
    `- 结论：${conclusion}`,
    `- 校验器：${validator}`,
    `- 测试：total=${stats.total} pass=${stats.pass} fail=${stats.fail} skip=${stats.skip}`,
    `- 证据 head：${evidence?.headSeq ?? 0} / ${evidence?.headHash ?? '-'}`,
    `- integration commit：${commit}`,
    '',
    '| AC | 结果 | 用例文件 | exitCode | commit |',
    '|---|---|---|---|---|',
    ...rows.map(
      (row) => `| ${row.ac} | ${row.result} | ${row.file} | ${row.exitCode} | ${row.commit} |`,
    ),
    '',
  ];
  return { text: lines.join('\n'), rows, conclusion };
}
