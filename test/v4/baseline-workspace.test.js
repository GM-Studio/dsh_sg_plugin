import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initProject, patchConfigRequirements } from '../../src/v3/change.js';
import { patchState, load } from '../../src/v3/state.js';
import {
  establishInitialBaseline,
  loadBaselineState,
  checkChangeBaseline,
} from '../../src/v3/baseline.js';
import { workspaceYaml, resolveSelection } from '../../src/v4/workspace.js';
import { startWorkspaceChange, finalizeWorkspaceChange } from '../../src/v4/workspace-change.js';
import { completeWorkspaceChange, driveWorkspace } from '../../src/v4/drive.js';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ws-baseline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initProject(root);
  const selection = resolveSelection({ preset: 'node-fullstack' });
  fs.writeFileSync(path.join(root, '.specgate', 'workspace.yaml'), workspaceYaml(selection));
  const state = load(root).state;
  state.workflowVersion = 4;
  fs.writeFileSync(path.join(root, '.specgate', 'state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(root, 'openspec', 'REQ.md'), '# Current req\n### REQ-001 CRUD\n');
  for (const side of selection.sides) {
    initProject(path.join(root, side.path));
    patchConfigRequirements(path.join(root, side.path), { enabled: true });
  }
  assert.equal(
    establishInitialBaseline(root, { content: '# Current req\n### REQ-001 CRUD\n' }).ok,
    true,
  );
  return root;
}
test('workspace starts on root current req without side history and blocks second active change', (t) => {
  const root = fixture(t);
  assert.equal(startWorkspaceChange({ root, name: 'add-field' }).ok, true);
  const side = load(path.join(root, 'api')).state;
  assert.equal(side.projectReqRoot, root);
  assert.equal(checkChangeBaseline(path.join(root, 'api'), side).ok, true);
  assert.equal(startWorkspaceChange({ root, name: 'other' }).code, 'CHANGE_ACTIVE');
  assert.equal(finalizeWorkspaceChange({ root }).code, 'REQ_COMPLETION_CONFIRM_REQUIRED');
});
test('workspace resume stops when effective req was edited', async (t) => {
  const root = fixture(t);
  startWorkspaceChange({ root, name: 'add-field' });
  fs.appendFileSync(path.join(root, 'openspec', 'REQ.md'), 'user edit');
  assert.equal((await driveWorkspace({ root })).code, 'REQ_BASELINE_DRIFT');
});
test('workspace requires completed side acceptance and host completion then publishes only approved req', async (t) => {
  const root = fixture(t);
  startWorkspaceChange({ root, name: 'add-field' });
  fs.writeFileSync(
    path.join(root, 'openspec', 'changes', 'add-field', 'req-next.md'),
    '# Current req\n### REQ-001 CRUD with field\n',
  );
  const userQuestions = {
    ask: async ({ questions }) => {
      assert.match(questions[0].question, /原有效 req/);
      assert.match(questions[0].question, /真实验证结果/);
      return { answers: [{ selected: ['确认完成并更新基线'] }] };
    },
  };
  assert.equal(
    (await completeWorkspaceChange({ root, sessionId: 's', userQuestions })).code,
    'REQ_ACCEPTANCE_INCOMPLETE',
  );
  for (const side of ['api', 'web'])
    patchState(path.join(root, side), (draft) => {
      draft.phase = 'DONE';
      draft.acceptanceHash = 'sha256:accepted';
    });
  const declined = { ask: async () => ({ answers: [{ selected: ['取消'] }] }) };
  assert.equal(
    (await completeWorkspaceChange({ root, sessionId: 's', userQuestions: declined })).code,
    'DECLINED',
  );
  assert.equal(loadBaselineState(root).state.projectReq.version, 'v1.0');
  assert.equal((await completeWorkspaceChange({ root, sessionId: 's', userQuestions })).ok, true);
  assert.equal(loadBaselineState(root).state.projectReq.version, 'v1.1');
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
});
