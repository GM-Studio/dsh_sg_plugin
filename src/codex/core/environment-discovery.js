import fs from 'node:fs';
import path from 'node:path';
import {
  discoverJava,
  discoverMaven,
  discoverNode,
  javaRoots,
  mavenRoots,
  probeTool,
} from './java/java-env.js';
import { matchesVersion } from './env/version-range.js';

export function executableCandidates(name, { env, platform, roots = [] }) {
  const suffixes = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = [
    ...roots,
    ...String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':'),
  ]
    .filter(Boolean)
    .slice(0, 128);
  return [
    ...new Set(
      dirs.flatMap((dir) =>
        suffixes.map((suffix) => path.join(dir.replace(/^"|"$/g, ''), name + suffix)),
      ),
    ),
  ].filter((file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

export function discoverRequiredEnvironment({ root, selection, env, platform, cacheRoot }) {
  const requirements = selection.requirements;
  const tools = {};
  const compatible = (id, version) =>
    requirements
      .filter((entry) => entry.id === id)
      .every((entry) =>
        entry.constraints.every((constraint) => matchesVersion(version, constraint)),
      );
  let caches = [];
  try {
    caches = fs
      .readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .slice(0, 64)
      .map((entry) => path.join(cacheRoot, entry.name));
  } catch {
    /* No managed cache. */
  }
  const commonRoots = caches.flatMap((home) => [
    home,
    path.join(home, 'bin'),
    path.join(home, 'Scripts'),
    path.join(home, 'node_modules', '.bin'),
  ]);
  let javaHomes;
  for (const requirement of requirements) {
    const { id } = requirement;
    if (id === 'node') {
      tools.node = discoverNode({
        env,
        platform,
        extraRoots: caches,
        acceptVersion: (version) => compatible(id, version),
      });
      continue;
    }
    if (/^jdk\d*$/.test(id)) {
      javaHomes ||= discoverJava({
        env,
        platform,
        roots: [
          cacheRoot,
          path.join(root, '.specgate/toolchains'),
          ...javaRoots({ env, platform }),
        ],
      }).homes;
      tools[id] = javaHomes.find((entry) => compatible(id, String(entry.major)));
      continue;
    }
    if (id === 'maven') {
      const java = Object.entries(tools).find(
        ([key, value]) => key.startsWith('jdk') && value,
      )?.[1];
      tools.maven = discoverMaven({
        env: { ...env, ...(java ? { JAVA_HOME: java.home } : {}) },
        platform,
        roots: [cacheRoot, ...mavenRoots({ env, platform })],
        acceptVersion: (version) => compatible(id, version),
      });
      continue;
    }
    const names = id === 'python' ? ['python3', 'python'] : [id];
    const roots = [...commonRoots];
    if (id === 'python') {
      roots.unshift(
        ...requirements
          .filter((entry) => entry.id === id)
          .flatMap((entry) =>
            entry.modules.map((module) =>
              path.join(root, module, '.venv', platform === 'win32' ? 'Scripts' : 'bin'),
            ),
          ),
      );
      if (env.CONDA_PREFIX) roots.push(env.CONDA_PREFIX, path.join(env.CONDA_PREFIX, 'bin'));
    }
    if (id === 'go' && env.GOROOT) roots.unshift(path.join(env.GOROOT, 'bin'));
    if (platform !== 'win32') roots.push('/usr/local/bin', '/usr/bin');
    const binaries = names
      .flatMap((name) => executableCandidates(name, { env, platform, roots }))
      .slice(0, 16);
    for (const bin of binaries) {
      const args = id === 'go' ? ['version'] : id === 'git' ? ['--version'] : ['--version'];
      const output = probeTool(bin, args, 2500, env);
      const version =
        id === 'go'
          ? /go(\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1]
          : /(?:Python\s+|git version\s+|Gradle\s+|(?:uv|Poetry)\s+)?(\d+\.\d+(?:\.\d+)?)/i.exec(
              output,
            )?.[1];
      if (version && compatible(id, version)) {
        tools[id] = { path: bin, version };
        break;
      }
    }
  }
  return tools;
}
