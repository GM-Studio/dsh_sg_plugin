import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JAVA_MATRIX,
  javaBootOptions,
  nodeCatalog,
  pythonCatalog,
  pythonFrameworks,
  resolveDependencies,
  validateSide,
} from '../../src/v4/catalog.js';

test('v4.1 目录：Java JDK 与 Spring Boot 兼容矩阵', () => {
  assert.deepEqual(javaBootOptions('8'), ['2.7.x']);
  assert.deepEqual(javaBootOptions('11'), ['2.7.x']);
  assert.deepEqual(javaBootOptions('13'), ['2.7.x']);
  assert.deepEqual(javaBootOptions('17'), ['2.7.x', '3.x', '4.x']);
  assert.deepEqual(javaBootOptions('21'), ['2.7.x', '3.x', '4.x']);
  assert.equal(JAVA_MATRIX['8'].includes('3.x'), false);

  assert.equal(
    validateSide({ stack: 'java', jdk: '8', buildTool: 'maven', bootVersion: '3.x' }).ok,
    false,
  );
  assert.equal(
    validateSide({ stack: 'java', jdk: '21', buildTool: 'gradle', bootVersion: '4.x' }).ok,
    true,
  );
});

test('v4.1 目录：Python 2.7 只允许 Flask/Django 旧版', () => {
  assert.deepEqual(pythonFrameworks('2.7'), ['flask', 'django']);
  assert.deepEqual(pythonFrameworks('3.12'), ['fastapi', 'flask', 'django']);

  const flask = pythonCatalog('flask', '2.7');
  assert.equal(
    flask.required.some((item) => item.id === 'flask' && item.install === 'flask==1.1.4'),
    true,
  );
  assert.equal(flask.optional.length, 0);

  const django = pythonCatalog('django', '2.7');
  assert.equal(
    django.required.some((item) => item.install === 'django==1.11.29'),
    true,
  );
  assert.equal(
    django.required.some((item) => item.install === 'djangorestframework==3.9.4'),
    true,
  );
});

test('v4.1 目录：Node JavaScript 不携带 TypeScript 依赖', () => {
  const js = nodeCatalog('express', 'javascript');
  assert.equal(
    js.required.some((item) => item.id === 'typescript'),
    false,
  );
  assert.equal(
    js.required.some((item) => item.id === '@types/node'),
    false,
  );

  const ts = nodeCatalog('express', 'typescript');
  assert.equal(
    ts.required.some((item) => item.id === 'typescript'),
    true,
  );
  assert.equal(
    ts.required.some((item) => item.id === '@types/node'),
    true,
  );
});

test('v4.1 目录：预设展开、必选去重与互斥组', () => {
  const java = { stack: 'java', jdk: '17', buildTool: 'maven', bootVersion: '3.x' };
  const resolved = resolveDependencies(java, 'full');
  assert.equal(resolved.required.includes('web'), true);
  assert.equal(resolved.optional.includes('web'), false);
  assert.equal(resolved.optional.includes('jpa'), true);
  assert.equal(resolved.optional.includes('redis'), true);
  assert.equal(resolved.optional.includes('cache'), false);

  const exclusive = resolveDependencies(java, 'custom', ['redis', 'cache']);
  assert.deepEqual(exclusive.optional, ['redis']);
  assert.equal(
    exclusive.dropped.some((item) => item.id === 'cache'),
    true,
  );

  const python = { stack: 'python', framework: 'fastapi', pythonVersion: '3.12' };
  const pyFull = resolveDependencies(python, 'full');
  assert.equal(pyFull.optional.includes('passlib'), true);
  assert.equal(pyFull.optional.includes('python-jose'), true);
  assert.equal(pyFull.optional.includes('mypy'), true);
  assert.equal(pyFull.optional.includes('pre-commit'), true);
  assert.equal(pyFull.dropped.length, 0);
});

test('v4.1 目录：自定义依赖只保留目录内条目', () => {
  const node = { stack: 'node', framework: 'express', language: 'typescript' };
  const resolved = resolveDependencies(node, 'custom', ['helmet', 'not-a-real-package']);
  assert.deepEqual(resolved.optional, ['helmet']);
  assert.equal(resolved.dropped[0].id, 'not-a-real-package');
});
