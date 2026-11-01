#!/usr/bin/env node
// Historical standalone entry: project selection and the same approved portable installer as MCP.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import {
  createEnvironmentService,
  projectEnvironmentSelection,
} from '../src/codex/core/environment.js';
import { canonicalJson } from '../src/codex/events.js';

export const TOOL_IDS = [
  'git',
  'node',
  'python',
  'go',
  'jdk8',
  'jdk17',
  'jdk21',
  'maven',
  'gradle',
  'pnpm',
  'yarn',
  'uv',
  'poetry',
];
export const defaultToolchainDir = (root = process.cwd()) =>
  path.join(path.resolve(root), '.specgate', 'toolchains');
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
export function parseInstallArgs(argv) {
  const options = {
    check: false,
    plan: false,
    json: false,
    help: false,
    only: [],
    envWrite: false,
    project: path.resolve(process.cwd()),
    toolchainDir: null,
    source: 'official',
    selection: {},
    expectedPlanHash: null,
  };
  const selections = {
    stack: 'stack',
    'node-version': 'nodeVersion',
    'python-version': 'pythonVersion',
    'go-version': 'goVersion',
    'java-version': 'javaVersion',
    'build-tool': 'buildTool',
    frontend: 'frontend',
    'package-manager': 'packageManager',
    preset: 'preset',
  };
  for (const argument of argv) {
    if (argument === '--check') options.check = true;
    else if (argument === '--plan') options.plan = true;
    else if (argument === '--json') options.json = true;
    else if (['--help', '-h'].includes(argument)) options.help = true;
    else if (argument === '--no-env-write') {
      /* Always process-local. */
    } else if (argument === '--method=portable' || argument === '--method=auto') {
      /* Only approved portable archives are supported. */
    } else if (argument.startsWith('--only=')) {
      options.only = [
        ...new Set(
          argument
            .slice(7)
            .split(',')
            .map((id) => id.trim()),
        ),
      ];
      if (!options.only.length || options.only.some((id) => !TOOL_IDS.includes(id)))
        fail('INVALID_ARGUMENT', '--only contains an unsupported tool');
    } else if (argument.startsWith('--project=') || argument.startsWith('--toolchain-dir=')) {
      const offset = argument.indexOf('='),
        value = argument.slice(offset + 1);
      if (!path.isAbsolute(value) || /[\r\n\0]/.test(value))
        fail('INVALID_ARGUMENT', 'Project and toolchain directories must be absolute paths');
      options[argument.startsWith('--project=') ? 'project' : 'toolchainDir'] = path.resolve(value);
    } else if (argument.startsWith('--source=')) {
      options.source = argument.slice(9);
      if (!['official', 'domestic'].includes(options.source))
        fail('INVALID_ARGUMENT', 'Use an explicit official or domestic source');
    } else if (argument.startsWith('--expected-plan-hash=')) {
      options.expectedPlanHash = argument.slice(21);
      if (!/^[a-f0-9]{64}$/.test(options.expectedPlanHash))
        fail('INVALID_ARGUMENT', 'Expected plan hash must be SHA-256 hex');
    } else {
      const match = /^--([a-z-]+)=(.{1,256})$/.exec(argument);
      if (match && selections[match[1]]) options.selection[selections[match[1]]] = match[2];
      else
        fail(
          'INVALID_ARGUMENT',
          'Unsupported argument: ' +
            argument +
            '; no system package-manager, reinstall or global-environment option is available',
        );
    }
  }
  return options;
}

function selectTools(root, input, only) {
  const selected = projectEnvironmentSelection(root, input);
  if (!only.length || selected.conflict) return selected;
  const required = selected.requirements || [];
  return {
    stack: selected.stack || selected.preset || 'selected-tools',
    requirements: only.map(
      (id) =>
        required.find((entry) => entry.id === id) || {
          id,
          constraints: /^jdk\d+$/.test(id) ? [id.slice(3)] : [],
          modules: ['.'],
        },
    ),
    unsupported: [],
    modules: selected.modules || [],
  };
}
export function approvalPlan(report, cacheRoot) {
  const body = {
    schemaVersion: 1,
    projectRoot: report.projectRoot,
    platform: report.platform,
    arch: report.arch,
    cacheRoot,
    selection: report.selection,
    source: report.source,
    actions: report.plan.map((entry) => ({
      id: entry.id,
      action: entry.action,
      current: entry.current || null,
      archive: entry.archive || null,
      location: entry.archive ? path.join(cacheRoot, entry.id + '-' + entry.archive.version) : null,
    })),
    environmentWrites: 'child-process-only',
  };
  return { ...body, planHash: createHash('sha256').update(canonicalJson(body)).digest('hex') };
}
async function interactiveConfirmation(plan) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return false;
  process.stderr.write(
    'Review the exact installation plan; existing installations will be reused.\n' +
      JSON.stringify(plan, null, 2) +
      '\n',
  );
  const input = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (
      (
        await input.question(
          'Type INSTALL ' + plan.planHash + ' to approve, or press Enter to decline: ',
        )
      ).trim() ===
      'INSTALL ' + plan.planHash
    );
  } finally {
    input.close();
  }
}
const USAGE = `SpecGate standalone environment entry
  --check                  Read-only discovery; no metadata/network/install/profile writes
  --plan                   Resolve an exact reviewable archive plan without installing
  --project=<absolute>     Existing or new project directory (default current directory)
  --stack=node|react|vue|python|go|java  Selection for an empty project
  --only=node,go,...       Explicit tool maintenance scope; default infer project requirements
  --node-version=... --python-version=... --go-version=... --java-version=...
  --source=official|domestic --toolchain-dir=<absolute>
  --expected-plan-hash=<sha256>  Reject changed plans; this does not grant consent
  --json --help
Missing tools require a real interactive confirmation of the exact plan hash.
Noninteractive callers remain blocked and should use Codex sg_env_prepare's trusted approval.
Only portable archives with checksums are installed. System installers and global environment writes are unavailable.`;

export async function installEnvironment({
  argv = [],
  env = process.env,
  confirm = interactiveConfirmation,
} = {}) {
  const options = parseInstallArgs(argv);
  if (options.help) return { ok: true, help: true, usage: USAGE };
  const root = options.project,
    cacheRoot = options.toolchainDir || env.SPECGATE_TOOLCHAINS || defaultToolchainDir(root);
  if (!path.isAbsolute(cacheRoot)) fail('INVALID_ARGUMENT', 'Toolchain directory must be absolute');
  let plan;
  const service = createEnvironmentService({
    root,
    env,
    cacheRoot: path.resolve(cacheRoot),
    select: (directory, input) => selectTools(directory, input, options.only),
    consent: async (report) => {
      plan = approvalPlan(report, path.resolve(cacheRoot));
      if (options.expectedPlanHash && options.expectedPlanHash !== plan.planHash)
        fail('ENV_INSTALL_PLAN_CHANGED', 'The reviewed plan hash differs; nothing installed');
      if (options.plan) return false;
      if (report.plan.some((entry) => entry.action === 'install' && !entry.archive))
        fail(
          'ENV_HOST_INSTALL_REQUIRED',
          'A selected tool requires an explicitly approved host installation; no fallback system command was run',
        );
      return await confirm(plan);
    },
  });
  const input = { ...options.selection, source: options.source };
  const result = options.check ? await service.check(input) : await service.prepare(input);
  if (options.plan && !plan && result.plan) plan = approvalPlan(result, path.resolve(cacheRoot));
  const planOnly = options.plan && result.code === 'ENV_INSTALL_CONSENT_REQUIRED';
  return {
    ...result,
    ...(planOnly ? { ok: true, code: 'ENV_INSTALL_PLAN_ONLY', status: 'plan-only' } : {}),
    scope: options.only.length ? 'selected-tools' : 'project-requirements',
    cacheRoot: path.resolve(cacheRoot),
    installation:
      options.check || options.plan
        ? 'not-run'
        : result.completed?.length
          ? 'executed'
          : 'not-needed-or-not-approved',
    ...(plan ? { approvalPlan: plan } : {}),
  };
}
async function main() {
  try {
    const result = await installEnvironment({ argv: process.argv.slice(2) });
    if (result.help) process.stdout.write(result.usage + '\n');
    else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        environmentReady: false,
        code: error.code || 'ENV_PREPARATION_FAILED',
        message: error.message,
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  await main();
