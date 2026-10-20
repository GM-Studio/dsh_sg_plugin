import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, exists, readText, writeText } from '../v3/util/fsx.js';
import { initProject, configPath, patchConfigRequirements } from '../v3/change.js';
import { writeRequirementsBaseline } from '../v3/requirements.js';

export const WORKSPACE_FILE = '.specgate/workspace.yaml';
export const BACKENDS = ['node', 'python', 'java', 'none'];
export const FRONTENDS = ['vue', 'react', 'none'];
export const PRESETS = {
  'node-fullstack': { backend: 'node', frontend: 'react' },
  'vue-node': { backend: 'node', frontend: 'vue' },
  'react-python': { backend: 'python', frontend: 'react' },
  'java-react': { backend: 'java', frontend: 'react' },
  'java-api': { backend: 'java', frontend: 'none' },
  'python-api': { backend: 'python', frontend: 'none' },
  'node-api': { backend: 'node', frontend: 'none' },
  'vue-only': { backend: 'none', frontend: 'vue' },
  'react-only': { backend: 'none', frontend: 'react' },
};

export function resolveSelection(input = {}) {
  let backend = String(input.backend || 'none').toLowerCase();
  let frontend = String(input.frontend || 'none').toLowerCase();
  if (input.preset && PRESETS[input.preset]) {
    backend = PRESETS[input.preset].backend;
    frontend = PRESETS[input.preset].frontend;
  }
  if (!BACKENDS.includes(backend)) {
    return { ok: false, code: 'INVALID_BACKEND', message: '后端只能是 ' + BACKENDS.join(' / ') };
  }
  if (!FRONTENDS.includes(frontend)) {
    return { ok: false, code: 'INVALID_FRONTEND', message: '前端只能是 ' + FRONTENDS.join(' / ') };
  }
  if (backend === 'none' && frontend === 'none') {
    return { ok: false, code: 'EMPTY_SELECTION', message: '至少选择后端或前端之一' };
  }
  const sides = [];
  if (backend !== 'none') sides.push({ id: 'api', path: 'api', stack: backend, role: 'backend' });
  if (frontend !== 'none')
    sides.push({ id: 'web', path: 'web', stack: frontend, role: 'frontend' });
  return { ok: true, backend, frontend, sides, preset: input.preset || null };
}

export function workspaceYaml(selection) {
  return [
    'version: 4',
    'topology: monorepo',
    'backend: ' + selection.backend,
    'frontend: ' + selection.frontend,
    'contracts: contracts/openapi.yaml',
    'merge: no-ff',
    'sides:',
    ...selection.sides.map(
      (side) =>
        '  - id: ' +
        side.id +
        '\n    path: ' +
        side.path +
        '\n    stack: ' +
        side.stack +
        '\n    role: ' +
        side.role,
    ),
    '',
  ].join('\n');
}

export function readWorkspace(root) {
  const file = path.join(root, WORKSPACE_FILE);
  if (!exists(file)) return null;
  const text = readText(file);
  const read = (key) => {
    const match = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(text);
    return match ? match[1].trim() : null;
  };
  return {
    version: Number(read('version')) || 4,
    topology: read('topology') || 'monorepo',
    backend: read('backend'),
    frontend: read('frontend'),
    contracts: read('contracts'),
    merge: read('merge'),
    raw: text,
  };
}

function openApiYaml() {
  return [
    'openapi: 3.0.3',
    'info:',
    '  title: SpecGate MVP API',
    '  version: 1.0.0',
    'paths:',
    '  /api/items:',
    '    get:',
    "      responses: { '200': { description: ok } }",
    '    post:',
    "      responses: { '201': { description: created }, '400': { description: invalid } }",
    '  /api/items/{id}:',
    '    get:',
    '      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]',
    "      responses: { '200': { description: ok }, '404': { description: missing } }",
    '    put:',
    "      responses: { '200': { description: ok }, '404': { description: missing }, '400': { description: invalid } }",
    '    delete:',
    "      responses: { '204': { description: deleted }, '404': { description: missing } }",
    '',
  ].join('\n');
}

function defaultRootState(selection) {
  return {
    schemaVersion: 4,
    workflowVersion: 4,
    phase: 'IDLE',
    change: null,
    type: null,
    workspace: {
      backend: selection.backend,
      frontend: selection.frontend,
      sides: selection.sides.map((side) => side.id),
    },
    updatedAt: new Date().toISOString(),
  };
}

function writeSide(sideRoot, side, requirements = null) {
  initProject(sideRoot);
  const config = readText(configPath(sideRoot));
  const patched = config
    .replace(/^workflowVersion:\s*3$/m, 'workflowVersion: 4')
    .replace(/^schemaVersion:\s*3$/m, 'schemaVersion: 4');
  writeText(configPath(sideRoot), patched + '\nstack: ' + side.stack + '\n');
  patchConfigRequirements(sideRoot, { enabled: true, version: 'v1.0' });
  const baseline =
    requirements && Array.isArray(requirements.functional) && requirements.functional.length
      ? {
          functional: requirements.functional,
          nonFunctional: requirements.nonFunctional || [],
          constraints: requirements.constraints || [],
          acceptance: requirements.acceptance || [],
        }
      : {
          functional: ['搭建框架'],
          nonFunctional: [],
          constraints: [],
          acceptance: ['脚手架可启动', 'Item CRUD 可运行', '测试/格式化/静态检查/走查通过'],
        };
  writeRequirementsBaseline(sideRoot, baseline, { version: 'v1.0' });
  ensureDir(path.join(sideRoot, 'openspec', 'changes'));
  ensureDir(path.join(sideRoot, 'openspec', 'specs'));
}

/**
 * Phase 1：只创建 workspace 布局、默认 REQ 与状态；不生成 CRUD、不做 git submodule。
 * 幂等：workspace.yaml 已存在时直接返回 skipped。
 */
export function createWorkspaceLayout({ root, selection, requirements = null }) {
  const workspaceFile = path.join(root, WORKSPACE_FILE);
  if (exists(workspaceFile)) {
    return { ok: true, skipped: true, root, workspace: readWorkspace(root) };
  }
  ensureDir(path.join(root, '.specgate'));
  ensureDir(path.join(root, 'contracts'));
  writeText(path.join(root, 'contracts', 'openapi.yaml'), openApiYaml());
  writeText(workspaceFile, workspaceYaml(selection));
  writeText(
    path.join(root, '.specgate', 'state.json'),
    JSON.stringify(defaultRootState(selection), null, 2) + '\n',
  );
  for (const side of selection.sides) {
    const sideRoot = path.join(root, side.path);
    ensureDir(sideRoot);
    writeSide(sideRoot, side, requirements);
  }
  return {
    ok: true,
    skipped: false,
    root,
    selection,
    sides: selection.sides.map((side) => side.path),
    workspace: readWorkspace(root),
  };
}

/** 只读扫描：识别空目录 / v3 / v4 / 有代码的存量仓库。 */
export function scanWorkspace(root) {
  const workspace = readWorkspace(root);
  if (workspace) {
    return { kind: 'v4', workspace, sides: workspaceYamlSides(workspace.raw) };
  }
  const configFile = path.join(root, '.specgate', 'config.yaml');
  if (exists(configFile)) {
    const config = readText(configFile);
    const version = Number((/workflowVersion:\s*(\d+)/.exec(config) || [])[1] || 3);
    return { kind: version >= 4 ? 'v4-partial' : 'v3', workflowVersion: version };
  }
  let entries = [];
  try {
    entries = fs.readdirSync(root).filter((name) => name !== '.git');
  } catch {
    entries = [];
  }
  if (entries.length === 0) return { kind: 'empty', entries: [] };
  const stacks = [];
  if (entries.includes('package.json')) stacks.push('node');
  if (entries.includes('pom.xml') || entries.includes('build.gradle')) stacks.push('java');
  if (entries.includes('pyproject.toml') || entries.includes('requirements.txt'))
    stacks.push('python');
  return { kind: 'existing', entries, stacks };
}

function workspaceYamlSides(raw) {
  const sides = [];
  const regex = /-\s+id:\s*(\S+)\n\s+path:\s*(\S+)\n\s+stack:\s*(\S+)\n\s+role:\s*(\S+)/g;
  let match = regex.exec(raw);
  while (match) {
    sides.push({ id: match[1], path: match[2], stack: match[3], role: match[4] });
    match = regex.exec(raw);
  }
  return sides;
}

export function workspaceSummary(root) {
  const scan = scanWorkspace(root);
  if (scan.kind === 'v4') {
    return (
      'SpecGate v4 workspace：' + scan.sides.map((side) => side.path + '=' + side.stack).join('，')
    );
  }
  if (scan.kind === 'v3') return 'SpecGate v3 项目（保持 v3 行为）';
  if (scan.kind === 'empty') return '空目录，可创建 v4 workspace';
  return '存量仓库（建议使用 --adopt）';
}
