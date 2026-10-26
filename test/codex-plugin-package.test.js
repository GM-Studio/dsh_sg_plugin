import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('default MCP static import graph excludes optional control, notification and installer code', () => {
  const pending = [path.join(root, 'src/codex/server.js')];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    const imports = [
      ...source.matchAll(/(?:^|\n)\s*import\s+(?:[^;]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm),
      ...source.matchAll(/(?:^|\n)\s*export\s+[^;]*?\s+from\s+['"](\.[^'"]+)['"]/gm),
    ];
    for (const match of imports) {
      const target = path.resolve(path.dirname(file), match[1]);
      assert.equal(fs.existsSync(target), true, `${file} -> ${match[1]}`);
      pending.push(target);
    }
  }
  const graph = [...seen].map((file) => path.relative(root, file).replace(/\\/g, '/'));
  assert.ok(graph.length > 20, 'the assertion must traverse the real MCP graph');
  assert.ok(
    graph.every((file) => !/(?:^|\/)(?:control|management|channels)(?:\/|$)/.test(file)),
    graph.join('\n'),
  );
  assert.ok(
    graph.every((file) => !/environment-install|mysql-repository/.test(file)),
    graph.join('\n'),
  );
});

test('Core v1 installation and lockfile have no MySQL driver dependency', () => {
  const manifest = readJson(path.join(root, 'package.json'));
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ])
    assert.equal(Object.hasOwn(manifest[field] || {}, 'mysql2'), false, field);
  assert.equal((manifest.bundledDependencies || []).includes('mysql2'), false);
  const lock = readJson(path.join(root, 'package-lock.json'));
  assert.equal(
    Object.keys(lock.packages).some((entry) => /(?:^|\/)node_modules\/mysql2$/.test(entry)),
    false,
  );
});

test('Codex manifest and MCP entry stay contained in the shipped plugin', () => {
  const manifest = readJson(path.join(root, '.codex-plugin/plugin.json'));
  assert.equal(manifest.name, 'specgate-codex');
  assert.equal(manifest.requires_local_executor, true);
  for (const relative of [manifest.skills, manifest.mcpServers]) {
    assert.ok(relative.startsWith('./'));
    assert.ok(!relative.split('/').includes('..'));
    assert.ok(fs.existsSync(path.join(root, relative)));
  }
  const config = readJson(path.join(root, manifest.mcpServers));
  const server = config.mcpServers.specgate;
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['${PLUGIN_ROOT}/src/codex/server.js']);
  assert.equal(server.env.SPECGATE_NATIVE_AGENTS, '1');
  assert.equal(server.env.SPECGATE_INTERACTIVE_APPROVAL, '1');
  assert.equal(server.cwd, undefined, 'keep the host project cwd rather than the plugin root');
  const portableMcp = readJson(path.join(root, '.mcp.json'));
  assert.deepEqual(
    portableMcp.mcpServers,
    readJson(path.join(root, 'mcp.json')).mcpServers,
    'both portable MCP entry points must project the same server',
  );
  assert.notEqual(portableMcp.mcpServers.specgate.enabled, false);
  assert.match(
    fs.readFileSync(path.join(root, manifest.skills, 'sg-codex/SKILL.md'), 'utf8'),
    /^---\r?\nname: sg-codex\r?\ndescription: .+/,
  );
  const packageJson = readJson(path.join(root, 'package.json'));
  assert.equal(packageJson.name, 'specgate-codex');
  assert.equal(manifest.version, packageJson.version);
  assert.equal(readJson(path.join(root, 'plugin.json')).version, packageJson.version);
  assert.equal(readJson(path.join(root, 'package-lock.json')).version, packageJson.version);
  assert.equal(
    readJson(path.join(root, 'package-lock.json')).packages[''].version,
    packageJson.version,
  );
  assert.equal(packageJson.exports, undefined);
  assert.equal(packageJson.files.includes('src/codex'), true);
  for (const removed of ['index.js', 'cordis.patch.yml'])
    assert.equal(fs.existsSync(path.join(root, removed)), false, `${removed} must stay removed`);
  assert.deepEqual(fs.readdirSync(path.join(root, 'src')), ['codex']);
  const runtimeFiles = fs
    .readdirSync(path.join(root, 'src/codex'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:js|mjs)$/.test(entry.name));
  for (const entry of runtimeFiles) {
    const file = path.join(entry.parentPath, entry.name);
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /(?:from|import\()\s*['"][^'"]*v[34]/i, file);
    assert.doesNotMatch(source, /\bDSH\b/, file);
  }
});

test(
  'offline tarball install launches the packaged entry from a different project cwd',
  { timeout: 180000 },
  async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-install space-'));
    const npmCli =
      process.env.npm_execpath ||
      [
        path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
        path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
      ].find((file) => fs.existsSync(file));
    assert.ok(npmCli, 'npm CLI is required for the package acceptance test');
    const npm = (args, cwd) => {
      const result = spawnSync(
        process.execPath,
        [npmCli, ...args, '--cache', path.join(fixture, 'cache')],
        {
          cwd,
          encoding: 'utf8',
          timeout: 45000,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      return result.stdout;
    };
    const [packed] = JSON.parse(
      npm(['pack', '--json', '--ignore-scripts', '--pack-destination', fixture], root),
    );
    assert.deepEqual(packed.bundled || [], []);
    assert.equal(
      packed.files.some((entry) => entry.path.includes('node_modules/mysql2/')),
      false,
    );
    for (const file of [
      '.agents/plugins/marketplace.json',
      '.codex-plugin/plugin.json',
      '.mcp.json',
      'plugin.json',
      'mcp.json',
      'src/codex/server.js',
      'skills/sg-codex/SKILL.md',
      'skills/sg-codex-change/SKILL.md',
      'assets/codex/agents/specgate_implementer.toml',
      'assets/codex/agents/specgate_reviewer.toml',
      'src/codex/core/java/java-versions.js',
      'scripts/codex-plugin-smoke.mjs',
    ]) {
      assert.ok(
        packed.files.some((entry) => entry.path === file),
        `${file} missing from tarball`,
      );
    }
    for (const entry of packed.files) {
      assert.doesNotMatch(entry.path, /^src\/codex\/(?:control|management|channels)\//);
      assert.doesNotMatch(entry.path, /^src\/codex\/core\/control\//);
      assert.doesNotMatch(entry.path, /^assets\/java-vue\//);
      assert.doesNotMatch(entry.path, /(?:mysql-repository|environment-install|specgate-worker)/);
    }
    const installRoot = path.join(fixture, 'installation');
    fs.mkdirSync(installRoot);
    fs.writeFileSync(
      path.join(installRoot, 'package.json'),
      '{"name":"sg-fixture","private":true}',
    );
    npm(
      [
        'install',
        path.join(fixture, packed.filename),
        '--offline',
        '--ignore-scripts',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
      ],
      installRoot,
    );
    const pluginRoot = path.join(installRoot, 'node_modules/specgate-codex');
    assert.equal(fs.existsSync(path.join(pluginRoot, 'src/codex/core/control')), false);
    assert.equal(fs.existsSync(path.join(pluginRoot, 'assets/java-vue')), false);
    assert.equal(fs.existsSync(path.join(pluginRoot, 'node_modules/mysql2')), false);
    const { smokePlugin } = await import('../scripts/codex-plugin-smoke.mjs');
    const projectRoot = path.join(fixture, 'project 中文');
    fs.mkdirSync(projectRoot);
    const evidence = await smokePlugin({ pluginRoot, projectRoot });
    assert.equal(evidence.exitCode, 0);
    assert.equal(evidence.status, 'passed');
    assert.deepEqual(evidence.testedTools, ['health', 'version', 'status']);
    assert.ok(evidence.tools.includes('sg_pause'));
    assert.ok(evidence.tools.includes('sg_test_design_prepare'));
    assert.equal(evidence.projectStatus.verification.status, 'not-run');
    assert.equal(evidence.projectStatus.projectRoot, projectRoot);
    assert.deepEqual(fs.readdirSync(projectRoot), []);
    const { createToolRegistry } = await import(
      pathToFileURL(path.join(pluginRoot, 'src/codex/workflow-tools.js')).href
    );
    const registry = createToolRegistry({ projectRoot });
    const projectStatus = (await registry.call('sg_project_status')).structuredContent;
    assert.equal(projectStatus.ok, true, JSON.stringify(projectStatus));
    assert.equal(projectStatus.projectRoot, projectRoot);
    assert.deepEqual(fs.readdirSync(projectRoot), []);
    assert.equal(fs.existsSync(path.join(pluginRoot, 'index.js')), false);
    assert.deepEqual(fs.readdirSync(path.join(pluginRoot, 'src')), ['codex']);
    const smokeEnvironment = { ...process.env, SPECGATE_PACKAGE_SMOKE_ROOT: pluginRoot };
    delete smokeEnvironment.NODE_TEST_CONTEXT;
    const deliverySmoke = spawnSync(
      process.execPath,
      ['--test', path.join(root, 'test/codex-quality-gate.test.js')],
      {
        cwd: projectRoot,
        env: smokeEnvironment,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    assert.ifError(deliverySmoke.error);
    assert.equal(deliverySmoke.status, 0, deliverySmoke.stdout + deliverySmoke.stderr);
    assert.match(deliverySmoke.stdout, /synthetic local delivery smoke/);
    assert.match(deliverySmoke.stdout, /(?:fail 0|# fail 0)/);
  },
);

test('smoke evidence rejects stdout pollution after the final reply', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-noisy-'));
  fs.mkdirSync(path.join(fixture, '.codex-plugin'));
  fs.copyFileSync(
    path.join(root, '.codex-plugin/plugin.json'),
    path.join(fixture, '.codex-plugin/plugin.json'),
  );
  fs.writeFileSync(
    path.join(fixture, 'mcp.json'),
    JSON.stringify({
      mcpServers: { specgate: { command: 'node', args: ['${PLUGIN_ROOT}/noisy.mjs'] } },
    }),
  );
  fs.writeFileSync(
    path.join(fixture, 'noisy.mjs'),
    [
      `import { serveStdio } from ${JSON.stringify(pathToFileURL(path.join(root, 'src/codex/server.js')).href)};`,
      'serveStdio();',
      'process.stdin.on("end", () => process.stdout.write("trailing noise\\n"));',
    ].join('\n'),
  );
  const { smokePlugin } = await import('../scripts/codex-plugin-smoke.mjs');
  await assert.rejects(
    smokePlugin({ pluginRoot: fixture, projectRoot: fixture }),
    /JSON|Unexpected/,
  );
});
