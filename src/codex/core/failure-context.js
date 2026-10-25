import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validFileRule } from './task-policy.js';
import { redactSensitiveText } from './sensitive-input.js';

function bounded(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactSensitiveText(value, 2048);
  if (depth > 3) return '[DETAILS_IN_EVIDENCE]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => bounded(item, depth + 1));
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, item]) => [
          key,
          /^(?:password|passwd|secret|token|api[_-]?key|access[_-]?token|client[_-]?secret|authorization)$/i.test(
            key,
          )
            ? '[REDACTED]'
            : bounded(item, depth + 1),
        ]),
    );
  return null;
}

function safeCommand(command, maximum = 20) {
  if (!command) return null;
  const args = command.args || [];
  const safe = args
    .slice(0, maximum)
    .map((argument, index) =>
      /^(?:--?)?(?:password|passwd|secret|token|api[_-]?key|access[_-]?token|client[_-]?secret|authorization)$/i.test(
        String(args[index - 1] || ''),
      )
        ? '[REDACTED]'
        : redactSensitiveText(argument, 512),
    );
  const metadata = bounded(command);
  delete metadata.argv;
  return { ...metadata, args: safe, omittedArguments: Math.max(0, args.length - maximum) };
}

function logTail(root, relative) {
  if (!validFileRule(relative) || relative.includes('*') || !relative.startsWith('.specgate/'))
    return '';
  let target = root;
  try {
    for (const part of relative.split('/')) {
      target = path.join(target, part);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) return '';
    }
    const stat = fs.statSync(target);
    if (!stat.isFile()) return '';
    const bytes = Buffer.alloc(Math.min(stat.size, 4096));
    const fd = fs.openSync(target, 'r');
    try {
      fs.readSync(fd, bytes, 0, bytes.length, Math.max(0, stat.size - bytes.length));
    } finally {
      fs.closeSync(fd);
    }
    return redactSensitiveText(bytes.toString('utf8'), 4096);
  } catch {
    return '';
  }
}

export function failureContext({ root, source, findings = [], quality = {}, review = {} }) {
  const failedCommand = (quality.verificationResults || []).find(
    (command) => command.status !== 'passed' || command.exitCode !== 0,
  );
  const command = failedCommand
    ? {
        ...failedCommand,
        command: failedCommand.argv?.[0] || '',
        args: failedCommand.argv?.slice(1) || [],
      }
    : quality.command;
  const original = JSON.stringify({ source, findings, cases: quality.cases || [], command });
  const selected = source === 'review' ? review : quality;
  const context = {
    source,
    sourceHash: createHash('sha256').update(original).digest('hex'),
    sourcePath:
      validFileRule(selected.reportPath) &&
      selected.reportPath.startsWith('.specgate/') &&
      !selected.reportPath.includes('*')
        ? selected.reportPath
        : null,
    findingCount: findings.length,
    truncated:
      findings.length > 20 ||
      (quality.cases || []).length > 20 ||
      (command?.args || []).length > 20,
    findings: findings.slice(0, 20).map((finding) => bounded(finding)),
    cases: (quality.cases || [])
      .filter((entry) => entry.status !== 'pass')
      .slice(0, 20)
      .map((entry) => bounded(entry)),
    command: safeCommand(command),
    logSummary:
      [
        redactSensitiveText(failedCommand?.stdout || '', 4096),
        redactSensitiveText(failedCommand?.stderr || '', 4096),
        ...[quality.stdoutLog, quality.stderrLog].map((relative) => logTail(root, relative)),
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 8192) || 'NOT_RECORDED',
  };
  // Bound the complete prompt addition, retaining a hash and locator for detail.
  while (Buffer.byteLength(JSON.stringify(context)) > 64 * 1024 && context.findings.length > 1) {
    context.findings.pop();
    context.truncated = true;
  }
  if (Buffer.byteLength(JSON.stringify(context)) > 64 * 1024) {
    context.cases = context.cases.slice(0, 3);
    context.truncated = true;
    context.findings = context.findings.map((finding) => ({
      id: finding.id,
      message: redactSensitiveText(finding.message || finding.evidence, 2048),
    }));
  }
  if (Buffer.byteLength(JSON.stringify(context)) > 64 * 1024) {
    context.truncated = true;
    context.command = safeCommand(command, 8);
    context.findings = findings.slice(0, 1).map((finding) => ({
      id: redactSensitiveText(finding.id, 192),
      file: redactSensitiveText(finding.file, 1024),
      line: finding.line || null,
      acIds: (finding.acIds || []).slice(0, 20).map((id) => redactSensitiveText(id, 192)),
      message: redactSensitiveText(finding.message, 512),
      evidence: redactSensitiveText(finding.evidence, 512),
      suggestion: redactSensitiveText(finding.suggestion, 512),
    }));
    context.cases = (quality.cases || [])
      .filter((entry) => entry.status !== 'pass')
      .slice(0, 1)
      .map((entry) => ({
        id: redactSensitiveText(entry.id, 192),
        status: entry.status,
        expected: redactSensitiveText(JSON.stringify(entry.expected), 512),
        actual: redactSensitiveText(JSON.stringify(entry.actual), 512),
      }));
    context.logSummary = context.logSummary.slice(0, 4096);
  }
  return context;
}
