// Real isolated sg-change acceptance with a deterministic role adapter.
// Does not invoke a model, publish, push or commit the plugin repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { startJavaInit } from '../src/v4/java-init.js';
import { verifyJavaProject, scanToolchains, pickJavaHome } from '../src/v4/java-verify.js';
import { loadTemplateStyle, projectSourceHash } from '../src/v3/template-style.js';
import { createRuntime } from '../src/v3/runtime.js';
import { registerTools } from '../src/v3/tools.js';
import { load } from '../src/v3/state.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resumed = Boolean(process.argv[2]);
const fixturesRoot = path.join(repo, '.specgate/change-qa');
const root = resumed ? path.resolve(process.argv[2]) : path.join(fixturesRoot, String(Date.now()));
const relativeFixture = path.relative(fixturesRoot, root);
if (!relativeFixture || relativeFixture.startsWith('..') || path.isAbsolute(relativeFixture))
  throw new Error('Acceptance may only modify its isolated .specgate/change-qa fixture');
const change = 'add-reference-notes';
const progressFile = path.join(fixturesRoot, path.basename(root) + '.progress.json');
const records =
  resumed && fs.existsSync(progressFile)
    ? JSON.parse(fs.readFileSync(progressFile, 'utf8')).records || []
    : [];
function write(target, name, text) {
  const file = path.join(target, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function git(target, args) {
  return execFileSync('git', args, {
    cwd: target,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function commit(target, message) {
  git(target, ['add', '-A']);
  git(target, ['commit', '-qm', message]);
}
if (!resumed) {
  const init = await startJavaInit({
    root,
    version: 'jdk17-boot3.5',
    userQuestions: { ask: async () => ({ answers: [{ selected: ['确认'] }] }) },
  });
  assert.equal(init.ok, true, JSON.stringify(init));
  git(root, ['config', 'user.name', 'SpecGate acceptance']);
  git(root, ['config', 'user.email', 'acceptance@local']);
}
const tools = scanToolchains({ root, scan: { requestedJdk: '17' } });
process.env.JAVA_HOME = pickJavaHome(tools.java, '17');
process.env.MAVEN_CMD = tools.maven.path;
process.env.PATH = [
  path.join(process.env.JAVA_HOME, 'bin'),
  path.dirname(tools.maven.path),
  process.env.PATH,
].join(path.delimiter);
if (!resumed) {
  const baseline = await verifyJavaProject({
    root,
    onProgress: (event) => console.log(event.message),
  });
  assert.equal(baseline.ok, true, baseline.message);
  commit(root, 'record real baseline verification');
}
const fixture = (name) =>
  fs.readFileSync(path.join(repo, 'test/fixtures/reference-note', name), 'utf8');
const java = 'backend/src/main/java/com/example/tasks/';
const notes = [
  'entity/Task.java',
  'repository/TaskRepository.java',
  'dto/TaskRequest.java',
  'dto/UpdateTaskRequest.java',
  'vo/TaskVO.java',
  'service/TaskService.java',
  'controller/TaskController.java',
];
const backendTest = 'backend/src/test/java/com/example/tasks/NoteApiTest.java';
const frontendTest = 'frontend/test/notes.test.ts';
async function runner({ role, worktree, prompt }) {
  assert.match(prompt, /class TaskService/);
  assert.match(prompt, /const taskApi/);
  records.push({
    role,
    sourceHash: projectSourceHash(worktree),
    manifestHash: loadTemplateStyle(worktree).manifestHash,
  });
  console.log('ROLE ' + role + ' ' + worktree);
  if (role === 'implementer') {
    for (const name of notes) {
      const content = fs
        .readFileSync(path.join(worktree, java + name), 'utf8')
        .replaceAll('Task', 'Note')
        .replaceAll('/api/tasks', '/api/notes')
        .replace('name = "tasks"', 'name = "notes"')
        .replaceAll('${app.tasks.', '${app.notes.');
      write(worktree, java + name.replaceAll('Task', 'Note'), content);
    }
    write(worktree, 'frontend/src/api/notes.ts', fixture('notes.ts.tpl'));
    write(worktree, 'frontend/src/components/NotesPanel.vue', fixture('NotesPanel.vue.tpl'));
    const app = path.join(worktree, 'frontend/src/App.vue');
    fs.writeFileSync(
      app,
      fs
        .readFileSync(app, 'utf8')
        .replace(
          'import { authApi }',
          "import NotesPanel from './components/NotesPanel.vue';\nimport { authApi }",
        )
        .replace('<footer>', '<NotesPanel :admin="admin" />\n        <footer>'),
    );
    fs.appendFileSync(
      path.join(worktree, 'docs/api.md'),
      '\n## Notes\n\n/api/notes mirrors Task CRUD, pagination and batch contracts, with independent Note DTO/VO/entity/service/repository and ADMIN write permissions. The Notes panel uses a typed API module. No CSV/file endpoints are added for Notes.\n',
    );
    commit(worktree, 'implement Notes using pinned Task examples');
    return { ok: true, text: 'Implemented independent Note resource from project examples' };
  }
  if (role === 'tester') {
    write(worktree, backendTest, fixture('NoteApiTest.java.tpl'));
    write(worktree, frontendTest, fixture('notes.test.ts.tpl'));
    const appTest = path.join(worktree, 'frontend/test/App.test.ts');
    fs.appendFileSync(
      appTest,
      "\nvi.mock('../src/components/NotesPanel.vue',()=>({default:{template:'<div />'}}));\n",
    );
    commit(worktree, 'test Note HTTP contract and Vue CRUD behavior');
    return { ok: true, text: 'Added real MockMvc and Vitest tests' };
  }
  if (role === 'reviewer') {
    assert.match(
      fs.readFileSync(path.join(worktree, java + 'controller/NoteController.java'), 'utf8'),
      /NoteService/,
    );
    assert.match(
      fs.readFileSync(path.join(worktree, java + 'service/NoteService.java'), 'utf8'),
      /@Transactional/,
    );
    assert.match(
      fs.readFileSync(path.join(worktree, 'frontend/src/api/notes.ts'), 'utf8'),
      /\/api\/notes\/update/,
    );
    const style = loadTemplateStyle(worktree);
    assert.equal(style.ok, true);
    const checklist = Object.fromEntries(
      Object.entries({
        layering:
          'NoteController delegates to NoteService; Note DTO/VO and JPA repository are separate.',
        transactions:
          'NoteService retains transactional create/update/delete and atomic batch behavior.',
        errors:
          'Shared ApiResponse/BusinessException boundary is retained and HTTP negative cases run.',
        authentication:
          'Shared Session/CSRF and ADMIN-only mutation rules cover /api/notes; tests reject viewer writes.',
        files:
          'Notes introduces no file routes; unchanged file security regression runs in full verification.',
        templateStyle:
          'Actual pinned examples were loaded; Note types/module avoid leaking Task domain names.',
        tests:
          'Independent MockMvc Note workflow and Vue/API Note cases run with separate backend/frontend coverage gates.',
      }).map(([key, reason]) => [key, { status: 'pass', reason }]),
    );
    return {
      ok: true,
      text: JSON.stringify({
        verdict: 'pass',
        blocking: [],
        nonBlocking: [],
        checklist,
        sourceHash: projectSourceHash(worktree),
        templateManifestHash: style.manifestHash,
      }),
    };
  }
  throw new Error('Unexpected role ' + role);
}
const registered = new Map();
const ctx = {
  get: (name) =>
    name === 'userQuestions'
      ? { ask: async () => ({ answers: [{ selected: ['通过'] }] }) }
      : undefined,
  tools: {
    register: (definition) => {
      registered.set(definition.name, definition);
      return () => registered.delete(definition.name);
    },
  },
};
const runtime = createRuntime(ctx, { root, agentRunner: runner });
registerTools(ctx, runtime);
async function call(name, args = {}) {
  const result = await registered.get(name).execute(args, { agent: null });
  console.log(name + ': ' + result.text);
  fs.writeFileSync(
    progressFile,
    JSON.stringify({ root, phase: load(root).state?.phase, records, last: result }, null, 2),
  );
  if (result.kind === 'error' || result.data?.ok === false) throw new Error(JSON.stringify(result));
  return result;
}
if (!resumed) {
  await call('sg_change', { name: change, type: 'feature' });
  const directory = 'openspec/changes/' + change + '/';
  write(
    root,
    directory + 'proposal.md',
    `# Notes acceptance\n\n关联基线 REQ-001。\n\n## 问题\n需要验证新增独立资源参照初始化样例。\n## 目标\n新增 Note API 与 Vue 管理入口，验证 AC-101 和 AC-102。\n## 非目标\n不扩展文件或 CSV 功能。\n## 影响面\n后端 Note 分层、前端 typed API/组件、文档与测试。\n`,
  );
  write(
    root,
    directory + 'specs/notes/spec.md',
    `## ADDED Requirements\n\n### Requirement: Note reference resource (REQ-101)\n\nThe system SHALL manage notes using the pinned reference style.\n\n#### Scenario: Note HTTP workflow (AC-101)\n\n- **WHEN** an administrator manages notes\n- **THEN** CRUD, pagination, permissions and atomic batch behavior follow the template\n\n#### Scenario: Note Vue workflow (AC-102)\n\n- **WHEN** a user opens the Notes panel\n- **THEN** the typed API and role-aware forms behave correctly\n`,
  );
  await call('sg_approve', { gate: 'H1' });
  write(
    root,
    directory + 'design.md',
    `# Design\n\n## 目标与非目标\n新增 Note 资源，参照 template-context.md；不扩展文件。\n## 任务图\nT-001 单任务。\n## AC 到用例\nAC-101 -> TC-101 backend; AC-102 -> TC-102 frontend。\n## 风险\n鉴权遗漏、事务部分提交、模板漂移，由完整回归和走查阻断。\n`,
  );
  write(
    root,
    directory + 'tasks.md',
    '<!-- sg:task {"id":"T-001","title":"Add Note API and Vue reference feature","ac":["AC-101","AC-102"],"deps":[],"parallel":false} -->\n- [ ] Implement and verify Notes\n',
  );
  write(
    root,
    directory + 'tests/cases.md',
    '| 用例 | AC | 层次 | 描述 |\n|---|---|---|---|\n| TC-101 | AC-101 | api | Note CRUD/pagination/batch/permissions |\n| TC-102 | AC-102 | ui | Note typed client and forms |\n',
  );
  write(
    root,
    directory + 'tests/mapping.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        change,
        requirements: [
          {
            ac: 'AC-101',
            covers: ['REQ-101'],
            tasks: ['T-001'],
            cases: ['TC-101'],
            suite: 'backend',
          },
          {
            ac: 'AC-102',
            covers: ['REQ-101'],
            tasks: ['T-001'],
            cases: ['TC-102'],
            suite: 'frontend',
          },
        ],
        automation: [],
      },
      null,
      2,
    ),
  );
  write(
    root,
    directory + 'tests/touched.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        modify: ['docs/api.md', 'frontend/test/App.test.ts'],
        delete: [],
        bootstrap: [backendTest, frontendTest],
      },
      null,
      2,
    ),
  );
  await call('sg_run');
  await call('sg_approve', { gate: 'H2' });
}

for (let step = 0; step < 10 && load(root).state.phase !== 'DONE'; step += 1) {
  const phase = load(root).state.phase;
  if (phase === 'EXECUTING' || phase === 'INTEGRATING' || phase === 'ARCHIVING') {
    await call('sg_run');
  } else if (phase === 'BLOCKED') {
    await call('sg_run', { retry: true });
  } else if (phase === 'H3_PENDING') {
    await call('sg_approve', { gate: 'H3' });
  } else {
    throw new Error('Cannot resume acceptance from phase ' + phase);
  }
}
assert.equal(load(root).state.phase, 'DONE');
const summary = {
  ok: true,
  root,
  phase: 'DONE',
  roleAdapter: 'deterministic; actual Maven/Vitest/HTTP checks, no model claim',
  verification: {
    full: true,
    phase: load(root).state?.initialization?.phase || null,
    report: load(root).state?.initialization?.verification?.report || null,
  },
  roles: records,
  finalSourceHash: projectSourceHash(root),
  at: new Date().toISOString(),
};
const acceptanceFile = path.join(fixturesRoot, path.basename(root) + '.acceptance.json');
fs.writeFileSync(acceptanceFile, JSON.stringify(summary, null, 2) + '\n');
console.log('ACCEPTANCE ' + acceptanceFile);
