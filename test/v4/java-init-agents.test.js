import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { checkWrite } from '../../src/v3/guards.js';
import {
  normalizeInitQuality,
  runJavaInitAgents,
  finalizeJavaInitAgents,
  validateInitAgentReport,
} from '../../src/v4/java-init-agents.js';

const SOURCE = 'backend/src/main/java/App.java';
const STAGES = ['test', 'lint', 'format', 'review'];
function git(root, ...args) {
  const out = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim();
}
function put(root, file, content) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}
function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-agents-'));
  t.after(() => {
    assert.ok(path.basename(root).startsWith('sg-java-agents-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  put(root, SOURCE, 'public class App { public String greeting() { return "hello"; } }');
  put(root, 'frontend/src/App.vue', '<template><p>Hello</p></template>');
  put(
    root,
    'backend/pom.xml',
    '<project><java.version>1.8</java.version><version>2.7.18</version></project>',
  );
  put(root, 'frontend/package.json', '{}');
  put(root, '.gitignore', '.specgate/\nbackend/target/\nfrontend/node_modules/\nfrontend/dist/\n');
  git(root, 'init');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@local');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'generated baseline');
  return root;
}
function report(request, status = 'verified') {
  const item = {
    schemaVersion: 1,
    stage: request.stage,
    baseline: request.baseline,
    status,
    summary: 'Executed actual quality inspection against generated project source',
    findings: [],
    commands:
      request.stage === 'review' || request.stage === 'repair'
        ? []
        : [
            {
              command: 'mvn',
              args: [request.stage],
              cwd: 'backend',
              exitCode: status === 'unverified' ? null : 0,
              stdout: status === 'unverified' ? '' : 'Executed fixture command',
              stderr: status === 'unverified' ? 'mvn unavailable' : '',
              ...(status === 'unverified' ? { reason: 'environment' } : {}),
            },
          ],
  };
  if (item.commands.length)
    item.commands.push({ ...item.commands[0], command: 'npm', cwd: 'frontend' });
  if (request.stage === 'review')
    item.review = {
      verdict: status === 'failed' ? 'fail' : 'pass',
      files: [SOURCE, 'frontend/src/App.vue'].map((file) => ({
        path: file,
        sha256: createHash('sha256')
          .update(fs.readFileSync(path.join(request.worktree, file)))
          .digest('hex'),
      })),
      checks: ['CRUD correctness', 'persistence and transactions', 'security and validation'].map(
        (name) => ({
          name,
          evidence:
            SOURCE +
            ':1 reviewed implementation semantics, contract and error handling for ' +
            name,
        }),
      ),
    };
  return item;
}
function writeReport(request, item = report(request)) {
  put(
    request.worktree,
    'docs/initialization/agent-reports/' + request.stage + '.json',
    JSON.stringify(item),
  );
}
function clean(root) {
  assert.equal(
    git(root, 'worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree ')).length,
    1,
  );
}
function host(handler) {
  const starts = [],
    disposals = [];
  const runtime = {
    service: (name) =>
      name === 'subagents'
        ? {
            list: () => ['fixture-provider'],
            startActivation: async (options) => {
              starts.push(options);
              const text = options.request.prompt[0].text;
              const stage = options.label.replace('specgate-java-init-', '');
              const baseline = /Git baseline: ([a-f0-9]+)\./.exec(text)[1];
              const request = {
                stage,
                baseline,
                worktree: options.request.cwd,
                signal: options.signal,
              };
              return {
                childId: stage,
                result: handler(request, starts),
                dispose: async () => {
                  disposals.push(stage);
                },
              };
            },
          }
        : undefined,
  };
  return { runtime, starts, disposals };
}

test('quality normalization is pure strict and idempotent with automatic lenient defaults', () => {
  const expected = { mode: 'lenient', generateOnly: false };
  assert.deepEqual(normalizeInitQuality(), { ok: true, quality: expected });
  assert.deepEqual(normalizeInitQuality(expected).quality, expected);
  for (const input of [
    null,
    [],
    false,
    { mode: 'yes' },
    { generateOnly: 1 },
    { review: false },
    { [Symbol('x')]: true },
  ])
    assert.equal(normalizeInitQuality(input).ok, false);
  assert.deepEqual(normalizeInitQuality(Object.create({ mode: 'strict' })).quality, expected);
});

test('generation only does not touch git, dispatch or verification and never archives', async () => {
  const result = await runJavaInitAgents({
    root: '/missing',
    quality: { generateOnly: true },
    dispatch: () => {
      throw Error('unexpected');
    },
    strictRunner: () => {
      throw Error('unexpected');
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.archiveAllowed, false);
  assert.deepEqual(result.stages, []);
});

test('no host or provider returns actionable SERIAL token and file contract without archive', async (t) => {
  const root = project(t);
  for (const runtime of [
    undefined,
    { service: () => undefined },
    { service: () => ({ list: () => [], startActivation() {} }) },
  ]) {
    const result = await runJavaInitAgents({ root, runtime });
    assert.equal(result.fallbackRequired, true);
    assert.equal(result.archiveAllowed, false);
    assert.match(result.mainAgentPrompt, /SERIAL/);
    assert.match(result.mainAgentPrompt, /sg_init_finalize/);
    assert.match(result.mainAgentPrompt, /sha256/);
    assert.equal(result.token.baseline, git(root, 'rev-parse', 'HEAD'));
  }
  clean(root);
});

test('realistic host launches all four worktrees before waits, disposes all, reads JSON not text', async (t) => {
  const root = project(t);
  const pending = [];
  const service = host(
    (request) =>
      new Promise((resolve) => {
        pending.push({ request, resolve });
        if (pending.length === 4)
          for (const item of pending) {
            writeReport(item.request);
            item.resolve({ output: [{ type: 'text', text: 'not a pass report' }] });
          }
      }),
  );
  const result = await runJavaInitAgents({ root, runtime: service.runtime });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(service.starts.length, 4);
  assert.equal(new Set(service.starts.map((item) => item.request.cwd)).size, 4);
  assert.deepEqual(service.disposals.sort(), STAGES.slice().sort());
  clean(root);
});

test('lenient environmental failures are unverified warnings, not fake passes', async (t) => {
  const root = project(t);
  const result = await runJavaInitAgents({
    root,
    dispatch: async (request) =>
      writeReport(request, report(request, request.stage === 'review' ? 'verified' : 'unverified')),
  });
  assert.equal(result.accepted, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.length, 3);
  assert.equal(result.stages.filter((item) => item.status === 'unverified').length, 3);
  clean(root);
});

test('failed host activation aborts siblings and removes every managed tree', async (t) => {
  const root = project(t);
  const service = host(async (request) => {
    if (request.stage === 'test') throw Error('host exploded');
    await new Promise((resolve) => {
      if (request.signal.aborted) resolve();
      else request.signal.addEventListener('abort', resolve, { once: true });
    });
    return { stopReason: 'aborted' };
  });
  const result = await runJavaInitAgents({ root, runtime: service.runtime });
  assert.equal(result.ok, false);
  assert.equal(result.archiveAllowed, false);
  assert.equal(service.disposals.length, 4);
  clean(root);
});

test('malformed, textual and unsupported review success are rejected', async (t) => {
  const root = project(t);
  for (const mutate of [
    () => ({ ok: true, text: 'pass' }),
    (item) => ({ ...item, stage: 'other' }),
    (item) => ({ ...item, review: { verdict: 'pass', files: [], checks: [] } }),
    (item) => ({
      ...item,
      commands: [{ command: 'mvn', args: [], cwd: '.', exitCode: 1, stdout: '', stderr: '' }],
    }),
  ]) {
    const result = await runJavaInitAgents({
      root,
      dispatch: async (request) => {
        writeReport(
          request,
          request.stage === 'review' ? mutate(report(request)) : report(request),
        );
        return { ok: true, text: 'all passed' };
      },
    });
    assert.equal(result.accepted, false);
    clean(root);
  }
});

test('protected and ignored configuration/tests/baseline edits cannot merge', async (t) => {
  const root = project(t),
    initial = git(root, 'rev-parse', 'HEAD');
  for (const file of [
    'backend/pom.xml',
    '.specgate/approval.json',
    'backend/src/test/AppTest.java',
    '.gitignore',
    SOURCE,
  ]) {
    const result = await runJavaInitAgents({
      root,
      dispatch: async (request) => {
        if (request.stage === 'lint') put(request.worktree, file, 'unauthorized');
        writeReport(request);
      },
    });
    assert.equal(result.accepted, false, file);
    assert.match(result.errors.join(' '), /Unauthorized/);
    assert.equal(git(root, 'rev-parse', 'HEAD'), initial);
    clean(root);
  }
});

test('controlled production repair is independently rechecked before fast-forward merge', async (t) => {
  const root = project(t),
    original = git(root, 'rev-parse', 'HEAD');
  const stages = [];
  const result = await runJavaInitAgents({
    root,
    dispatch: async (request) => {
      stages.push(request.stage);
      if (request.stage === 'repair')
        put(
          request.worktree,
          SOURCE,
          'public class App { public String greeting() { return "fixed"; } }',
        );
      const item = report(request);
      if (request.stage === 'review' && request.baseline === original) {
        item.status = 'failed';
        item.review.verdict = 'fail';
        item.findings = [
          {
            severity: 'high',
            path: SOURCE,
            line: 1,
            message: 'Repair greeting contract',
            resolved: false,
          },
        ];
      }
      writeReport(request, item);
    },
  });
  assert.equal(result.accepted, true, JSON.stringify(result.errors));
  assert.equal(stages.length, 9);
  assert.equal(result.mergedCommits.length, 1);
  assert.match(fs.readFileSync(path.join(root, SOURCE), 'utf8'), /fixed/);
  clean(root);
});

test('external root changes during repairs refuse merge rather than overwrite conflict', async (t) => {
  const root = project(t);
  const result = await runJavaInitAgents({
    root,
    dispatch: async (request) => {
      if (request.stage === 'lint') put(root, SOURCE, 'external change');
      writeReport(request);
    },
  });
  assert.equal(result.accepted, false);
  assert.match(result.errors.join(' '), /baseline changed/);
  assert.equal(fs.readFileSync(path.join(root, SOURCE), 'utf8'), 'external change');
  clean(root);
});

test('unresolved high critical and weak/stale review file evidence fail validation', async (t) => {
  const root = project(t),
    baseline = git(root, 'rev-parse', 'HEAD'),
    request = { stage: 'review', baseline, worktree: root };
  for (const severity of ['high', 'critical']) {
    const item = report(request);
    item.findings = [
      { severity, path: SOURCE, line: 1, message: 'actual security defect', resolved: false },
    ];
    assert.equal(validateInitAgentReport(item, { stage: 'review', baseline, root }).ok, false);
  }
  const item = report(request);
  item.review.files[0].sha256 = '0'.repeat(64);
  assert.equal(validateInitAgentReport(item, { stage: 'review', baseline, root }).ok, false);
});

test('serial finalize requires all stage-owned report files and pinned clean baseline', async (t) => {
  const root = project(t),
    fallback = await runJavaInitAgents({ root });
  const { token, reports } = fallback;
  for (const stage of STAGES)
    put(
      root,
      reports[stage],
      JSON.stringify(
        report(
          { stage, baseline: token.baseline, worktree: root },
          stage === 'review' ? 'verified' : 'unverified',
        ),
      ),
    );
  assert.equal((await finalizeJavaInitAgents({ root, token, reports })).accepted, true);
  assert.equal(
    (
      await finalizeJavaInitAgents({
        root,
        token,
        reports: { ...reports, review: '../outside.json' },
      })
    ).accepted,
    false,
  );
  put(root, SOURCE, 'stale source');
  assert.equal((await finalizeJavaInitAgents({ root, token, reports })).accepted, false);
});

test('strict does actual executor preflight and never accepts scripted whole-report pass', async (t) => {
  const root = project(t),
    calls = [];
  const result = await runJavaInitAgents({
    root,
    quality: { mode: 'strict' },
    dispatch: async (request) => writeReport(request),
    strictRunner: async (request) => {
      calls.push(request);
      return { ok: true, stages: [{ name: 'verify', status: 'passed' }] };
    },
  });
  assert.equal(result.accepted, false);
  assert.ok(calls.length > 0);
  assert.equal(result.strictVerification.ok, false);
  clean(root);
});

// Real local HTTP servers exercise the strict executor's CRUD/restart persistence protocol.
function strictRunner() {
  const data = new Map();
  let next = 1;
  return async (request) => {
    if (request.kind !== 'start') {
      if (request.stage === 'preflight') {
        const name = path.basename(request.command);
        if (name.startsWith('javac')) return { exitCode: 0, stdout: 'javac 1.8.0_482' };
        if (name.startsWith('java')) return { exitCode: 0, stderr: 'openjdk version "1.8.0_482"' };
        if (name.startsWith('mvn'))
          return { exitCode: 0, stdout: 'Apache Maven 3.9.11\nJava version: 1.8.0_482' };
        return { exitCode: 0, stdout: '10.8.2' };
      }
      if (request.stage === 'verify' && request.command.includes('mvn'))
        put(request.cwd, 'target/app.jar', 'fixture artifact');
      return { exitCode: 0, stdout: 'fixture command execution' };
    }
    const args = request.args.join(' ');
    const match = /--server.port=(\d+)/.exec(args) || /--port (\d+)/.exec(args);
    assert.ok(match, args);
    const backend = args.includes('--server.port=');
    const server = http.createServer(async (req, res) => {
      if (!backend) {
        if (req.url.startsWith('/api/')) {
          const response = await fetch('http://127.0.0.1:' + request.env.BACKEND_PORT + req.url);
          res.statusCode = response.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(await response.text());
        } else {
          res.setHeader('Content-Type', 'text/html');
          res.end('<html><div id="app"></div></html>');
        }
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const url = new URL(req.url, 'http://localhost'),
        id = Number(url.pathname.split('/').pop());
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && !payload?.title) {
        res.statusCode = 400;
        res.end('{}');
      } else if (req.method === 'POST') {
        const item = { ...payload, id: next++ };
        data.set(item.id, item);
        res.statusCode = 201;
        res.end(JSON.stringify(item));
      } else if (req.method === 'PUT') {
        const item = { ...payload, id };
        data.set(id, item);
        res.end(JSON.stringify(item));
      } else if (req.method === 'DELETE') {
        data.delete(id);
        res.statusCode = 204;
        res.end();
      } else if (id) {
        if (!data.has(id)) {
          res.statusCode = 404;
          res.end('{}');
        } else res.end(JSON.stringify(data.get(id)));
      } else res.end(JSON.stringify([...data.values()]));
    });
    await new Promise((resolve) => server.listen(Number(match[1]), '127.0.0.1', resolve));
    return {
      stop: () => new Promise((resolve) => server.close(resolve)),
      output: () => '',
      exited: () => false,
    };
  };
}

test('strict environmental commands remain unverified and prevent archive even after verification', async (t) => {
  const root = project(t);
  const result = await runJavaInitAgents({
    root,
    quality: { mode: 'strict' },
    dispatch: async (request) =>
      writeReport(request, report(request, request.stage === 'review' ? 'verified' : 'unverified')),
    strictRunner: strictRunner(),
  });
  assert.equal(result.accepted, false);
  assert.equal(result.strictVerification.ok, true);
  assert.equal(result.warnings.length, 3);
  clean(root);
});

test('repair cannot change tests or root configuration, and no source is merged', async (t) => {
  const root = project(t),
    baseline = git(root, 'rev-parse', 'HEAD');
  for (const file of [
    'backend/pom.xml',
    'backend/src/test/WeakTest.java',
    '.specgate/approval.json',
  ]) {
    const result = await runJavaInitAgents({
      root,
      dispatch: async (request) => {
        const item = report(request);
        if (request.stage === 'review') {
          item.status = 'failed';
          item.review.verdict = 'fail';
          item.findings = [
            {
              severity: 'high',
              path: SOURCE,
              line: 1,
              message: 'Concrete defect',
              resolved: false,
            },
          ];
        }
        if (request.stage === 'repair') put(request.worktree, file, 'unauthorized repair');
        writeReport(request, item);
      },
    });
    assert.equal(result.accepted, false);
    assert.match(result.errors.join(' '), /Unauthorized repair edit/);
    assert.equal(git(root, 'rev-parse', 'HEAD'), baseline);
    clean(root);
  }
});

test('partial source review, malformed untrusted containers and missing frontend commands fail closed', async (t) => {
  const root = project(t),
    baseline = git(root, 'rev-parse', 'HEAD');
  const request = { stage: 'review', baseline, worktree: root };
  const partial = report(request);
  partial.review.files.pop();
  assert.equal(validateInitAgentReport(partial, { stage: 'review', baseline, root }).ok, false);
  for (const field of ['commands', 'findings']) {
    const malformed = { ...report(request), status: 'unverified', [field]: {} };
    assert.doesNotThrow(() =>
      validateInitAgentReport(malformed, { stage: 'review', baseline, root }),
    );
    assert.equal(validateInitAgentReport(malformed, { stage: 'review', baseline, root }).ok, false);
  }
  const item = report({ ...request, stage: 'test' });
  item.commands.pop();
  assert.equal(validateInitAgentReport(item, { stage: 'test', baseline, root }).ok, false);
});

test('already aborted signals do not dispatch or create worktrees', async (t) => {
  const root = project(t),
    controller = new AbortController();
  controller.abort();
  const result = await runJavaInitAgents({
    root,
    signal: controller.signal,
    dispatch: () => {
      throw Error('must not dispatch');
    },
  });
  assert.equal(result.accepted, false);
  assert.match(result.errors.join(' '), /aborted/);
  clean(root);
});

test('parent untracked init report is permitted but arbitrary metadata is rejected', async (t) => {
  const root = project(t);
  put(root, '.gitignore', 'backend/target/\nfrontend/node_modules/\nfrontend/dist/\n');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '-m', 'expose metadata artifacts');
  put(root, '.specgate/init-report.json', '{"generated":true}');
  const pending = await runJavaInitAgents({ root });
  assert.equal(pending.fallbackRequired, true);
  put(root, '.specgate/init-pending.json', JSON.stringify(pending.token));
  for (const stage of STAGES)
    put(
      root,
      pending.reports[stage],
      JSON.stringify(report({ stage, baseline: pending.token.baseline, worktree: root })),
    );
  assert.equal(
    (await finalizeJavaInitAgents({ root, token: pending.token, reports: pending.reports }))
      .accepted,
    true,
  );
  assert.equal((await runJavaInitAgents({ root })).fallbackRequired, true);
  put(root, '.specgate/unknown.json', '{}');
  const rejected = await runJavaInitAgents({ root });
  assert.equal(rejected.fallbackRequired, false);
  assert.match(rejected.errors.join(' '), /clean committed Git baseline/);
});

test('actual SpecGate write guard permits isolated and serial stage report files without metadata bypass', async (t) => {
  const root = project(t);
  const runtime = { getCwd: (agent) => agent.cwd };
  const pending = await runJavaInitAgents({ root });
  for (const stage of STAGES) {
    assert.match(pending.reports[stage], /^docs\/initialization\/pending\/[a-f0-9]+\//);
    assert.equal(
      checkWrite(runtime, {
        name: 'write',
        agent: { cwd: root },
        arguments: { file_path: pending.reports[stage] },
      }),
      undefined,
    );
    put(
      root,
      pending.reports[stage],
      JSON.stringify(report({ stage, baseline: pending.token.baseline, worktree: root })),
    );
  }
  assert.equal(
    (await finalizeJavaInitAgents({ root, token: pending.token, reports: pending.reports }))
      .accepted,
    true,
  );
  const result = await runJavaInitAgents({
    root,
    dispatch: async (request) => {
      assert.match(
        request.reportPath.replaceAll('\\', '/'),
        /docs\/initialization\/agent-reports\//,
      );
      assert.equal(
        checkWrite(runtime, {
          name: 'write',
          agent: { cwd: request.worktree },
          arguments: { file_path: request.reportPath },
        }),
        undefined,
      );
      assert.match(
        checkWrite(runtime, {
          name: 'write',
          agent: { cwd: request.worktree },
          arguments: { file_path: '.specgate/init-agent-report.json' },
        }),
        /不能写入/,
      );
      writeReport(request);
    },
  });
  assert.equal(result.accepted, true, JSON.stringify(result.errors));
  clean(root);
});

test('dirty tracked metadata is rejected before dispatch and before serial finalization', async (t) => {
  const root = project(t);
  put(root, '.specgate/config.json', '{"approved":false}');
  git(root, 'add', '-f', '.specgate/config.json');
  git(root, 'commit', '-m', 'track protected configuration');
  const pending = await runJavaInitAgents({ root });
  assert.equal(pending.fallbackRequired, true);
  for (const stage of STAGES)
    put(
      root,
      pending.reports[stage],
      JSON.stringify(report({ stage, baseline: pending.token.baseline, worktree: root })),
    );
  put(root, '.specgate/config.json', '{"approved":true}');
  const blocked = await runJavaInitAgents({
    root,
    dispatch: () => {
      throw Error('must not dispatch dirty metadata');
    },
  });
  assert.equal(blocked.accepted, false);
  assert.match(blocked.errors.join(' '), /clean committed Git baseline/);
  const finalized = await finalizeJavaInitAgents({
    root,
    token: pending.token,
    reports: pending.reports,
  });
  assert.equal(finalized.accepted, false);
  assert.match(finalized.errors.join(' '), /clean committed Git baseline/);
  clean(root);
});

test('agents cannot commit alternate baselines or smuggle reports through symlink directories', async (t) => {
  const root = project(t),
    original = git(root, 'rev-parse', 'HEAD');
  const committed = await runJavaInitAgents({
    root,
    dispatch: async (request) => {
      if (request.stage === 'lint') {
        put(request.worktree, SOURCE, 'alternate baseline');
        git(request.worktree, 'add', SOURCE);
        git(request.worktree, 'commit', '-m', 'unauthorized commit');
      }
      writeReport(request);
    },
  });
  assert.equal(committed.accepted, false);
  assert.match(committed.errors.join(' '), /must not alter Git baseline/);
  assert.equal(git(root, 'rev-parse', 'HEAD'), original);
  clean(root);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-agent-outside-'));
  t.after(() => {
    assert.ok(path.basename(outside).startsWith('sg-java-agent-outside-'));
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const linked = await runJavaInitAgents({
    root,
    dispatch: async (request) => {
      if (request.stage === 'lint')
        fs.symlinkSync(
          outside,
          path.join(request.worktree, 'docs'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      writeReport(request);
    },
  });
  assert.equal(linked.accepted, false);
  assert.match(linked.errors.join(' '), /Symlink forbidden/);
  clean(root);
});

test('strict verification that mutates reviewed source is rejected despite successful commands', async (t) => {
  const root = project(t),
    runner = strictRunner();
  const result = await runJavaInitAgents({
    root,
    quality: { mode: 'strict' },
    dispatch: async (request) => writeReport(request),
    strictRunner: async (request) => {
      if (request.stage === 'format') put(root, SOURCE, 'formatter changed reviewed artifact');
      return runner(request);
    },
  });
  assert.equal(result.accepted, false);
  assert.match(result.errors.join(' '), /changed reviewed source/);
  clean(root);
});

test('strict requires real command outcomes plus live CRUD and restart persistence pass', async (t) => {
  const root = project(t);
  const result = await runJavaInitAgents({
    root,
    quality: { mode: 'strict' },
    dispatch: async (request) => writeReport(request),
    strictRunner: strictRunner(),
  });
  assert.equal(
    result.accepted,
    true,
    JSON.stringify(result.strictVerification?.errors || result.errors),
  );
  for (const stage of ['test', 'lint', 'format', 'review', 'verify'])
    assert.equal(
      result.strictVerification.stages.find((item) => item.name === stage).status,
      'passed',
    );
  clean(root);
});
