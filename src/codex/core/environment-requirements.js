import fs from 'node:fs';
import path from 'node:path';
import { detectStack } from './discovery/stack.js';
import { deriveCapabilities } from './env/capability.js';

const read = (file) => {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size < 1024 * 1024
      ? fs.readFileSync(file, 'utf8')
      : '';
  } catch {
    return '';
  }
};
const json = (file) => {
  try {
    return JSON.parse(read(file));
  } catch {
    return {};
  }
};

export function projectToolRequirements(root, input = {}) {
  const detected = detectStack({ root });
  const requirements = [{ id: 'git', constraints: [], modules: ['.'] }];
  const unsupported = [];
  const add = (id, constraint, module = '.') => {
    let entry = requirements.find((item) => item.id === id);
    if (!entry) {
      entry = { id, constraints: [], modules: [] };
      requirements.push(entry);
    }
    if (constraint && !entry.constraints.includes(constraint)) entry.constraints.push(constraint);
    if (!entry.modules.includes(module)) entry.modules.push(module);
  };
  const modules = detected.ok ? detected.modules : [];
  if (modules.length) {
    const derived = deriveCapabilities({
      modules,
      tasks: modules.flatMap((entry) =>
        entry.buildSystems.map((buildSystem) => ({
          id: entry.id + '-' + buildSystem,
          module: entry.id,
          buildSystem,
        })),
      ),
    });
    for (const gap of derived.gaps || [])
      if (gap.reason === 'unknown-build-system') unsupported.push(gap.detail);
    for (const module of modules) {
      const directory = path.join(root, module.root);
      for (const system of module.buildSystems) {
        if (
          system === 'make' &&
          module.buildSystems.some((entry) =>
            ['npm', 'maven', 'gradle', 'python', 'go'].includes(entry),
          )
        )
          continue;
        if (system === 'npm') {
          const manifest = json(path.join(directory, 'package.json'));
          const constraint =
            read(path.join(directory, '.nvmrc')).trim().replace(/^v/, '') ||
            read(path.join(directory, '.node-version')).trim() ||
            manifest.engines?.node ||
            '';
          add('node', constraint, module.root);
          const manager =
            String(manifest.packageManager || '').split('@')[0] || module.packageManager || 'npm';
          if (['pnpm', 'yarn'].includes(manager))
            add(
              manager,
              String(manifest.packageManager || '').slice(manager.length + 1),
              module.root,
            );
          else if (manager !== 'npm') unsupported.push('未适配包管理器：' + manager);
        } else if (system === 'python') {
          const pyproject = read(path.join(directory, 'pyproject.toml'));
          const constraint =
            read(path.join(directory, '.python-version')).trim() ||
            /requires-python\s*=\s*["']([^"']+)/.exec(pyproject)?.[1] ||
            '';
          add('python', constraint, module.root);
          if (fs.existsSync(path.join(directory, 'uv.lock'))) add('uv', '', module.root);
          if (fs.existsSync(path.join(directory, 'poetry.lock'))) add('poetry', '', module.root);
        } else if (system === 'go') {
          const mod = read(path.join(directory, 'go.mod'));
          const version = /^\s*go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(mod)?.[1];
          add('go', version ? '>=' + version : '', module.root);
        } else if (system === 'maven' || system === 'gradle') {
          const pom = read(path.join(directory, 'pom.xml'));
          const gradle =
            read(path.join(directory, 'build.gradle')) +
            read(path.join(directory, 'build.gradle.kts'));
          const major =
            /<(?:java.version|maven.compiler.release|maven.compiler.source)>\s*(?:1\.)?(\d+)/.exec(
              pom,
            )?.[1] ||
            /(?:JavaLanguageVersion\.of\(|VERSION_|sourceCompatibility\s*=\s*["']?)(\d+)/.exec(
              gradle,
            )?.[1];
          add(major ? 'jdk' + major : 'jdk', major || '', module.root);
          add(system, '', module.root);
        } else unsupported.push('未适配环境执行器：' + system);
      }
    }
  } else if (input.stack) {
    if (['node', 'react', 'vue'].includes(input.stack)) add('node', input.nodeVersion || '');
    else if (input.stack === 'python') add('python', input.pythonVersion || '');
    else if (input.stack === 'go') add('go', input.goVersion || '');
    else if (input.stack === 'java') {
      add(input.javaVersion ? 'jdk' + input.javaVersion : 'jdk', input.javaVersion || '');
      add(input.buildTool || 'maven', '');
    } else unsupported.push('未适配技术栈：' + input.stack);
    if (['vue', 'react'].includes(input.frontend)) add('node', input.nodeVersion || '');
    if (['pnpm', 'yarn'].includes(input.packageManager)) add(input.packageManager, '');
  }
  if (requirements.length === 1) return {};
  return { stack: detected.stack || input.stack, requirements, unsupported, modules };
}
