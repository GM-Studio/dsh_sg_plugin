#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  RELEASE_STATUSES,
  createReleaseCheck,
  validateDeploymentManifest,
} from '../src/codex/control/deployment-assurance.js';

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const FLAGS = new Set([
  '--manifest',
  '--evidence',
  '--backup-report',
  '--security-drills',
  '--pilot',
  '--json',
]);

const usage = `Usage:
  node scripts/specgate-release-check.mjs --manifest <file> [--evidence <file>]
    [--backup-report <file>] [--security-drills <file>] [--pilot <file>] [--json]

This command is read-only. It never deploys, publishes, pushes or changes state.`;

const blocked = (code, message) => ({
  ok: false,
  status: RELEASE_STATUSES.BLOCKED,
  code,
  blockers: [
    {
      code,
      field: 'cli',
      message,
      severity: 'blocking',
    },
  ],
  unexecuted: [],
});

function parseArguments(argv) {
  const values = {};
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (!FLAGS.has(argument) || argument === '--json') {
      return { error: blocked('RELEASE_CLI_ARGUMENT_INVALID', 'Unknown CLI argument') };
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      return { error: blocked('RELEASE_CLI_VALUE_MISSING', 'CLI option value is missing') };
    }
    values[argument.slice(2)] = next;
    index += 1;
  }
  if (!values.manifest) {
    return { error: blocked('RELEASE_MANIFEST_ARGUMENT_REQUIRED', '--manifest is required') };
  }
  return { values, json };
}

function readInput(label, filename) {
  if (!filename) return { ok: true, value: undefined };
  try {
    const absolute = resolve(filename);
    const content = readFileSync(absolute, { encoding: 'utf8', flag: 'r' });
    if (Buffer.byteLength(content) > MAX_INPUT_BYTES) {
      return {
        ok: false,
        result: blocked('RELEASE_INPUT_TOO_LARGE', `${label} exceeds the safe input bound`),
      };
    }
    const value = JSON.parse(content);
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      result: blocked('RELEASE_INPUT_INVALID', `${label} is missing or is not valid JSON`),
    };
  }
}

export function runReleaseCheck(argv = process.argv.slice(2), { write = console.log } = {}) {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    write(usage);
    return 0;
  }
  if (parsed.error) {
    write(JSON.stringify(parsed.error, null, 2));
    return 2;
  }

  const manifestInput = readInput('manifest', parsed.values.manifest);
  if (!manifestInput.ok) {
    write(JSON.stringify(manifestInput.result, null, 2));
    return 2;
  }
  const validated = validateDeploymentManifest(manifestInput.value);
  if (!validated.ok) {
    const result = createReleaseCheck({
      manifest: manifestInput.value,
      evidence: null,
      backupReport: null,
      securityDrills: null,
      pilot: null,
    });
    write(JSON.stringify(result, null, 2));
    return 2;
  }

  const labels = [
    ['evidence', parsed.values.evidence],
    ['backup-report', parsed.values['backup-report']],
    ['security-drills', parsed.values['security-drills']],
    ['pilot', parsed.values.pilot],
  ];
  const loaded = {};
  for (const [flag, filename] of labels) {
    const input = readInput(flag, filename);
    if (!input.ok) {
      write(JSON.stringify(input.result, null, 2));
      return 2;
    }
    loaded[flag] = input.value;
  }

  const result = createReleaseCheck({
    manifest: manifestInput.value,
    evidence: loaded.evidence,
    backupReport: loaded['backup-report'],
    securityDrills: loaded['security-drills'],
    pilot: loaded.pilot,
  });
  const passing = result.status === RELEASE_STATUSES.PASS;
  if (parsed.json) {
    write(JSON.stringify(result, null, 2));
  } else {
    const lines = [
      `Release status: ${result.status}`,
      ...result.blockers.map((item) => `${item.severity}: ${item.code}`),
      ...result.unexecuted.map((item) => `NOT_RUN: ${item.checkId}`),
    ];
    write(lines.join('\n'));
  }
  return passing ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) process.exitCode = runReleaseCheck();
