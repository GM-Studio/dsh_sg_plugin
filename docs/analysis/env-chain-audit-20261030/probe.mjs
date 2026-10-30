import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const output = path.join(root, '.tmp/env-chain-audit-20261030');
const moduleAt = (name) => import(pathToFileURL(path.join(root, 'src/codex', name)));
const [
  { detectStack },
  { createEnvironmentService, planEnvironment },
  { createToolRegistry },
  { satisfiesPython },
  { pickVersion },
  { createMcpPeer },
  { environmentConsent },
] = await Promise.all([
  moduleAt('core/discovery/stack.js'),
  moduleAt('core/environment.js'),
  moduleAt('workflow-tools.js'),
  moduleAt('core/env/python.js'),
  moduleAt('core/env/node.js'),
  moduleAt('peer.js'),
  moduleAt('environment-tools.js'),
]);
const list = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
const paths = [
  ...new Set([
    ...list(['ls-files', '-z']),
    ...list(['ls-files', '--others', '--exclude-standard', '-z']),
  ]),
].sort();
const records = [],
  errors = [],
  groups = {},
  jsonErrors = [];
for (const relative of paths) {
  if (relative.startsWith('.tmp/')) continue;
  try {
    const file = path.join(root, relative),
      stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      errors.push({ relative, reason: 'not-ordinary-file' });
      continue;
    }
    const bytes = fs.readFileSync(file),
      binary = bytes.includes(0),
      text = bytes.toString('utf8');
    const record = {
      path: relative,
      bytes: bytes.length,
      lines: binary ? null : text.split('\n').length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      binary,
    };
    records.push(record);
    const key = relative.split('/')[0];
    groups[key] ??= { files: 0, lines: 0, bytes: 0 };
    groups[key].files++;
    groups[key].lines += record.lines || 0;
    groups[key].bytes += bytes.length;
    if (relative.endsWith('.json') && !binary) {
      try {
        JSON.parse(text.replace(/^\uFEFF/, ''));
      } catch (error) {
        jsonErrors.push({ relative, reason: error.message });
      }
    }
  } catch (error) {
    errors.push({ relative, reason: error.code || error.message });
  }
}
fs.writeFileSync(
  path.join(output, 'inventory.json'),
  JSON.stringify(
    {
      scope:
        'All tracked and nonignored untracked project files excluding .tmp. Git internals, dependencies, generated runtime/cache artifacts are not project source. Hash scan is not a claim of manual line-by-line review.',
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      recordedAt: new Date().toISOString(),
      groups,
      errors,
      jsonErrors,
      records,
    },
    null,
    2,
  ),
);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-environment-audit-'));
const probes = {
  recordedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  note: 'Temporary fixtures; no actual installation or user approval performed.',
  stacks: [],
};
for (const [name, files] of Object.entries({
  node: {
    'package.json': JSON.stringify({ scripts: { test: 'node --test' }, engines: { node: '>=24' } }),
  },
  react: { 'package.json': JSON.stringify({ dependencies: { react: '^18' } }) },
  vue: { 'package.json': JSON.stringify({ dependencies: { vue: '^3' } }) },
  python: { 'pyproject.toml': '[project]\nname="sample"\nrequires-python=">=3.11,<3.13"\n' },
  go: { 'go.mod': 'module example.com/sample\n\ngo 1.23\n' },
  java: {
    'pom.xml': '<project><properties><java.version>17</java.version></properties></project>',
  },
  nested: {
    'apps/web/package.json': '{"dependencies":{"react":"18"}}',
    'services/api/go.mod': 'module example.com/api\ngo 1.23\n',
  },
})) {
  const target = path.join(scratch, name);
  for (const [relative, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
    fs.writeFileSync(path.join(target, relative), data);
  }
  const stack = detectStack({ root: target });
  const env = await createEnvironmentService({ root: target }).check();
  const registry = createToolRegistry({ projectRoot: target });
  const check = (await registry.call('sg_env_check')).structuredContent;
  const install = (await registry.call('sg_env_prepare')).structuredContent;
  probes.stacks.push({
    name,
    detected: {
      stack: stack.stack,
      buildSystems: stack.buildSystems,
      scanned: stack.scanned,
      gaps: stack.gaps,
    },
    environment: env,
    publicCheck: check,
    publicPrepare: install,
  });
}
const registry = createToolRegistry({ projectRoot: scratch });
const optional = createToolRegistry({ projectRoot: scratch, optionalModules: true });
probes.tools = {
  core: registry.definitions.length,
  optional: optional.definitions.length,
  absentFromCore: ['sg_env_prepare', 'sg_project_create', 'sg_project_setup', 'sg_init'].filter(
    (name) => !registry.definitions.some((entry) => entry.name === name),
  ),
};
probes.platforms = ['win32', 'linux', 'darwin'].flatMap((platform) =>
  ['x64', 'arm64'].map((arch) => ({
    platform,
    arch,
    result: planEnvironment({
      platform,
      arch,
      selection: { preset: 'jdk17-boot3.5', frontend: 'react' },
    }),
  })),
);
probes.pythonRanges = ['3.11.9', '==3.11.9', '!=3.11', '~=3.11'].map((requirement) => ({
  version: '3.12.0',
  requirement,
  accepted: satisfiesPython('3.12.0', requirement),
}));
probes.nodeRanges = ['>=24', '>=20 <22', '^20.0.0', '22.x', '>=22.24.0', '22.22.1'].map(
  (requirement) => ({
    available: ['22.22.0'],
    requirement,
    selected: pickVersion(requirement, ['22.22.0']),
  }),
);
let requests = 0;
const peer = createMcpPeer({ send() {} });
peer.initialize({});
const consent = environmentConsent({
  requestPeer: async () => {
    requests++;
    return { action: 'accept' };
  },
  peerCapabilities: peer.capabilities,
  trustedUserIdentity: { id: 'fixture-user', kind: 'user', source: 'fixture' },
});
probes.unadvertisedElicitation = {
  accepted: await consent({}),
  requests,
  capabilities: peer.capabilities(),
};
peer.close();
fs.writeFileSync(path.join(output, 'probes.json'), JSON.stringify(probes, null, 2));
// Only our freshly allocated temporary fixture directory is removed.
if (
  path.dirname(scratch) !== path.resolve(os.tmpdir()) ||
  !path.basename(scratch).startsWith('sg-environment-audit-')
)
  throw new Error('Unexpected scratch path');
fs.rmSync(scratch, { recursive: true, force: true });
process.stdout.write(
  JSON.stringify(
    { inventory: { files: records.length, groups, errors, jsonErrors }, probes },
    null,
    2,
  ),
);
