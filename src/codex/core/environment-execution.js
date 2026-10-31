import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { matchesVersion } from './env/version-range.js';

function localPython(cwd) {
  if (!cwd) return null;
  const home = path.join(cwd, '.venv');
  const executable = path.join(
    home,
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  return fs.existsSync(path.join(home, 'pyvenv.cfg')) && fs.existsSync(executable)
    ? executable
    : null;
}

function projectEnvironment(env, cwd) {
  const python = localPython(cwd);
  if (python) {
    env.VIRTUAL_ENV = path.join(cwd, '.venv');
    env.PYTHONNOUSERSITE = '1';
    delete env.PYTHONHOME;
    env.PATH = path.dirname(python) + path.delimiter + (env.PATH || env.Path || '');
  }
  env.POETRY_VIRTUALENVS_IN_PROJECT = 'true';
  return env;
}

const reserved = [
  'PATH',
  'JAVA_HOME',
  'SG_JAVA_HOME',
  'MAVEN_HOME',
  'M2_HOME',
  'GOROOT',
  'GOTOOLCHAIN',
  'PYTHONHOME',
  'VIRTUAL_ENV',
];

export function environmentExecutionContext(
  report,
  { env = process.env, root = report?.projectRoot } = {},
) {
  if (!report?.environmentReady)
    return { ok: false, code: report?.code || 'ENV_NOT_READY', report };
  const tools = report.tools || {},
    next = { ...env };
  for (const key of Object.keys(next)) if (key.toUpperCase() === 'PATH') delete next[key];
  const directories = [];
  for (const [id, tool] of Object.entries(tools)) {
    if (!tool) continue;
    const executable = tool.node || tool.path || tool.java;
    if (executable && path.isAbsolute(executable)) directories.push(path.dirname(executable));
    if (id.startsWith('jdk') && tool.home) {
      next.JAVA_HOME ||= tool.home;
      directories.push(path.join(tool.home, 'bin'));
    }
  }
  const java = Object.entries(tools).find(([key, value]) => key.startsWith('jdk') && value)?.[1];
  if (java) Object.assign(next, { JAVA_HOME: java.home, SG_JAVA_HOME: java.home });
  if (tools.maven?.home)
    Object.assign(next, { MAVEN_HOME: tools.maven.home, M2_HOME: tools.maven.home });
  if (tools.go?.path)
    Object.assign(next, {
      GOROOT: path.dirname(path.dirname(tools.go.path)),
      GOTOOLCHAIN: 'local',
    });
  if (tools.python) delete next.PYTHONHOME;
  const inheritedPath = env.PATH || env.Path || '';
  next.PATH = [
    ...new Set([...directories, ...inheritedPath.split(path.delimiter)].filter(Boolean)),
  ].join(path.delimiter);
  return { ok: true, report, tools, env: next, root: path.resolve(root) };
}

export function executionEnvironment(context, overrides = {}, cwd = context?.root) {
  if (!context) return projectEnvironment({ ...process.env, ...overrides }, cwd);
  const env = { ...context.env, ...overrides };
  for (const key of reserved) {
    if (context.env[key] !== undefined) env[key] = context.env[key];
    else delete env[key];
  }
  const relative = path.relative(context.root, cwd || context.root).replaceAll('\\', '/') || '.';
  const requirement = context.report.selection?.requirements
    ?.filter(
      (entry) =>
        entry.id.startsWith('jdk') &&
        entry.modules.some(
          (module) => module === '.' || relative === module || relative.startsWith(module + '/'),
        ),
    )
    .sort(
      (left, right) =>
        Math.max(...right.modules.map((module) => module.length)) -
        Math.max(...left.modules.map((module) => module.length)),
    )[0];
  const java = requirement && context.tools[requirement.id];
  if (java) {
    Object.assign(env, { JAVA_HOME: java.home, SG_JAVA_HOME: java.home });
    env.PATH = path.join(java.home, 'bin') + path.delimiter + env.PATH;
  }
  return projectEnvironment(env, cwd);
}

export function resolveEnvironmentCommand(argv, context, cwd = context?.root) {
  if (/[\\/]/.test(argv[0])) return [...argv];
  const name = argv[0].replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase();
  if (['python', 'python3'].includes(name) && !(argv[1] === '-m' && argv[2] === 'venv')) {
    const python = localPython(cwd);
    if (python) {
      const probe = spawnSync(python, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        env: executionEnvironment(context, {}, cwd),
      });
      const version = /Python\s+(\d+\.\d+\.\d+)/.exec(
        `${probe.stdout || ''}${probe.stderr || ''}`,
      )?.[1];
      const constraints =
        context?.report?.selection?.requirements
          ?.filter((entry) => entry.id === 'python')
          .flatMap((entry) => entry.constraints) || [];
      if (
        probe.status !== 0 ||
        !version ||
        !constraints.every((constraint) => matchesVersion(version, constraint))
      )
        throw new Error(
          'Project virtual environment is unavailable or incompatible; repair it before retrying',
        );
      return [python, ...argv.slice(1)];
    }
  }
  if (!context) return [...argv];
  const tools = context.tools;
  const selectedHome = executionEnvironment(context, {}, cwd).JAVA_HOME;
  const java = Object.entries(tools).find(
    ([id, entry]) => id.startsWith('jdk') && entry?.home === selectedHome,
  )?.[1];
  const executable =
    name === 'node'
      ? tools.node?.node
      : name === 'npm'
        ? tools.node?.npm
        : name === 'mvn'
          ? tools.maven?.path
          : name === 'java'
            ? java?.java
            : name === 'javac'
              ? java?.javac
              : name === 'gofmt' && tools.go?.path
                ? path.join(
                    path.dirname(tools.go.path),
                    process.platform === 'win32' ? 'gofmt.exe' : 'gofmt',
                  )
                : tools[name === 'python3' ? 'python' : name]?.path;
  if (!executable) return [...argv];
  if (/\.[cm]?js$/i.test(executable))
    return [tools.node?.node || process.execPath, executable, ...argv.slice(1)];
  return [executable, ...argv.slice(1)];
}
