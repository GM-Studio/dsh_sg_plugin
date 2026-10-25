import { canonicalJson, hashValue } from '../events.js';

const bounded = (value, maximum = 2048) =>
  String(value ?? '')
    .slice(0, maximum)
    .replace(
      /(\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]');
const commandArgs = (args) => {
  let redactNext = false;
  return args.slice(0, 16).map((argument) => {
    if (redactNext) {
      redactNext = false;
      return '[REDACTED]';
    }
    const arg = bounded(argument, 256);
    redactNext =
      /^(?:--?)?(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|authorization:?)$|^Bearer$/i.test(
        arg,
      );
    return arg;
  });
};
const value = (item, fallback) =>
  bounded(typeof item === 'object' && item !== null ? JSON.stringify(item) : (item ?? fallback));

export function buildRepairContext({ findings, source, quality = {}, review = {}, graph = {} }) {
  const sourceReport = source === 'review' ? review.reportPath : quality.reportPath;
  const commands = quality.verification?.commands || quality.verification?.stages || [];
  const failed = commands.find((command) => command.status !== 0 && command.status !== 'passed');
  const defaultCommand = source === 'review' ? null : failed || quality.command;
  const normalized = [];
  let bytes = 0;
  for (const finding of findings.slice(0, 64)) {
    const command = finding.command || defaultCommand;
    const entry = {
      id: bounded(finding.id || `F-${normalized.length + 1}`, 128),
      severity: bounded(finding.severity || 'P1', 16),
      file: bounded(finding.file || '', 1024),
      line: Number.isSafeInteger(finding.line) && finding.line > 0 ? finding.line : null,
      acIds: (finding.acIds || graph.acs?.map((ac) => ac.id) || []).slice(0, 100),
      caseId: bounded(finding.caseId || '', 128),
      expected: value(
        finding.expected,
        source === 'review'
          ? 'No blocking review finding'
          : 'All frozen cases and quality gates pass',
      ),
      actual: value(
        finding.actual,
        finding.message || finding.evidence || finding.recommendation || finding.code,
      ),
      command: command
        ? {
            argv: commandArgs(
              Array.isArray(command)
                ? command
                : command.argv || [command.command || '', ...(command.args || [])],
            ),
            source: command.source || null,
          }
        : null,
      exitCode:
        finding.exitCode ??
        command?.exitCode ??
        (Number.isInteger(command?.status) ? command.status : null),
      evidence: bounded(finding.evidence || sourceReport || '', 1024),
      logSummary: bounded(finding.logSummary || finding.message || finding.evidence || ''),
      recommendation: bounded(
        finding.recommendation ||
          finding.suggestion ||
          'Fix the frozen acceptance behavior without changing tests',
      ),
    };
    const length = Buffer.byteLength(canonicalJson(entry));
    if (bytes + length > 64 * 1024) break;
    normalized.push(entry);
    bytes += length;
  }
  return {
    source,
    findings: normalized,
    findingsHash: 'sha256:' + hashValue(findings),
    omitted: findings.length - normalized.length,
    sourceReport: bounded(sourceReport || '', 1024),
  };
}
