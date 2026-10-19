import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanEnv, writeEnvReport, renderEnvLine } from '../../src/v3/env-scan.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v35-env-'));
}

test('扫描 Node/Vue/Python 并给出缺失工具计划', () => {
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'demo',
        dependencies: { vue: '^3.5.0' },
        devDependencies: { prettier: '^3.0.0' },
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), '', 'utf8');

  fs.mkdirSync(path.join(root, 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'api', 'requirements.txt'), 'ruff\n', 'utf8');

  const env = scanEnv(root);
  const vue = env.workspaces.find((item) => item.path === '.');
  assert.equal(vue.stack, 'vue');
  assert.equal(vue.packageManager, 'pnpm');
  assert.equal(vue.tools.prettier, 'ready');
  assert.equal(vue.tools.eslint, 'missing');
  assert.equal(vue.tools['vue-tsc'], 'missing');

  const api = env.workspaces.find((item) => item.path === 'api');
  assert.equal(api.stack, 'python');
  assert.equal(api.tools.ruff, 'ready');
  assert.equal(api.tools.mypy, 'missing');

  assert.ok(env.missing.includes('mypy'));
  assert.ok(env.plan.some((line) => line.includes('eslint')));
  assert.match(renderEnvLine(env), /环境：/);

  const files = writeEnvReport(root, env);
  assert.ok(fs.existsSync(files.jsonFile));
  assert.ok(fs.existsSync(files.mdFile));
  assert.match(fs.readFileSync(files.mdFile, 'utf8'), /环境扫描报告/);
});

test('monorepo 逐 workspace 扫描', () => {
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }, null, 2),
    'utf8',
  );
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'apps', 'web', 'package.json'),
    JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0' } }, null, 2),
    'utf8',
  );
  fs.mkdirSync(path.join(root, 'apps', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'api', 'requirements.txt'), 'ruff\nmypy\n', 'utf8');

  const env = scanEnv(root);
  assert.equal(env.workspaces.find((item) => item.path === 'apps/web').stack, 'react');
  assert.equal(env.workspaces.find((item) => item.path === 'apps/api').stack, 'python');
});
