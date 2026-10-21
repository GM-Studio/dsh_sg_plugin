import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, exists, readText, writeText } from '../v3/util/fsx.js';
import { initProject, configPath, patchConfigRequirements } from '../v3/change.js';
import { writeRequirementsBaseline } from '../v3/requirements.js';
import { CATALOG_VERSION } from './catalog.js';

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

function sideDetailLines(side) {
  const deps = side.dependencies || {};
  const rows = [
    ['framework', side.framework],
    ['runtime', side.runtimeVersion],
    ['buildTool', side.buildTool],
    ['bootVersion', side.bootVersion],
    ['packageManager', side.packageManager],
    ['language', side.language],
    ['depsPreset', deps.preset],
    ['requiredDeps', (deps.required || []).join(',')],
    ['optionalDeps', (deps.optional || []).join(',')],
  ];
  return rows
    .filter(([, value]) => value !== null && value !== undefined && String(value) !== '')
    .map(([key, value]) => '    ' + key + ': ' + value);
}

export function workspaceYamlDetailed(selection, options = {}) {
  const approval = options.approval || 'pending';
  const lines = [
    'version: 4',
    'catalog: ' + CATALOG_VERSION,
    'approval: ' + approval,
    'topology: monorepo',
    'backend: ' + selection.backend,
    'frontend: ' + selection.frontend,
    'contracts: contracts/openapi.yaml',
    'merge: no-ff',
    'sides:',
  ];
  for (const side of selection.sides) {
    lines.push('  - id: ' + side.id);
    lines.push('    path: ' + side.path);
    lines.push('    stack: ' + side.stack);
    lines.push('    role: ' + side.role);
    lines.push(...sideDetailLines(side));
  }
  lines.push('');
  return lines.join('\n');
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
  return fs
    .readFileSync(new URL('../../assets/scaffold/openapi.yaml', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
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
export function createWorkspaceLayout({ root, selection, requirements = null, approval = null }) {
  const workspaceFile = path.join(root, WORKSPACE_FILE);
  if (exists(workspaceFile)) {
    return { ok: true, skipped: true, root, workspace: readWorkspace(root) };
  }
  ensureDir(path.join(root, '.specgate'));
  ensureDir(path.join(root, 'contracts'));
  writeText(path.join(root, 'contracts', 'openapi.yaml'), openApiYaml());
  writeText(workspaceFile, workspaceYamlDetailed(selection, { approval }));
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

function yamlScalar(block, key) {
  const match = new RegExp('(?:^|\\n)\\s*(?:-\\s+)?' + key + ':\\s*(.+)$', 'm').exec(block);
  return match ? match[1].trim() : null;
}

function workspaceYamlSides(raw) {
  const sides = [];
  for (const block of String(raw).split(/\n(?= {2}- id: )/)) {
    const id = yamlScalar(block, 'id');
    if (!id) continue;
    const side = {
      id,
      path: yamlScalar(block, 'path'),
      stack: yamlScalar(block, 'stack'),
      role: yamlScalar(block, 'role'),
    };
    for (const [key, field] of [
      ['framework', 'framework'],
      ['runtime', 'runtimeVersion'],
      ['buildTool', 'buildTool'],
      ['bootVersion', 'bootVersion'],
      ['packageManager', 'packageManager'],
      ['language', 'language'],
      ['depsPreset', 'depsPreset'],
    ]) {
      const value = yamlScalar(block, key);
      if (value) side[field] = value;
    }
    for (const [key, field] of [
      ['requiredDeps', 'requiredDeps'],
      ['optionalDeps', 'optionalDeps'],
    ]) {
      const value = yamlScalar(block, key);
      if (value !== null) side[field] = value ? value.split(',').map((item) => item.trim()) : [];
    }
    sides.push(side);
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
