import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  normalizeInitExecution,
  executeJavaInit,
  preflightJavaInit,
} from '../../src/v4/java-init-execution.js';

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-execution-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'backend/target'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backend/pom.xml'),
    '<project><java.version>1.8</java.version><version>2.7.18</version></project>',
  );
  fs.writeFileSync(path.join(root, 'backend/target/app.jar'), 'fixture');
  fs.writeFileSync(path.join(root, 'frontend/package.json'), '{}');
  return root;
}
function result(request) {
  if (request.stage === 'preflight') {
    const name = path.basename(request.command);
    if (name.startsWith('javac')) return { exitCode: 0, stdout: 'javac 1.8.0_482' };
    if (name.startsWith('java')) return { exitCode: 0, stderr: 'openjdk version "1.8.0_482"' };
    if (name.startsWith('mvn'))
      return {
        exitCode: 0,
        stdout: 'Apache Maven 3.9.11\nJava version: 1.8.0_482, vendor: Eclipse',
      };
    return { exitCode: 0, stdout: '10.8.2' };
  }
  return { exitCode: 0, stdout: 'success' };
}
function status(report, name) {
  return report.stages.find((stage) => stage.name === name).status;
}

test('normalization strictly validates all six booleans and unknown own flags', () => {
  assert.deepEqual(normalizeInitExecution(), {
    ok: true,
    execution: {
      test: false,
      format: false,
      lint: false,
      review: false,
      verify: false,
      installToolchain: false,
    },
  });
  for (const flag of ['test', 'format', 'lint', 'review', 'verify', 'installToolchain']) {
    assert.equal(normalizeInitExecution({ [flag]: true }).execution[flag], true);
    for (const value of ['true', 1, null, undefined, {}, []])
      assert.equal(normalizeInitExecution({ [flag]: value }).ok, false);
  }
  for (const value of [null, [], true, 'yes', { install: true }, { [Symbol('unknown')]: false }])
    assert.equal(normalizeInitExecution(value).ok, false);
  assert.equal(normalizeInitExecution(Object.create({ verify: true })).execution.verify, false);
});

test('default execution does not spawn, install, fetch, or write evidence', async (t) => {
  const root = project(t);
  const forbidden = () => {
    throw new Error('unexpected side effect');
  };
  const report = await executeJavaInit({
    root,
    runner: forbidden,
    installer: forbidden,
    fetch: forbidden,
  });
  assert.equal(report.ok, true);
  assert.ok(report.stages.every((stage) => stage.status === 'skipped'));
  assert.equal(report.network.attempted, false);
  assert.equal(fs.existsSync(path.join(root, '.specgate')), false);
  assert.equal((await executeJavaInit()).ok, true);
});

test('invalid execution and missing toolchain fail before any writes', async (t) => {
  const root = project(t);
  const invalid = await executeJavaInit({
    root,
    execution: { test: 'true' },
    runner: () => {
      throw Error('must not run');
    },
  });
  assert.equal(invalid.ok, false);
  const report = await executeJavaInit({
    root,
    execution: { test: true },
    runner: async () => ({ exitCode: 0, stderr: 'openjdk version "21.0.1"' }),
  });
  assert.equal(report.ok, false);
  assert.equal(status(report, 'preflight'), 'failed');
  assert.equal(status(report, 'dependencies'), 'skipped');
  assert.match(report.errors[0], /Java 8/);
  assert.equal(fs.existsSync(path.join(root, '.specgate')), false);
});

test('preflight API is read-only and can validate before project generation', async () => {
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    return result(request);
  };
  assert.equal((await preflightJavaInit({ execution: { test: true }, runner })).ok, true);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.stage === 'preflight'));
  for (const execution of [{}, { review: true }, { installToolchain: true, verify: true }]) {
    assert.equal(
      (
        await preflightJavaInit({
          execution,
          runner: () => {
            throw Error('not allowed');
          },
        })
      ).status,
      'skipped',
    );
  }
  const mismatch = await preflightJavaInit({
    execution: { lint: true },
    runner: async (request) =>
      request.command === 'mvn' ? { exitCode: 0, stdout: 'Java version: 17.0.2' } : result(request),
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.errors[0], /Maven.*Java 8/);
});

for (const [flag, goal] of [
  ['test', 'test'],
  ['format', 'spotless:apply'],
  ['lint', 'checkstyle:check'],
]) {
  test(
    flag + ' selectively installs dependencies and runs only its own quality commands',
    async (t) => {
      const root = project(t),
        calls = [],
        disclosures = [];
      const report = await executeJavaInit({
        root,
        execution: { [flag]: true },
        env: { JAVA_HOME: '/fixture/jdk', CUSTOM_MARKER: 'preserved' },
        onLog: (text) => disclosures.push(text),
        runner: async (request) => {
          calls.push(request);
          return result(request);
        },
      });
      assert.equal(report.ok, true, JSON.stringify(report));
      assert.equal(status(report, flag), 'passed');
      assert.equal(status(report, 'dependencies'), 'passed');
      assert.ok(calls.some((request) => request.args.includes(goal)));
      assert.ok(
        calls.some(
          (request) => request.args[0] === 'install' && request.cwd === path.join(root, 'frontend'),
        ),
      );
      assert.ok(calls.some((request) => request.args.includes('dependency:resolve')));
      assert.ok(
        calls.every((request) => ['preflight', 'dependencies', flag].includes(request.stage)),
      );
      assert.ok(calls.every((request) => request.env.CUSTOM_MARKER === 'preserved'));
      assert.equal(report.network.attempted, true);
      assert.equal(report.network.observed, false); // cache hit is not proof of an actual download
      assert.ok(disclosures.length >= 2);
      assert.equal(JSON.parse(fs.readFileSync(report.reportPath)).ok, true);
      assert.equal(status(report, 'installToolchain'), 'skipped');
    },
  );
}

test('failures stop dependent phases, preserve generated sources, and write failed evidence', async (t) => {
  const root = project(t),
    calls = [];
  const report = await executeJavaInit({
    root,
    execution: { test: true, verify: true },
    runner: async (request) => {
      calls.push(request);
      return request.stage === 'test'
        ? { exitCode: 3, stderr: 'test failure details' }
        : result(request);
    },
  });
  assert.equal(report.ok, false);
  assert.equal(status(report, 'test'), 'failed');
  assert.equal(status(report, 'verify'), 'skipped');
  assert.equal(
    calls.some((request) => request.stage === 'verify'),
    false,
  );
  assert.match(report.logs.join('\n'), /test failure details/);
  assert.equal(fs.existsSync(path.join(root, 'backend/pom.xml')), true);
  assert.equal(JSON.parse(fs.readFileSync(report.reportPath)).ok, false);
});

test('missing exit status cannot masquerade as passed', async (t) => {
  const root = project(t);
  const report = await executeJavaInit({
    root,
    execution: { test: true },
    runner: async (request) => (request.stage === 'dependencies' ? {} : result(request)),
  });
  assert.equal(report.ok, false);
  assert.equal(status(report, 'dependencies'), 'failed');
});

test('read-only strict formatting uses check commands without apply', async (t) => {
  const root = project(t),
    seen = [];
  const report = await executeJavaInit({
    root,
    execution: { format: true },
    formatCheck: true,
    runner: async (request) => {
      seen.push(request);
      return result(request);
    },
  });
  assert.equal(report.ok, true);
  assert.ok(seen.some((x) => x.args.includes('spotless:check')));
  assert.ok(seen.some((x) => x.args.includes('format:check')));
  assert.ok(!seen.some((x) => x.args.includes('spotless:apply') || x.args.includes('format')));
});

test('review is local deterministic checks, limited JSON repairs, not signoff', async (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, 'frontend/package.json'), '{}  \n');
  const source =
    'const value = ' + String.fromCharCode(96) + 'literal  \n' + String.fromCharCode(96) + ';\n';
  fs.writeFileSync(path.join(root, 'frontend/app.ts'), source);
  const forbidden = () => {
    throw Error('review cannot run command or download');
  };
  const report = await executeJavaInit({
    root,
    execution: { review: true },
    runner: forbidden,
    installer: forbidden,
  });
  assert.equal(report.ok, true);
  assert.equal(status(report, 'review'), 'passed');
  assert.equal(report.network.attempted, false);
  assert.match(report.logs.join('\n'), /no AI review.*manual signoff/);
  assert.equal(fs.readFileSync(path.join(root, 'frontend/package.json'), 'utf8'), '{}\n');
  assert.equal(fs.readFileSync(path.join(root, 'frontend/app.ts'), 'utf8'), source);
  fs.writeFileSync(path.join(root, 'frontend/app.ts'), '// TODO: implement authorization\n');
  const failure = await executeJavaInit({ root, execution: { review: true }, runner: forbidden });
  assert.equal(failure.ok, false);
  assert.equal(status(failure, 'review'), 'failed');
  assert.match(failure.logs.join('\n'), /requires human inspection/);
});

test('toolchain installation only occurs with explicit flag and reports installer failure', async (t) => {
  const root = project(t);
  let installs = 0;
  const installer = async ({ disclose }) => {
    installs++;
    disclose('Injected installer attempted https://example.invalid/jdk8');
    return { ok: true, tools: {} };
  };
  const report = await executeJavaInit({
    root,
    execution: { installToolchain: true },
    installer,
    runner: () => {
      throw Error('no quality probes required');
    },
  });
  assert.equal(report.ok, true);
  assert.equal(installs, 1);
  assert.equal(status(report, 'installToolchain'), 'passed');
  assert.equal(status(report, 'dependencies'), 'skipped');
  assert.equal(report.network.attempted, true);
  const failure = await executeJavaInit({
    root,
    execution: { installToolchain: true },
    installer: async () => ({ ok: false, message: 'No supported JDK8 archive' }),
  });
  assert.equal(failure.ok, false);
  assert.equal(status(failure, 'installToolchain'), 'failed');
  assert.equal(fs.existsSync(failure.reportPath), true);
});

test('already aborted execution invokes no runner', async (t) => {
  const root = project(t),
    controller = new AbortController();
  controller.abort();
  const report = await executeJavaInit({
    root,
    execution: { test: true },
    signal: controller.signal,
    runner: () => {
      throw Error('should not run');
    },
  });
  assert.equal(report.ok, false);
  assert.match(report.errors[0], /aborted/);
});

// Injectable servers still perform real localhost HTTP, rather than faking fetch.
async function runtimeRunner(t, mode = 'success') {
  const calls = [],
    handles = [],
    store = new Map();
  let nextId = 1;
  const runner = async (request) => {
    calls.push(request);
    if (request.kind !== 'start') return result(request);
    if (mode === 'start-failure' && request.side === 'frontend')
      throw Error('frontend spawn failed');
    let port;
    if (request.side === 'backend')
      port = Number(request.args.find((arg) => arg.startsWith('--server.port=')).split('=')[1]);
    else port = Number(request.args[request.args.indexOf('--port') + 1]);
    if (mode === 'no-persistence' && handles.filter((item) => item.side === 'backend').length)
      store.clear();
    const server = http.createServer(async (req, res) => {
      if (mode === 'not-ready') {
        res.writeHead(503);
        res.end('starting');
        return;
      }
      const respond = (status, value) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(value == null ? '' : JSON.stringify(value));
      };
      if (request.side === 'frontend') {
        if (req.url === '/api/tasks') {
          respond(200, [...store.values()]);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><body>Tasks</body></html>');
        return;
      }
      const id = Number(req.url.split('/').pop());
      if (req.method === 'GET') {
        if (req.url === '/api/tasks') respond(200, [...store.values()]);
        else respond(store.has(id) ? 200 : 404, store.get(id));
        return;
      }
      let data = '';
      for await (const chunk of req) data += chunk;
      const body = data ? JSON.parse(data) : {};
      if (req.method === 'POST') {
        if (!body.title) {
          respond(400, {});
          return;
        }
        const task = { id: nextId++, ...body };
        store.set(task.id, task);
        respond(mode === 'crud-failure' ? 500 : 201, task);
        return;
      }
      if (req.method === 'PUT') {
        const task = { id, ...body };
        store.set(id, task);
        respond(200, task);
        return;
      }
      store.delete(id);
      respond(204);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    const handle = {
      side: request.side,
      stopped: false,
      output: () => 'fixture server logs',
      exited: () => false,
      stop: async () => {
        handle.stopped = true;
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      },
    };
    handles.push(handle);
    return handle;
  };
  t.after(async () => {
    for (const handle of handles) if (!handle.stopped) await handle.stop();
  });
  return { runner, handles, calls };
}

test('verification starts both servers, real HTTP CRUD, restart persistence and cleanup', async (t) => {
  const root = project(t),
    runtime = await runtimeRunner(t);
  const report = await executeJavaInit({
    root,
    execution: { verify: true },
    runner: runtime.runner,
    startupTimeoutMs: 2000,
  });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(status(report, 'verify'), 'passed');
  assert.equal(runtime.handles.filter((handle) => handle.side === 'backend').length, 2);
  assert.equal(runtime.handles.filter((handle) => handle.side === 'frontend').length, 1);
  assert.ok(runtime.handles.every((handle) => handle.stopped));
  assert.match(report.logs.join('\n'), /persistence verified across backend restart/);
  assert.match(report.logs.join('\n'), /POST .* -> 201/);
  assert.match(report.logs.join('\n'), /DELETE .* -> 204/);
  assert.equal(
    fs.readdirSync(path.join(root, '.specgate')).some((name) => name.startsWith('verify-db-')),
    false,
  );
  assert.ok(
    runtime.calls
      .filter((request) => request.kind === 'start')
      .every((request) => request.env.DB_URL.startsWith('jdbc:h2:file:')),
  );
});
for (const mode of ['start-failure', 'crud-failure', 'no-persistence']) {
  test('verification failure ' + mode + ' returns failure and always cleans servers', async (t) => {
    const root = project(t),
      runtime = await runtimeRunner(t, mode);
    const report = await executeJavaInit({
      root,
      execution: { verify: true },
      runner: runtime.runner,
      startupTimeoutMs: 2000,
    });
    assert.equal(report.ok, false);
    assert.equal(status(report, 'verify'), 'failed');
    assert.ok(runtime.handles.every((handle) => handle.stopped));
    assert.match(report.logs.join('\n'), /Runtime process cleanup completed/);
    assert.equal(
      fs.readdirSync(path.join(root, '.specgate')).some((name) => name.startsWith('verify-db-')),
      false,
    );
  });
}

test('preflight selects nearest existing ancestor without creating target', async (t) => {
  const root = project(t),
    target = path.join(root, 'missing/child/project'),
    calls = [];
  const report = await preflightJavaInit({
    root: target,
    execution: { test: true },
    runner: async (request) => {
      calls.push(request);
      return result(request);
    },
  });
  assert.equal(report.ok, true);
  assert.ok(calls.every((request) => request.cwd === root));
  assert.equal(fs.existsSync(path.join(root, 'missing')), false);
});

test('verification readiness timeout and mid-run abort clean both servers', async (t) => {
  const root = project(t),
    runtime = await runtimeRunner(t, 'not-ready');
  const report = await executeJavaInit({
    root,
    execution: { verify: true },
    runner: runtime.runner,
    startupTimeoutMs: 50,
    httpTimeoutMs: 50,
  });
  assert.equal(report.ok, false);
  assert.match(report.errors[0], /readiness timeout/);
  assert.ok(runtime.handles.every((handle) => handle.stopped));
  const controller = new AbortController(),
    second = await runtimeRunner(t);
  const runner = async (request) => {
    const handle = await second.runner(request);
    if (request.kind === 'start' && request.side === 'frontend') controller.abort();
    return handle;
  };
  const abortedReport = await executeJavaInit({
    root,
    execution: { verify: true },
    runner,
    signal: controller.signal,
  });
  assert.equal(abortedReport.ok, false);
  assert.match(abortedReport.errors[0], /aborted/);
  assert.ok(second.handles.every((handle) => handle.stopped));
});

test('cleanup failure preserves the original verification error', async (t) => {
  const root = project(t),
    runtime = await runtimeRunner(t, 'crud-failure');
  const runner = async (request) => {
    const handle = await runtime.runner(request);
    if (request.kind === 'start') {
      const original = handle.stop;
      handle.stop = async () => {
        await original();
        throw Error('cleanup diagnostic');
      };
    }
    return handle;
  };
  const report = await executeJavaInit({ root, execution: { verify: true }, runner });
  assert.equal(report.ok, false);
  assert.match(report.errors[0], /Create must return 201.*cleanup failed/i);
  assert.match(report.logs.join('\n'), /cleanup diagnostic/);
  assert.ok(runtime.handles.every((handle) => handle.stopped));
});
