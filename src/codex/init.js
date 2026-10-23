import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  javaFullstackFiles,
  normalizeProjectNamespace,
} from './core/java/java-fullstack-template.js';
import { goldenStatus, normalizeJavaPreset, templateHash } from './core/java/java-versions.js';
import { resolveGitIdentity } from './core/git-identity.js';
import { setupProject } from '../../scripts/codex-source-setup.mjs';
import { discoverJava } from './core/java/java-env.js';
import { publishInitialization } from './init-publication.js';
import { insideSpecGateSource } from './core/project-path.js';
import { removeTemporaryDirectory } from './core/temp.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RUNTIME_NAMES = [
  'state.json',
  'init-report.json',
  'init-result.json',
  'codex/state.json',
  'codex/events.jsonl',
  'codex/write.lock',
  'codex/worktrees/',
  'codex/evidence/',
  'codex/runs/',
  'codex/baseline-runs/',
  'codex/archive/',
  'codex/*-report.json',
  'codex/changes/*/evidence/',
  'codex/changes/*/red/',
  'codex/changes/*/quality/',
  'codex/changes/*/format/',
  'codex/changes/*/review/',
  'codex/changes/*/tests/',
  'codex-verify*',
  'verify-*',
  'verify.lock',
  'toolchain-paths.json',
  'toolchains/',
  'env.json',
  'env-report.md',
  'run.lock',
  'worktrees/',
  'evidence/',
  'backups/',
  'gates/',
  'runs/',
];
export const SPECGATE_GITIGNORE =
  '# Local SpecGate runtime state and evidence; stable configuration remains tracked.\n' +
  RUNTIME_NAMES.map((name) => '/' + name).join('\n') +
  '\n';
const ADAPTER_FILES = {
  '.specgate/.gitignore': SPECGATE_GITIGNORE,
};
const EXTRA_FILES = [
  ...Object.keys(ADAPTER_FILES),
  '.specgate/config.yaml',
  '.specgate/state.json',
  '.specgate/monorepo.json',
  '.specgate/golden.json',
  '.specgate/init-report.json',
  'openspec/specs/.gitkeep',
  'openspec/changes/.gitkeep',
  'openspec/REQ.md',
  'openspec/history/v1.0/REQ.md',
];
const MAX_ENTRIES = 10000;
const MAX_BYTES = 64 * 1024 * 1024;
const WORKER_PATH = fileURLToPath(new URL('./init-worker.js', import.meta.url));
const INIT_DIRECTORIES = new Set([
  '.git',
  '.codex',
  '.agents',
  '.specgate',
  'backend',
  'frontend',
  'scripts',
  'docs',
  'openspec',
]);
const RETAINED_RUNTIME = new Set(['node_modules', 'target', 'dist', 'coverage', '.idea', 'data']);

function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

const INIT_LOCK_STALE_MS = 10 * 60 * 1000;

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function staleInitializationLock(lockPath) {
  let owner = null;
  try {
    owner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
  } catch {
    // A lock from an interrupted older version has no owner record.
  }
  if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) return !processAlive(owner.pid);
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs > INIT_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function acquireInitializationLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(lockPath);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!staleInitializationLock(lockPath)) return false;
      try {
        fs.rmSync(lockPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      } catch {
        return false;
      }
      continue;
    }
    try {
      fs.writeFileSync(
        path.join(lockPath, 'owner.json'),
        JSON.stringify({ schemaVersion: 1, pid: process.pid, createdAt: new Date().toISOString() }),
        { flag: 'wx', mode: 0o600 },
      );
      return true;
    } catch (error) {
      try {
        fs.rmSync(lockPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      } catch {
        // preserve the original lock write failure
      }
      throw error;
    }
  }
  return false;
}

function releaseInitializationLock(lockPath) {
  try {
    fs.rmSync(lockPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    return true;
  } catch {
    return false;
  }
}

function checkedRoot(input) {
  if (
    typeof input !== 'string' ||
    !input ||
    !path.isAbsolute(input) ||
    input.split(/[\\/]/).includes('..')
  ) {
    fail('UNSAFE_INIT_PATH', '初始化路径必须为不含父目录跳转的绝对路径');
  }
  const root = path.resolve(input);
  if (root === path.parse(root).root) fail('UNSAFE_INIT_PATH', '不能初始化文件系统根目录');
  if (within(SOURCE_ROOT, root) || within(root, SOURCE_ROOT) || insideSpecGateSource(root)) {
    fail('INIT_SOURCE_TARGET_FORBIDDEN', '不能在 SpecGate 插件源码目录或其父目录执行初始化');
  }
  let ancestor = root;
  while (true) {
    if (fs.existsSync(ancestor)) {
      const stat = fs.lstatSync(ancestor);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        fail('UNSAFE_INIT_PATH', '初始化路径不能经过符号链接或文件');
    } else {
      try {
        if (fs.lstatSync(ancestor).isSymbolicLink())
          fail('UNSAFE_INIT_PATH', '初始化路径不能经过符号链接');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const parent = path.dirname(ancestor);
    if (ancestor === parent) break;
    ancestor = parent;
  }
  return root;
}

function scan(root, { targetScope = false } = {}) {
  const entries = [];
  let bytes = 0;
  function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const target = path.join(directory, name);
      const relative = path.relative(root, target).split(path.sep).join('/');
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) fail('UNSAFE_INIT_PATH', '目标包含符号链接：' + relative);
      if (!stat.isDirectory() && !stat.isFile())
        fail('UNSAFE_INIT_PATH', '目标包含非常规文件：' + relative);
      if (entries.length >= MAX_ENTRIES) fail('INIT_SCAN_LIMIT', '目录扫描超过文件数量上限');
      if (stat.isDirectory()) {
        entries.push({ path: relative, type: 'directory' });
        if (
          !targetScope ||
          (!RETAINED_RUNTIME.has(name) && (directory !== root || INIT_DIRECTORIES.has(name)))
        )
          visit(target);
      } else {
        bytes += stat.size;
        if (bytes > MAX_BYTES) fail('INIT_SCAN_LIMIT', '目录扫描超过 64 MiB 内容上限');
        entries.push({
          path: relative,
          type: 'file',
          hash: createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
          mode: stat.mode,
        });
      }
    }
  }
  const exists = fs.existsSync(root);
  if (exists) visit(root);
  return { exists, entries };
}

function entryKey(relative) {
  return process.platform === 'win32' ? relative.toLowerCase() : relative;
}

function snapshotHash(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function gitEnvironment({ emptyDirectory } = {}) {
  const configuration = emptyDirectory
    ? {
        GIT_TEMPLATE_DIR: emptyDirectory,
        GIT_CONFIG_COUNT: '6',
        GIT_CONFIG_KEY_0: 'init.templateDir',
        GIT_CONFIG_VALUE_0: emptyDirectory,
        GIT_CONFIG_KEY_1: 'core.hooksPath',
        GIT_CONFIG_VALUE_1: emptyDirectory,
        GIT_CONFIG_KEY_2: 'core.fsmonitor',
        GIT_CONFIG_VALUE_2: 'false',
        GIT_CONFIG_KEY_3: 'commit.gpgsign',
        GIT_CONFIG_VALUE_3: 'false',
        GIT_CONFIG_KEY_4: 'core.autocrlf',
        GIT_CONFIG_VALUE_4: 'false',
        GIT_CONFIG_KEY_5: 'core.longpaths',
        GIT_CONFIG_VALUE_5: 'true',
      }
    : {};
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
    ),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    ...configuration,
  };
}

function inspectGit(root) {
  let cwd = root;
  let steps = 0;
  while (!fs.existsSync(cwd)) {
    if (++steps > 128) fail('INIT_GIT_INSPECTION_FAILED', 'Git 祖先路径探测超过 128 层上限');
    const parent = path.dirname(cwd);
    if (parent === cwd) break;
    cwd = parent;
  }
  let markedRoot = null;
  let ancestor = cwd;
  for (let count = 0; count <= 128; count += 1) {
    if (fs.existsSync(path.join(ancestor, '.git'))) {
      markedRoot = ancestor;
      break;
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    if (count === 128) fail('INIT_GIT_INSPECTION_FAILED', 'Git 祖先仓库探测超过 128 层上限');
    ancestor = parent;
  }
  const git = (args) =>
    spawnSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.hooksPath=' + path.join(SOURCE_ROOT, '.codex-plugin', 'disabled-hooks'),
        ...args,
      ],
      {
        cwd,
        encoding: 'utf8',
        env: gitEnvironment(),
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
  const location = git(['rev-parse', '--absolute-git-dir']);
  if (location.error)
    fail('INIT_GIT_INSPECTION_FAILED', '无法只读探测已有 Git 仓库：' + location.error.message);
  if (location.status !== 0 && !markedRoot) return { repository: false, status: null };
  const top = location.status === 0 ? git(['rev-parse', '--show-toplevel']) : null;
  const repositoryRoot =
    top?.status === 0 ? top.stdout.trim() : markedRoot || location.stdout.trim();
  const status =
    location.status === 0 ? git(['status', '--porcelain=v1', '--untracked-files=all']) : location;
  return {
    repository: true,
    root: path.resolve(repositoryRoot),
    enclosing: path.relative(root, repositoryRoot) !== '',
    gitDirectory: location.status === 0 ? path.resolve(location.stdout.trim()) : null,
    bare: location.status === 0 && top?.status !== 0,
    status: status.status === 0 ? status.stdout : null,
    readable: status.status === 0,
    error:
      status.status === 0
        ? null
        : String(status.error?.message || status.stderr || 'git status failed').trim(),
  };
}

/** Read-only, bounded preview. No temporary directory, Git lock, install or generator is used. */
export function previewInit({
  root: inputRoot,
  preset: inputPreset,
  strategy = 'keep-missing',
  company = 'company',
  business = 'tasks',
  frontend = 'vue',
  gitName,
  gitEmail,
} = {}) {
  try {
    const root = checkedRoot(inputRoot);
    if (strategy !== 'keep-missing')
      return failure('INIT_OVERWRITE_UNSUPPORTED', '当前仅支持逐项保留冲突文件并补齐缺失文件');
    const normalized = normalizeJavaPreset(inputPreset);
    if (!normalized.ok) return normalized;
    const frontendChoice = String(frontend || 'vue').trim();
    if (!['vue', 'react'].includes(frontendChoice))
      return failure('INVALID_FRONTEND', 'frontend 必须是 vue 或 react');
    const namespace = normalizeProjectNamespace({ company, business });
    if (!namespace.ok) return namespace;
    const preset = normalized.preset;
    const snapshot = scan(root, { targetScope: true });
    if (snapshot.entries.some((entry) => entryKey(entry.path) === '.specgate'))
      return failure('ALREADY_INITIALIZED', '已有 .specgate，拒绝重新初始化');
    const templates = javaFullstackFiles({
      preset,
      company: namespace.company,
      business: namespace.business,
      frontend: frontendChoice,
    });
    const generated = [...new Set([...Object.keys(templates), ...EXTRA_FILES])].sort();
    const existing = new Map(snapshot.entries.map((entry) => [entryKey(entry.path), entry]));
    const conflicts = [];
    const newFiles = [];
    for (const relative of generated) {
      const target = path.resolve(root, relative);
      if (!within(root, target) || path.isAbsolute(relative))
        fail('UNSAFE_INIT_PATH', '不安全的模板路径：' + relative);
      const entry = existing.get(entryKey(relative));
      if (entry?.type === 'directory')
        return failure('INIT_PATH_CONFLICT', '预期文件与已有目录冲突：' + relative);
      const parents = relative.split('/').slice(0, -1);
      for (let i = 1; i <= parents.length; i += 1) {
        const parent = parents.slice(0, i).join('/');
        if (existing.get(entryKey(parent))?.type === 'file')
          return failure('INIT_PATH_CONFLICT', '预期目录与已有文件冲突：' + parent);
      }
      if (!entry) newFiles.push(relative);
      else if (
        !templates[relative] ||
        entry.hash !== createHash('sha256').update(templates[relative]).digest('hex')
      ) {
        conflicts.push({ path: relative, decision: 'keep' });
      }
    }
    const hash = templateHash(templates);
    const git = inspectGit(root);
    const gitIdentity = resolveGitIdentity({ root, gitName, gitEmail });
    const body = {
      root,
      preset: preset.id,
      frontend: frontendChoice,
      projectNamespace: {
        company: namespace.company,
        business: namespace.business,
        basePackage: namespace.basePackage,
      },
      strategy,
      templateHash: hash,
      snapshot,
      generated,
      git,
      gitIdentity,
    };
    const existingFiles = snapshot.entries
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.path);
    return {
      ok: true,
      root,
      preset: preset.id,
      frontend: frontendChoice,
      projectNamespace: {
        company: namespace.company,
        business: namespace.business,
        basePackage: namespace.basePackage,
        groupId: namespace.groupId,
        packagePath: namespace.packagePath,
      },
      strategy,
      nonEmpty: snapshot.entries.length > 0,
      targetExists: snapshot.exists,
      snapshotHash: snapshotHash(snapshot),
      previewHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      templateHash: hash,
      golden: goldenStatus(preset, hash, frontendChoice),
      gitIdentity,
      risks: [
        preset.legacy ? '兼容旧版本：Java 8 / Spring Boot 2.7 维护风险' : null,
        preset.preview ? 'preview：Spring Boot 4.0 预览版本风险' : null,
      ].filter(Boolean),
      files: {
        existing: existingFiles,
        new: newFiles,
        conflicts,
        overwrite: [],
        keep: existingFiles,
      },
      git,
    };
  } catch (error) {
    return failure(error.code || 'INIT_PREVIEW_FAILED', error.message);
  }
}

function unchanged(input, expected) {
  const current = previewInit(input);
  if (!current.ok) return current;
  return current.previewHash === expected
    ? current
    : failure('INIT_PREVIEW_STALE', '初始化预览已漂移，请重新预览和审批');
}

function generateStaging({
  root,
  preset,
  company,
  business,
  frontend,
  stageRoot,
  templateDirectory,
  signal,
}) {
  if (signal?.aborted)
    return Promise.resolve(failure('INIT_CANCELLED', '初始化已取消；未修改目标目录'));
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [WORKER_PATH, root, preset, JSON.stringify({ company, business, frontend })],
      {
        cwd: stageRoot,
        env: gitEnvironment({ emptyDirectory: templateDirectory }),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let diagnostic = '';
    let problem;
    const stop = (code, message) => {
      problem ||= failure(code, message);
      child.kill('SIGTERM');
    };
    const aborted = () => stop('INIT_CANCELLED', '初始化已取消；未修改目标目录');
    const timer = setTimeout(
      () => stop('INIT_WORKER_TIMEOUT', '隔离生成器超过 120 秒上限'),
      120000,
    );
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > 4 * 1024 * 1024)
        stop('INIT_WORKER_OUTPUT_LIMIT', '隔离生成器输出超过 4 MiB 上限');
    });
    child.stderr.on('data', (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-4096);
    });
    child.once('error', () => {
      problem ||= failure('INIT_WORKER_FAILED', '无法启动隔离生成器');
    });
    signal?.addEventListener('abort', aborted, { once: true });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      if (problem) return resolve(problem);
      try {
        const result = JSON.parse(output);
        if (!result || typeof result.ok !== 'boolean' || (result.ok && code !== 0))
          throw new Error('Invalid worker response');
        resolve(result);
      } catch {
        resolve(
          failure(
            'INIT_WORKER_FAILED',
            '隔离生成器未返回有效结果' + (diagnostic ? '：' + diagnostic : ''),
          ),
        );
      }
    });
  });
}

function baseline(root, created, report, templateDirectory, identity, bindingProject) {
  const git = (args) => {
    const step = spawnSync(
      'git',
      [
        '-c',
        'user.name=' + identity.name,
        '-c',
        'user.email=' + identity.email,
        '-c',
        'core.hooksPath=' + templateDirectory,
        '-c',
        'core.autocrlf=false',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: gitEnvironment({ emptyDirectory: templateDirectory }),
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (step.status !== 0) throw new Error(step.stderr || step.error?.message || 'git failed');
    return step.stdout.trim();
  };
  git(['init', '-q', '--template=' + templateDirectory]);
  git(['config', 'user.name', identity.name]);
  git(['config', 'user.email', identity.email]);
  report.projectSetup = setupProject({ project: root, bindingProject });
  // Explicit paths preserve preexisting business files without staging or committing them.
  const tracked = created.filter(
    (relative) => !['.specgate/state.json', '.specgate/init-report.json'].includes(relative),
  );
  git(['add', '-f', '--', ...tracked]);
  git([
    'commit',
    '--only',
    '--no-gpg-sign',
    '-q',
    '-m',
    'chore: initialize Codex Java Vue generated baseline',
    '--',
    ...tracked,
  ]);
  report.gitBaseline = {
    mandatory: true,
    status: 'passed',
    network: false,
    commit: git(['rev-parse', 'HEAD']),
    tag: 'init-baseline',
    scope: 'generated-files-only',
    trackedFiles: tracked,
  };
  fs.writeFileSync(
    path.join(root, '.specgate/init-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  git(['tag', 'init-baseline']);
}

/** approvalProvider is a server dependency, never an MCP/tool argument. */
export async function executeInit(
  input = {},
  { approvalProvider, signal, allowExistingGit = false, environmentGate } = {},
) {
  const preview = previewInit(input);
  if (!preview.ok) return preview;
  if (typeof input.previewHash !== 'string' || input.previewHash !== preview.previewHash)
    return failure('INIT_PREVIEW_STALE', '必须提供当前只读预览的 previewHash');
  if (
    preview.git.repository &&
    (!allowExistingGit ||
      preview.git.enclosing ||
      !fs.lstatSync(path.join(preview.root, '.git')).isDirectory())
  )
    return failure(
      'INIT_EXISTING_GIT_UNSUPPORTED',
      '已有 Git 仓库的基线迁入尚未支持；未修改文件、索引或历史',
    );
  if (signal?.aborted) return failure('INIT_CANCELLED', '初始化已取消；未修改目标目录');
  let approval = { source: 'empty-target-explicit-command' };
  if (preview.nonEmpty) {
    if (typeof approvalProvider?.requestApproval !== 'function')
      return failure(
        'TRUSTED_APPROVAL_UNAVAILABLE',
        '目录非空，初始化未执行：缺少服务端可信审批通道',
      );
    let answer;
    try {
      answer = await approvalProvider.requestApproval({
        action: 'init',
        root: preview.root,
        preset: preview.preset,
        previewHash: preview.previewHash,
        strategy: preview.strategy,
        conflicts: preview.files.conflicts,
        preview,
        signal,
      });
    } catch (error) {
      return failure('INIT_APPROVAL_FAILED', '目录非空，初始化未执行：' + error.message);
    }
    if (answer?.approved !== true)
      return failure('INIT_APPROVAL_DENIED', '目录非空，初始化未执行：审批未批准');
    if (
      answer.previewHash !== preview.previewHash ||
      !answer.receipt ||
      typeof answer.receipt.source !== 'string'
    )
      return failure(
        'INIT_APPROVAL_INVALID',
        '目录非空，初始化未执行：审批未绑定当前预览或缺少可信回执',
      );
    const decisions = Array.isArray(answer.conflicts) ? answer.conflicts : [];
    if (
      preview.files.conflicts.some(
        (entry) =>
          !decisions.some(
            (decision) => decision.path === entry.path && decision.decision === 'keep',
          ),
      )
    )
      return failure(
        'INIT_CONFLICT_APPROVAL_REQUIRED',
        '目录非空，初始化未执行：所有冲突必须逐项批准保留',
      );
    approval = { ...answer.receipt };
  }
  let checked = unchanged(input, preview.previewHash);
  if (!checked.ok) return checked;
  if (!preview.gitIdentity.ok) return preview.gitIdentity;
  if (environmentGate) {
    const readiness = await environmentGate({
      root: preview.root,
      preset: input.preset,
      frontend: input.frontend,
    });
    if (!readiness.environmentReady)
      return {
        ...readiness,
        ok: false,
        code: readiness.code || 'ENV_NOT_READY',
        selectionRetained: true,
      };
  }
  let stageRoot;
  let lockPath;
  let lockAcquired = false;
  try {
    lockPath = path.join(
      os.tmpdir(),
      'sg-codex-init-' + createHash('sha256').update(preview.root).digest('hex') + '.lock',
    );
    if (!acquireInitializationLock(lockPath)) {
      lockPath = null;
      return failure('INIT_BUSY', '此目录已有初始化操作或未清理的初始化锁，未修改目标目录');
    }
    lockAcquired = true;
    checked = unchanged(input, preview.previewHash);
    if (!checked.ok) return checked;
    stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-init-'));
    const generatedRoot = path.join(stageRoot, 'generated');
    const templateDirectory = path.join(stageRoot, 'empty-git-template');
    fs.mkdirSync(templateDirectory);
    const generated = await generateStaging({
      root: generatedRoot,
      preset: preview.preset,
      company: preview.projectNamespace.company,
      business: preview.projectNamespace.business,
      frontend: preview.frontend,
      stageRoot,
      templateDirectory,
      signal,
    });
    if (!generated.ok)
      return failure(
        generated.code === 'INIT_CANCELLED' ? generated.code : 'INIT_GENERATION_FAILED',
        generated.message,
        { cause: generated.code },
      );
    if (signal?.aborted) return failure('INIT_CANCELLED', '初始化已取消；未修改目标目录');
    for (const [relative, content] of Object.entries(ADAPTER_FILES))
      fs.writeFileSync(path.join(generatedRoot, relative), content, { flag: 'wx' });
    const generatedEntries = scan(generatedRoot).entries;
    const actualFiles = generatedEntries
      .filter((entry) => entry.type === 'file' && !entry.path.startsWith('.git/'))
      .map((entry) => entry.path)
      .sort();
    const expectedFiles = [
      ...new Set([
        ...Object.keys(
          javaFullstackFiles({
            preset: normalizeJavaPreset(preview.preset).preset,
            company: preview.projectNamespace.company,
            business: preview.projectNamespace.business,
            frontend: preview.frontend,
          }),
        ),
        ...EXTRA_FILES,
      ]),
    ].sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles))
      return failure('INIT_MANIFEST_DRIFT', '生成文件清单与只读预览不一致，未修改目标目录');
    const targetStage = path.join(stageRoot, 'target');
    fs.mkdirSync(targetStage);
    // Mirror only inspected files, never copy other projects or runtime trees.
    const originalSnapshot = scan(preview.root, { targetScope: true });
    for (const entry of originalSnapshot.entries.filter((item) => item.type === 'file')) {
      const target = path.join(targetStage, entry.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(preview.root, entry.path), target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, entry.mode);
    }
    scan(targetStage);
    for (const entry of generatedEntries.filter(
      (entry) =>
        entry.type === 'directory' && entry.path !== '.git' && !entry.path.startsWith('.git/'),
    )) {
      fs.mkdirSync(path.join(targetStage, entry.path), { recursive: true });
    }
    for (const relative of preview.files.new) {
      const source = path.join(generatedRoot, relative);
      const target = path.join(targetStage, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, fs.statSync(source).mode);
    }
    const report = generated.report;
    report.approval = {
      ...approval,
      root: preview.root,
      previewHash: preview.previewHash,
      strategy: preview.strategy,
      confirmedAt: new Date().toISOString(),
    };
    report.codexInit = {
      stateAuthority: 'legacy-compatibility-only',
      generated: preview.files.new,
      kept: preview.files.keep,
      conflicts: preview.files.conflicts,
      overwritten: [],
      baselineScope: 'generated-files-only',
    };
    report.template.source = 'codex-java-vue-template';
    report.template.contentMatchesTemplate = preview.files.conflicts.length === 0;
    report.gitBaseline = { mandatory: true, status: 'pending', network: false, tag: null };
    fs.writeFileSync(
      path.join(targetStage, '.specgate/init-report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    baseline(
      targetStage,
      preview.files.new,
      report,
      templateDirectory,
      preview.gitIdentity,
      preview.root,
    );
    // Per-project local secrets are not template inputs or Git baseline contents.
    const java = discoverJava().homes.find(
      (entry) => String(entry.major) === normalizeJavaPreset(preview.preset).preset.jdk,
    );
    const createdLocalEnvironment = !fs.existsSync(path.join(targetStage, '.env'));
    if (createdLocalEnvironment)
      fs.writeFileSync(
        path.join(targetStage, '.env'),
        `# 本地演示账号 admin / admin、viewer / viewer；不要提交此文件。\nAPP_LOCAL_DEMO=true\nAPP_ADMIN_PASSWORD=admin\nAPP_VIEWER_PASSWORD=viewer\n${java ? 'JAVA_HOME=' + java.home.replaceAll('\\', '/') + '\n' : ''}`,
        { flag: 'wx', mode: 0o600 },
      );
    report.environmentPreparation = {
      java: java ? 'existing-installation' : 'missing',
      credentials: 'local-env-file',
      verification: 'not-run',
    };
    fs.writeFileSync(
      path.join(targetStage, '.specgate/init-report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    if (signal?.aborted) return failure('INIT_CANCELLED', '初始化已取消；未修改目标目录');
    checked = unchanged(input, preview.previewHash);
    if (!checked.ok) return checked;
    publishInitialization({
      source: targetStage,
      target: preview.root,
      snapshot: scan(preview.root, { targetScope: true }),
      files: scan(targetStage)
        .entries.filter((entry) => entry.type === 'file')
        .map((entry) => entry.path),
      managedPaths: report.projectSetup.changed,
      existingGit: preview.git.repository,
    });
    return {
      ok: true,
      code: 'GENERATED_ONLY',
      phase: 'GENERATED_ONLY',
      root: preview.root,
      generated: true,
      report,
      risks: preview.risks,
      login: createdLocalEnvironment
        ? {
            admin: { username: 'admin', password: 'admin' },
            viewer: { username: 'viewer', password: 'viewer' },
            message: '本地演示默认账号：admin / admin。部署时关闭 APP_LOCAL_DEMO 并设置强密码。',
          }
        : { message: '保留已有 .env 账号配置，请使用其中设置的密码登录；未擅自重置密码。' },
      message: '仅生成完成；尚未安装、编译或执行验证。',
    };
  } catch (error) {
    return failure(error.code || 'INIT_GENERATION_FAILED', error.message, {
      root: preview.root,
      generated: false,
    });
  } finally {
    if (stageRoot) {
      try {
        removeTemporaryDirectory(stageRoot, { maxRetries: 20, retryDelay: 100 });
      } catch (error) {
        process.stderr.write(
          `[specgate] initialization staging cleanup failed: ${error.message}\n`,
        );
      }
    }
    if (lockAcquired && !releaseInitializationLock(lockPath))
      process.stderr.write(`[specgate] initialization lock cleanup failed: ${lockPath}\n`);
  }
}
