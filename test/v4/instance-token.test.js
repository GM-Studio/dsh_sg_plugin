import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { v4NodeFiles } from '../../src/v4/node-code.js';
import { v4PythonFiles } from '../../src/v4/python-code.js';
import { bootstrapCodeFiles } from '../../src/v3/bootstrap-code.js';

const route = '/api/sg-init-instance';
const tokenValue = 'init-only-token-"-\\-雪';
const tokenCases = [undefined, '', tokenValue, ' '];

function assertReply(status, payload, token) {
  assert.equal(status, token ? 200 : 404);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), token ? { token } : { error: 'not found' });
}

for (const framework of ['express', 'fastify']) {
  for (const language of ['javascript', 'typescript']) {
    test(`instance token: ${framework}/${language} returns only nonempty token`, async () => {
      const ext = language === 'typescript' ? 'ts' : 'js';
      const files = v4NodeFiles({ framework, language });
      const routes = new Map();
      const app = {
        use() {},
        register() {},
        get(path, handler) {
          routes.set(path, handler);
        },
      };
      const express = () => app;
      express.json = () => {};
      const env = { UNRELATED_SECRET: 'must-not-leak' };
      const context = vm.createContext({
        express,
        Fastify: () => app,
        cors() {},
        sensible() {},
        itemsRouter: {},
        itemsRoutes() {},
        process: { env },
      });
      const source = files[`src/app.${ext}`]
        .replace(/^import .*;\n/gm, '')
        .replace('export function', 'function');
      vm.runInContext(source, context);
      vm.runInContext(framework === 'express' ? 'createApp()' : 'buildApp()', context);
      assert.ok(routes.has(route));
      for (const token of tokenCases) {
        if (token === undefined) delete env.SG_INIT_VERIFY_TOKEN;
        else env.SG_INIT_VERIFY_TOKEN = token;
        let status = 200;
        let payload;
        const reply = {
          status(code) {
            status = code;
            return this;
          },
          code(code) {
            status = code;
            return this;
          },
          json(body) {
            payload = body;
          },
          send(body) {
            payload = body;
          },
        };
        const returned = await routes.get(route)({}, reply);
        assertReply(status, payload || returned, token);
      }
      if (language === 'javascript')
        assert.doesNotMatch(source, /: (Request|Response)|interface |import type/);
    });
  }
}

test('instance token: Nest controller is registered and enforces 404', () => {
  const files = v4NodeFiles({ framework: 'nestjs', language: 'typescript' });
  const controller = files['src/init-instance.controller.ts'];
  assert.match(controller, /@Controller\("api\/sg-init-instance"\)/);
  assert.match(controller, /@Get\(\)/);
  assert.match(files['src/app.module.ts'], /import \{ InitInstanceController \}/);
  assert.match(files['src/app.module.ts'], /controllers: \[InitInstanceController\]/);
  const body = controller.match(/ {2}instance\(\) \{\n([\s\S]*?)\n {2}\}/)[1];
  class HttpException extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  for (const token of tokenCases) {
    const env = { UNRELATED_SECRET: 'must-not-leak' };
    if (token !== undefined) env.SG_INIT_VERIFY_TOKEN = token;
    const invoke = () =>
      vm.runInNewContext(`(function () { ${body} })()`, { process: { env }, HttpException });
    if (token) assertReply(200, invoke(), token);
    else assert.throws(invoke, (error) => error.status === 404);
  }
});

test('instance token: v3 native Node endpoint requires GET and preserves CRUD fallback', async () => {
  const files = bootstrapCodeFiles('node');
  const env = { UNRELATED_SECRET: 'must-not-leak' };
  let handler;
  let crudCalls = 0;
  const context = vm.createContext({
    http: {
      createServer(fn) {
        handler = fn;
        return {};
      },
    },
    URL,
    process: { env },
    handleItems: async () => {
      crudCalls += 1;
      return false;
    },
  });
  const source = files['index.js']
    .split('if (process.argv[1]')[0]
    .replace(/^import .*;\n/gm, '')
    .replace('export function', 'function');
  vm.runInContext(source, context);
  vm.runInContext('createApp()', context);
  for (const token of tokenCases) {
    if (token === undefined) delete env.SG_INIT_VERIFY_TOKEN;
    else env.SG_INIT_VERIFY_TOKEN = token;
    let status;
    let payload;
    await handler(
      { method: 'GET', url: route + '?probe=1' },
      {
        writeHead(code) {
          status = code;
        },
        end(body) {
          payload = JSON.parse(body);
        },
      },
    );
    assertReply(status, payload, token);
  }
  assert.equal(crudCalls, 0);
  let status;
  await handler(
    { method: 'POST', url: route },
    {
      writeHead(code) {
        status = code;
      },
      end() {},
    },
  );
  assert.equal(status, 404);
  assert.equal(crudCalls, 1);
});

for (const bootVersion of ['2.7.18', '3.5.0']) {
  test(`instance token: Java ${bootVersion} standalone controller uses Java 8-compatible API`, () => {
    const files = bootstrapCodeFiles('java', { packageName: 'org.example.api', bootVersion });
    const controller = files['src/main/java/org/example/api/InitInstanceController.java'];
    assert.match(controller, /package org\.example\.api;/);
    assert.match(controller, /@GetMapping\("\/api\/sg-init-instance"\)/);
    assert.match(controller, /System\.getenv\("SG_INIT_VERIFY_TOKEN"\)/);
    assert.match(controller, /token == null \|\| token\.isEmpty\(\)/);
    assert.match(controller, /ResponseEntity\.notFound\(\)\.build\(\)/);
    assert.match(controller, /Collections\.singletonMap\("token", token\)/);
    assert.doesNotMatch(controller, /Map\.of|isBlank|System\.getenv\(\)/);
  });
}

const pythonCases = [
  ['fastapi', '3.12', 'app/main.py'],
  ['flask', '3.12', 'app.py'],
  ['flask', '2.7', 'app.py'],
  ['django', '3.12', 'items/views.py'],
  ['django', '2.7', 'items/views.py'],
  ['native', '3.12', 'app.py'],
];

for (const [framework, pythonVersion, entry] of pythonCases) {
  test(`instance token: Python ${framework}/${pythonVersion} route behavior without framework dependencies`, (t) => {
    const files =
      framework === 'native'
        ? bootstrapCodeFiles('python')
        : v4PythonFiles({ framework, pythonVersion });
    const source = files[entry];
    assert.match(source, /os\.environ\.get\("SG_INIT_VERIFY_TOKEN"\)/);
    if (framework === 'django') {
      assert.match(files['items/urls.py'], /api\/sg-init-instance/);
      assert.match(files['items/urls.py'], /import ItemDetail, ItemList, health, init_instance/);
      assert.match(source, /@require_GET\ndef init_instance/);
    } else assert.ok(source.includes(route));
    if (pythonVersion === '2.7') {
      assert.doesNotMatch(source, /def \w+\([^\n]*\)\s*->|f["']|async def|: str\b|: int\b/);
      if (framework === 'flask')
        assert.match(source, /@app\.route\("\/api\/sg-init-instance", methods=\["GET"\]\)/);
    }
    const script = `
import json, os, sys, types
case = json.loads(sys.stdin.read())
# Compile every emitted Python file, including unexecuted CRUD/test modules.
for filename, source in case['files'].items():
    if filename.endswith('.py'):
        compile(source, filename, 'exec')
routes = {}
class App:
    def __init__(self, *args, **kwargs): pass
    def get(self, path):
        def decorate(fn):
            routes[path] = fn
            return fn
        return decorate
    def route(self, path, **kwargs): return self.get(path)
    def post(self, path): return self.get(path)
    def put(self, path): return self.get(path)
    def delete(self, path): return self.get(path)
    def include_router(self, router): pass
class Response:
    def __init__(self, payload=None, status=200, mimetype=None):
        self.payload = json.loads(payload) if isinstance(payload, str) else payload
        self.status_code = status
class HTTPException(Exception):
    def __init__(self, status_code, detail): self.status_code = status_code
class APIView: pass
def module(name, **attributes):
    mod = types.ModuleType(name)
    mod.__dict__.update(attributes)
    sys.modules[name] = mod
    return mod
module('fastapi', FastAPI=App, HTTPException=HTTPException)
module('app')
module('app.items', router=None)
module('flask', Flask=App, Response=Response, jsonify=lambda payload: payload, request=None)
module('django')
module('django.http', JsonResponse=Response)
module('django.views')
module('django.views.decorators')
module('django.views.decorators.csrf', csrf_exempt=lambda fn: fn)
module('django.views.decorators.http', require_GET=lambda fn: fn)
module('rest_framework')
module('rest_framework.response', Response=Response)
module('rest_framework.views', APIView=APIView)
module('items', handle_items=lambda handler: False)
namespace = {'__name__': 'instance_test'}
exec(compile(case['files'][case['entry']], case['entry'], 'exec'), namespace)
if case['framework'] == 'native':
    handler = object.__new__(namespace['Handler'])
    handler.command = 'GET'
    handler.path = '/api/sg-init-instance?probe=1'
    captured = []
    handler._send = lambda status, payload: captured.append((status, payload))
    def invoke():
        handler._dispatch()
        return captured.pop()
else:
    fn = namespace['init_instance']
    if case['framework'] != 'django':
        assert routes['/api/sg-init-instance'] is fn
    def invoke():
        try:
            result = fn(None) if case['framework'] == 'django' else fn()
        except HTTPException as error:
            return error.status_code, None
        if isinstance(result, Response):
            return result.status_code, result.payload
        if isinstance(result, tuple):
            return result[1], result[0]
        return 200, result
os.environ['UNRELATED_SECRET'] = 'must-not-leak'
for token in [None, '', case['token'], ' ']:
    if token is None:
        os.environ.pop('SG_INIT_VERIFY_TOKEN', None)
    else:
        os.environ['SG_INIT_VERIFY_TOKEN'] = token
    status, payload = invoke()
    assert status == (200 if token else 404), (status, token)
    if token:
        assert payload == {'token': token}, payload
    else:
        assert payload is None or payload == {'error': 'not found'}, payload
if case['framework'] == 'native':
    handler.command = 'POST'
    assert invoke() == (404, {'error': 'not found'})
print('instance behavior passed')
`;
    const result = spawnSync(process.env.SG_TEST_PYTHON || 'python', ['-c', script], {
      input: JSON.stringify({ framework, files, entry, token: tokenValue }),
      encoding: 'utf8',
      timeout: 15000,
    });
    if (result.error?.code === 'ENOENT') {
      t.skip('Python is not installed; template assertions passed');
      return;
    }
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /instance behavior passed/);
  });
}
