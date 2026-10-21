import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { javaFullstackFiles } from './core/java/java-fullstack-template.js';
import { goldenStatus, normalizeJavaPreset, templateHash } from './core/java/java-versions.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RUNTIME_NAMES = [
  'state.json',
  'init-report.json',
  'init-result.json',
  'codex/',
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
const ADAPTER_FILES = {
  '.specgate/.gitignore':
    '# Local SpecGate runtime state and evidence; stable configuration remains tracked.\n' +
    RUNTIME_NAMES.map((name) => '/' + name).join('\n') +
    '\n',
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
  if (within(SOURCE_ROOT, root) || within(root, SOURCE_ROOT)) {
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

function scan(root) {
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
} = {}) {
  try {
    const root = checkedRoot(inputRoot);
    if (strategy !== 'keep-missing')
      return failure('INIT_OVERWRITE_UNSUPPORTED', '当前仅支持逐项保留冲突文件并补齐缺失文件');
    const normalized = normalizeJavaPreset(inputPreset);
    if (!normalized.ok) return normalized;
    const preset = normalized.preset;
    const snapshot = scan(root);
    if (snapshot.entries.some((entry) => entryKey(entry.path) === '.specgate'))
      return failure('ALREADY_INITIALIZED', '已有 .specgate，拒绝重新初始化');
    const templates = javaFullstackFiles({ preset });
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
    const body = {
      root,
      preset: preset.id,
      strategy,
      templateHash: hash,
      snapshot,
      generated,
      git,
    };
    const existingFiles = snapshot.entries
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.path);
    return {
      ok: true,
      root,
      preset: preset.id,
      strategy,
      nonEmpty: snapshot.entries.length > 0,
      targetExists: snapshot.exists,
      snapshotHash: snapshotHash(snapshot),
      previewHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      templateHash: hash,
      golden: goldenStatus(preset, hash),
      risks: [
        preset.legacy ? 'legacy：Java 8 / Spring Boot 2.7 维护风险' : null,
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

function generateStaging({ root, preset, stageRoot, templateDirectory, signal }) {
  if (signal?.aborted)
    return Promise.resolve(failure('INIT_CANCELLED', '初始化已取消；未修改目标目录'));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER_PATH, root, preset], {
      cwd: stageRoot,
      env: gitEnvironment({ emptyDirectory: templateDirectory }),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

function baseline(root, created, report, templateDirectory) {
  const git = (args) => {
    const step = spawnSync(
      'git',
      [
        '-c',
        'user.name=SpecGate',
        '-c',
        'user.email=specgate@local',
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
  // Explicit paths preserve preexisting business files without staging or committing them.
  const tracked = created.filter(
    (relative) => !['.specgate/state.json', '.specgate/init-report.json'].includes(relative),
  );
  git(['add', '-f', '--', ...tracked]);
  git([
    'commit',
    '--no-gpg-sign',
    '-q',
    '-m',
    'chore: initialize Codex Java Vue generated baseline',
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
export async function executeInit(input = {}, { approvalProvider, signal } = {}) {
  const preview = previewInit(input);
  if (!preview.ok) return preview;
  if (typeof input.previewHash !== 'string' || input.previewHash !== preview.previewHash)
    return failure('INIT_PREVIEW_STALE', '必须提供当前只读预览的 previewHash');
  if (preview.git.repository)
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
  let stageRoot;
  let preserveStage = false;
  let lockPath;
  try {
    fs.mkdirSync(path.dirname(preview.root), { recursive: true });
    lockPath = path.join(
      path.dirname(preview.root),
      '.' + path.basename(preview.root) + '.sg-codex-init.lock',
    );
    try {
      fs.mkdirSync(lockPath);
    } catch (error) {
      lockPath = null;
      if (error.code === 'EEXIST')
        return failure('INIT_BUSY', '此目录已有初始化操作或未清理的初始化锁，未修改目标目录');
      throw error;
    }
    checked = unchanged(input, preview.previewHash);
    if (!checked.ok) return checked;
    stageRoot = fs.mkdtempSync(
      path.join(path.dirname(preview.root), '.' + path.basename(preview.root) + '.sg-codex-'),
    );
    const generatedRoot = path.join(stageRoot, 'generated');
    const templateDirectory = path.join(stageRoot, 'empty-git-template');
    fs.mkdirSync(templateDirectory);
    const generated = await generateStaging({
      root: generatedRoot,
      preset: preview.preset,
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
        ...Object.keys(javaFullstackFiles({ preset: normalizeJavaPreset(preview.preset).preset })),
        ...EXTRA_FILES,
      ]),
    ].sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles))
      return failure('INIT_MANIFEST_DRIFT', '生成文件清单与只读预览不一致，未修改目标目录');
    const targetStage = path.join(stageRoot, 'target');
    if (preview.targetExists)
      fs.cpSync(preview.root, targetStage, { recursive: true, dereference: false });
    else fs.mkdirSync(targetStage);
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
    baseline(targetStage, preview.files.new, report, templateDirectory);
    if (signal?.aborted) return failure('INIT_CANCELLED', '初始化已取消；未修改目标目录');
    checked = unchanged(input, preview.previewHash);
    if (!checked.ok) return checked;
    // The original tree stays recoverable until its complete replacement has been promoted.
    const backup = path.join(stageRoot, 'original');
    if (preview.targetExists) fs.renameSync(preview.root, backup);
    try {
      if (preview.targetExists && snapshotHash(scan(backup)) !== preview.snapshotHash)
        fail('INIT_PREVIEW_STALE', '目录提升前检测到目标变化，恢复原目录并拒绝初始化');
      fs.renameSync(targetStage, preview.root);
    } catch (error) {
      if (preview.targetExists) {
        try {
          fs.renameSync(backup, preview.root);
        } catch (restoreError) {
          preserveStage = true;
          return failure(
            'INIT_RECOVERY_REQUIRED',
            '目录提升失败且原目录恢复失败：' + restoreError.message,
            { recoveryPath: backup, root: preview.root },
          );
        }
      }
      throw error;
    }
    return {
      ok: true,
      code: 'GENERATED_ONLY',
      phase: 'GENERATED_ONLY',
      root: preview.root,
      generated: true,
      report,
      risks: preview.risks,
      message: '仅生成完成；尚未安装、编译或执行验证。',
    };
  } catch (error) {
    return failure(
      error.code === 'INIT_PREVIEW_STALE' ? error.code : 'INIT_GENERATION_FAILED',
      error.message,
      {
        root: preview.root,
        generated: false,
      },
    );
  } finally {
    if (stageRoot && !preserveStage) {
      try {
        fs.rmSync(stageRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // A locked staging directory never changes the promoted result or deletes the target.
      }
    }
    if (lockPath) {
      try {
        fs.rmdirSync(lockPath);
      } catch {
        // Keep an unexpected/occupied lock for explicit recovery rather than removing its contents.
      }
    }
  }
}
