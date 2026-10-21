import test from 'node:test';
import assert from 'node:assert/strict';
import { javaFullstackFiles } from '../../src/v4/java-fullstack-template.js';
import { bootstrapCodeFiles } from '../../src/v3/bootstrap-code.js';
import { v4NodeFiles } from '../../src/v4/node-code.js';
import { v4PythonFiles } from '../../src/v4/python-code.js';
import { frontendFiles } from '../../src/v4/frontend-code.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function check(name, files) {
  const source = Object.entries(files)
    .filter(([file]) => /\.(?:java|py|[cm]?js|tsx?)$/.test(file))
    .map(([, text]) => text)
    .join('\n');
  assert.doesNotMatch(
    source,
    /@(?:Put|Delete|Patch)Mapping|@(?:Put|Delete|Patch)\(|@\w+\.(?:put|delete|patch)\(|(?:Router|app)\.(?:put|delete|patch)\(|method\s*[:=]\s*['"](?:PUT|DELETE|PATCH)['"]|def (?:put|delete)\(self, request/,
    name,
  );
  assert.match(source, /\/update/, name + ' update route');
  assert.match(source, /\/delete/, name + ' delete route');
  assert.doesNotMatch(
    source,
    /status(?:_code)?\s*[=:]\s*204|(?:code|status)\(204\)|noContent\(\)|return ["']{2}, 204/,
    name + ' must return JSON on delete',
  );
}

test('all generated CRUD servers and clients use GET queries and POST JSON mutations', () => {
  check('golden Java/Vue', javaFullstackFiles());
  for (const stack of ['java', 'node', 'python']) check('v3 ' + stack, bootstrapCodeFiles(stack));
  for (const framework of ['express', 'fastify', 'nestjs'])
    for (const language of framework === 'nestjs' ? ['typescript'] : ['javascript', 'typescript'])
      check(framework + ' ' + language, v4NodeFiles({ framework, language, stack: 'node' }));
  for (const framework of ['fastapi', 'flask', 'django'])
    check(framework, v4PythonFiles({ framework, stack: 'python', pythonVersion: '3.12' }));
  check(
    'Flask legacy',
    v4PythonFiles({ framework: 'flask', stack: 'python', pythonVersion: '2.7' }),
  );
  for (const framework of ['vue', 'react']) check(framework, frontendFiles(framework));
});

test('generated Node CRUD server enforces the JSON POST contract with real HTTP requests', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-json-api-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries({
    ...bootstrapCodeFiles('node'),
    'package.json': '{"type":"module"}',
  })) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  const { createApp } = await import(pathToFileURL(path.join(root, 'index.js')).href);
  const server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const send = (url, body, method = 'POST') =>
    fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const created = await send('/api/items', { name: 'first' });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const updated = await send('/api/items/update', { id, name: 'changed' });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).name, 'changed');
  for (const body of [{}, { id: 0 }, { id: '1' }, { id: true }])
    assert.equal((await send('/api/items/delete', body)).status, 400);
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const response = await send('/api/items/' + id, { name: 'wrong' }, method);
    assert.equal(response.status, 405);
    assert.match(response.headers.get('content-type'), /application\/json/);
    await response.json();
  }
  assert.equal((await fetch(base + '/api/items/' + id)).status, 200);
  const deleted = await send('/api/items/delete', { id });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { id, deleted: true });
  assert.equal((await fetch(base + '/api/items/' + id)).status, 404);
  const nativeFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  globalThis.fetch = (url, options) => nativeFetch(base + url, options);
  for (const framework of ['vue', 'react']) {
    const source = frontendFiles(framework)['src/api.js'].replace(
      /^const MODE = .*;$/m,
      'const MODE = "real";',
    );
    const api = await import(
      'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
    );
    const created = await api.createItem({ name: framework });
    assert.equal(
      (await api.updateItem(created.id, { name: 'client updated' })).name,
      'client updated',
    );
    assert.deepEqual(await api.deleteItem(created.id), { id: created.id, deleted: true });
  }
});
