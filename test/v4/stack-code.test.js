import test from 'node:test';
import assert from 'node:assert/strict';
import { v4PythonFiles } from '../../src/v4/python-code.js';
import { v4NodeFiles } from '../../src/v4/node-code.js';
import { frontendFiles } from '../../src/v4/frontend-code.js';
import { resolveDependencies } from '../../src/v4/catalog.js';

function withDeps(side) {
  return { ...side, dependencies: resolveDependencies(side, 'recommended') };
}

test('v4.1 模板：FastAPI / Flask / Django', () => {
  const fastapi = v4PythonFiles(
    withDeps({
      id: 'api',
      stack: 'python',
      framework: 'fastapi',
      pythonVersion: '3.12',
      runtimeVersion: '3.12',
      packageManager: 'pip',
    }),
  );
  assert.ok(fastapi['app/main.py']);
  assert.ok(fastapi['app/items.py']);
  assert.match(fastapi['requirements.txt'], /fastapi/);
  assert.ok(fastapi['tests/test_items.py']);

  const flask = v4PythonFiles(
    withDeps({
      id: 'api',
      stack: 'python',
      framework: 'flask',
      pythonVersion: '3.12',
      runtimeVersion: '3.12',
      packageManager: 'pip',
    }),
  );
  assert.ok(flask['app.py']);
  assert.match(flask['app.py'], /Flask/);

  const django = v4PythonFiles(
    withDeps({
      id: 'api',
      stack: 'python',
      framework: 'django',
      pythonVersion: '3.12',
      runtimeVersion: '3.12',
      packageManager: 'pip',
    }),
  );
  assert.ok(django['manage.py']);
  assert.ok(django['config/settings.py']);
  assert.match(django['requirements.txt'], /djangorestframework/);
});

test('v4.1 模板：Python 2.7 使用旧版 Flask 依赖', () => {
  const files = v4PythonFiles(
    withDeps({
      id: 'api',
      stack: 'python',
      framework: 'flask',
      pythonVersion: '2.7',
      runtimeVersion: '2.7',
      packageManager: 'pip',
    }),
  );
  assert.match(files['requirements.txt'], /flask==1\.1\.4/);
  assert.match(files['requirements.txt'], /pytest==4\.6\.11/);
  assert.ok(files['app.py']);
  assert.equal(files['ruff.toml'], undefined);
});

test('v4.1 模板：Node TS/JS 与 NestJS', () => {
  const ts = v4NodeFiles(
    withDeps({
      id: 'api',
      stack: 'node',
      framework: 'express',
      language: 'typescript',
      nodeVersion: '22',
      runtimeVersion: '22',
      packageManager: 'pnpm',
    }),
  );
  assert.ok(ts['src/items.ts']);
  assert.ok(ts['tsconfig.json']);
  assert.match(ts['pnpm-workspace.yaml'], /allowBuilds/);
  assert.match(ts['package.json'], /typescript/);

  const js = v4NodeFiles(
    withDeps({
      id: 'api',
      stack: 'node',
      framework: 'express',
      language: 'javascript',
      nodeVersion: '22',
      runtimeVersion: '22',
      packageManager: 'pnpm',
    }),
  );
  assert.ok(js['src/items.js']);
  assert.equal(js['tsconfig.json'], undefined);
  assert.doesNotMatch(js['package.json'], /typescript/);

  const nest = v4NodeFiles(
    withDeps({
      id: 'api',
      stack: 'node',
      framework: 'nestjs',
      language: 'typescript',
      nodeVersion: '22',
      runtimeVersion: '22',
      packageManager: 'pnpm',
    }),
  );
  assert.ok(nest['src/app.module.ts']);
  assert.ok(nest['src/items/items.controller.ts']);
  assert.match(nest['package.json'], /@nestjs\/cli/);
});

test('v4.1 模板：前端清单写入选中依赖与 tsconfig', () => {
  const side = withDeps({
    id: 'web',
    stack: 'react',
    framework: 'react',
    language: 'typescript',
    buildTool: 'vite',
  });
  const files = frontendFiles('react', side);
  assert.ok(files['tsconfig.json']);
  assert.match(files['pnpm-workspace.yaml'], /allowBuilds/);
  assert.match(files['package.json'], /react-router-dom/);
  assert.match(files['package.json'], /typescript/);
  assert.match(files['eslint.config.js'], /typescript-eslint/);
});
