import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

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
  assert.equal(server.cwd, undefined, 'keep the host project cwd rather than the plugin root');
  assert.match(
    fs.readFileSync(path.join(root, manifest.skills, 'sg-codex/SKILL.md'), 'utf8'),
    /^---\r?\nname: sg-codex\r?\ndescription: .+/,
  );
  assert.equal(readJson(path.join(root, 'package.json')).exports['.'], './index.js');
});

test(
  'offline tarball install launches the packaged entry from a different project cwd',
  { timeout: 60000 },
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
    for (const file of [
      '.codex-plugin/plugin.json',
      '.mcp.json',
      'src/codex/server.js',
      'skills/sg-codex/SKILL.md',
      'scripts/codex-plugin-smoke.mjs',
      'index.js',
    ]) {
      assert.ok(
        packed.files.some((entry) => entry.path === file),
        `${file} missing from tarball`,
      );
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
    const pluginRoot = path.join(installRoot, 'node_modules/dsh-plugin-specgate');
    const { smokePlugin } = await import('../scripts/codex-plugin-smoke.mjs');
    const projectRoot = path.join(fixture, 'project 中文');
    fs.mkdirSync(projectRoot);
    const evidence = await smokePlugin({ pluginRoot, projectRoot });
    assert.equal(evidence.exitCode, 0);
    assert.equal(evidence.status, 'passed');
    assert.deepEqual(evidence.testedTools, ['health', 'version', 'status']);
    assert.ok(evidence.tools.includes('sg_pause'));
    assert.equal(evidence.projectStatus.verification.status, 'not-run');
    assert.equal(evidence.projectStatus.projectRoot, projectRoot);
    assert.deepEqual(fs.readdirSync(projectRoot), []);
    const dsh = await import(pathToFileURL(path.join(pluginRoot, 'index.js')).href);
    assert.equal(dsh.name, 'specgate');
    assert.equal(typeof dsh.apply, 'function');
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
    path.join(fixture, '.mcp.json'),
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
