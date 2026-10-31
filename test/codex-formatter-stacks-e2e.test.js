import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeFormatter } from '../src/codex/format.js';
import { createEnvironmentService } from '../src/codex/core/environment.js';

const roots = [];
const prettier = fileURLToPath(
  new URL('../node_modules/prettier/bin/prettier.cjs', import.meta.url),
);
function project() {
  const base = process.env.SPECGATE_E2E_EXECUTION_TEMP || os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'sg-format-stack-'));
  roots.push(root);
  return root;
}
function write(root, name, content) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function toolEnvironment() {
  const base =
    process.env.SPECGATE_E2E_FORMATTER_TOOLS || path.resolve('.tmp/workflow-repair-tools');
  const nativeReceipt = path.join(base, 'pnpm-12.14.0/native/receipt.json');
  const native = fs.existsSync(nativeReceipt)
    ? path.dirname(JSON.parse(fs.readFileSync(nativeReceipt)).command)
    : '';
  return {
    PATH: [
      path.join(base, 'yarn-1.22.22'),
      path.join(base, 'ruff-0.15.10'),
      native,
      process.env.PATH || process.env.Path,
    ]
      .filter(Boolean)
      .join(path.delimiter),
  };
}
for (const manager of ['yarn', 'pnpm'])
  test(`real ${manager} formats a nested module using its declared package manager`, async () => {
    const root = project();
    write(root, 'package.json', JSON.stringify({ private: true, workspaces: ['apps/*'] }));
    write(
      root,
      'apps/client/package.json',
      JSON.stringify({
        name: 'formatter-client',
        version: '1.0.0',
        private: true,
        packageManager: manager + '@' + (manager === 'yarn' ? '1.22.22' : '12.14.0'),
        scripts: {
          format: `node "${prettier.replaceAll('\\', '/')}" --write src`,
          'format:check': `node "${prettier.replaceAll('\\', '/')}" --check src`,
        },
      }),
    );
    write(root, 'apps/client/src/app.js', 'export const hello={answer:42}');
    const formatter = createNativeFormatter({ env: toolEnvironment() });
    const result = await formatter({ worktree: root });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(fs.readFileSync(path.join(root, 'apps/client/src/app.js'), 'utf8'), /answer: 42/);
    assert.equal(result.commands.at(-1).command, manager);
    assert.equal((await formatter({ worktree: root, mode: 'check' })).ok, true);
  });
test('real Ruff formats Python and an unformatted check is read-only', async () => {
  const root = project();
  write(root, 'pyproject.toml', '[tool.ruff]\nline-length = 88\n');
  write(root, 'app.py', 'answer={"value":42}\n');
  const formatter = createNativeFormatter({ env: toolEnvironment() });
  assert.equal((await formatter({ worktree: root, mode: 'check' })).ok, false);
  assert.equal(fs.readFileSync(path.join(root, 'app.py'), 'utf8'), 'answer={"value":42}\n');
  const result = await formatter({ worktree: root });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(fs.readFileSync(path.join(root, 'app.py'), 'utf8'), /answer =/);
  assert.equal((await formatter({ worktree: root, mode: 'check' })).ok, true);
});
test('real checked Go SDK supplies gofmt and treats nonempty -l output as failure', async () => {
  const root = project();
  write(root, 'go.mod', 'module formatterproof\n\ngo 1.24\n');
  write(root, 'main.go', 'package main\nfunc main(){println("proof")}\n');
  const service = createEnvironmentService({
    root,
    cacheRoot: process.env.SPECGATE_E2E_TOOLCHAIN_CACHE,
  });
  const formatter = createNativeFormatter({
    environmentContext: () => service.executionContext({ stack: 'go' }),
  });
  const check = await formatter({ worktree: root, mode: 'check' });
  assert.equal(check.code, 'FORMAT_CHECK_FAILED', JSON.stringify(check));
  const result = await formatter({ worktree: root });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(path.isAbsolute(result.commands.at(-1).executedArgv[0]));
  assert.match(fs.readFileSync(path.join(root, 'main.go'), 'utf8'), /func main\(\) \{/);
  assert.equal((await formatter({ worktree: root, mode: 'check' })).ok, true);
});
test('real cached Maven Spotless formats root Java and checks the formatted source', async () => {
  const root = project();
  write(
    root,
    'pom.xml',
    '<project><modelVersion>4.0.0</modelVersion><groupId>local.proof</groupId><artifactId>formatter-proof</artifactId><version>1</version><build><plugins><plugin><groupId>com.diffplug.spotless</groupId><artifactId>spotless-maven-plugin</artifactId><version>2.30.0</version><configuration><java><googleJavaFormat><version>1.24.0</version></googleJavaFormat></java></configuration></plugin></plugins></build></project>',
  );
  write(
    root,
    'src/main/java/Proof.java',
    'public class Proof{public static void main(String[] args){System.out.println("ok");}}',
  );
  const service = createEnvironmentService({ root });
  const formatter = createNativeFormatter({
    environmentContext: () => service.executionContext({ stack: 'java', javaVersion: '17' }),
  });
  const result = await formatter({ worktree: root });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(
    fs.readFileSync(path.join(root, 'src/main/java/Proof.java'), 'utf8'),
    /class Proof \{/,
  );
  assert.equal((await formatter({ worktree: root, mode: 'check' })).ok, true);
});
test('missing configuration, missing executable, conflicting locks and absent check mode block', async () => {
  const root = project();
  write(root, 'package.json', JSON.stringify({ scripts: { format: 'node -e "process.exit(0)"' } }));
  assert.equal(
    (await createNativeFormatter()({ worktree: root, mode: 'check' })).code,
    'FORMAT_COMMAND_MISSING',
  );
  write(root, 'yarn.lock', '');
  write(root, 'package-lock.json', '{}');
  assert.equal(
    (await createNativeFormatter()({ worktree: root })).code,
    'FORMAT_CONFIGURATION_INVALID',
  );
  fs.rmSync(path.join(root, 'package.json'));
  fs.rmSync(path.join(root, 'yarn.lock'));
  fs.rmSync(path.join(root, 'package-lock.json'));
  write(
    root,
    '.specgate/format.json',
    JSON.stringify({
      schemaVersion: 1,
      commands: [{ id: 'missing', cwd: '.', apply: ['specgate-deliberately-missing-formatter'] }],
    }),
  );
  assert.equal((await createNativeFormatter()({ worktree: root })).ok, false);
});
test.after(() => {
  for (const root of roots)
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});
test('root npm formatter actually formats JSX/Vue and check leaves bytes unchanged', async () => {
  const root = project();
  write(
    root,
    'package.json',
    JSON.stringify({
      name: 'real-formatter',
      private: true,
      scripts: {
        format: `node "${prettier.replaceAll('\\', '/')}" --write src`,
        'format:check': `node "${prettier.replaceAll('\\', '/')}" --check src`,
      },
    }),
  );
  write(root, 'src/App.jsx', 'export const App=()=> <div>hello</div>');
  write(
    root,
    'src/App.vue',
    '<template><div>{{message}}</div></template><script setup>const message="hello"</script>',
  );
  const bad = await createNativeFormatter()({ worktree: root, mode: 'check' });
  assert.equal(bad.ok, false, JSON.stringify(bad));
  const result = await createNativeFormatter()({ worktree: root });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8'), /App =/);
  const before = fs.readFileSync(path.join(root, 'src/App.vue'), 'utf8');
  const check = await createNativeFormatter()({ worktree: root, mode: 'check' });
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.equal(fs.readFileSync(path.join(root, 'src/App.vue'), 'utf8'), before);
  assert.equal(check.commands.at(-1).mode, 'check');
});
test('an explicit check command which changes source is rejected even with exit zero', async () => {
  const root = project();
  write(root, 'src/file.txt', 'original');
  write(root, 'bad.mjs', "import fs from 'node:fs';fs.writeFileSync('src/file.txt','changed');");
  write(
    root,
    '.specgate/format.json',
    JSON.stringify({
      schemaVersion: 1,
      commands: [{ id: 'custom', cwd: '.', check: [process.execPath, 'bad.mjs'] }],
    }),
  );
  const result = await createNativeFormatter()({ worktree: root, mode: 'check' });
  assert.equal(result.code, 'FORMAT_CHECK_MUTATION', JSON.stringify(result));
});

test('the server reads ignored project configuration from its bound root and executes in the worktree', async () => {
  const root = project(),
    worktree = project();
  write(
    root,
    '.specgate/format.json',
    JSON.stringify({
      schemaVersion: 1,
      commands: [
        {
          id: 'custom-language',
          cwd: '.',
          apply: [
            process.execPath,
            '-e',
            "require('node:fs').writeFileSync('proof.txt','formatted-in-worktree')",
          ],
          check: [
            process.execPath,
            '-e',
            "require('node:assert/strict').equal(require('node:fs').readFileSync('proof.txt','utf8'),'formatted-in-worktree')",
          ],
        },
      ],
    }),
  );
  const formatter = createNativeFormatter({ projectRoot: root });
  const result = await formatter({ worktree });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.existsSync(path.join(root, 'proof.txt')), false);
  assert.equal((await formatter({ worktree, mode: 'check' })).ok, true);
  assert.match(result.configurationHash, /^[a-f0-9]{64}$/);
});

test('ProjectProfile formatter commands are all retained and run in their declared module', async () => {
  const root = project(),
    worktree = project(),
    now = new Date().toISOString();
  write(worktree, 'module/file.txt', 'before');
  const profile = {
    schemaVersion: 2,
    projectId: 'formatter-profile',
    mode: 'adopted',
    stack: 'custom',
    root,
    targetBranch: 'main',
    remoteUrl: null,
    commands: {
      install: [],
      build: [],
      test: [],
      lint: [],
      runtime: [],
      format: [
        {
          id: 'first',
          cwd: 'module',
          argv: [process.execPath, '-e', "require('node:fs').writeFileSync('file.txt','first')"],
        },
        {
          id: 'second',
          cwd: 'module',
          argv: [
            process.execPath,
            '-e',
            "require('node:assert/strict').equal(require('node:fs').readFileSync('file.txt','utf8'),'first');require('node:fs').appendFileSync('file.txt','+second')",
          ],
        },
      ],
    },
    protectedPaths: [],
    createdAt: now,
    updatedAt: now,
  };
  write(root, '.specgate/codex/project.json', JSON.stringify(profile));
  const formatter = createNativeFormatter({ projectRoot: root });
  assert.equal((await formatter({ worktree, mode: 'check' })).code, 'FORMAT_COMMAND_MISSING');
  const result = await formatter({ worktree });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.commands.length, 2);
  assert.equal(fs.readFileSync(path.join(worktree, 'module/file.txt'), 'utf8'), 'first+second');
});
