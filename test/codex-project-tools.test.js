import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_TOOLS, callProjectTool } from '../src/codex/project-tools.js';
import { loadProjectReadiness } from '../src/codex/project-state.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-project-tools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function existing(t) {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'pom.xml'), '<project/>\n');
  fs.writeFileSync(
    path.join(root, 'frontend', 'package.json'),
    JSON.stringify({ scripts: { build: 'vite build', test: 'vitest run' } }),
  );
  git(root, ['init', '-q']);
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@local',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'baseline',
  ]);
  return root;
}

test('project tools expose only bounded project operations and read-only previews', () => {
  assert.deepEqual(PROJECT_TOOLS.map((tool) => tool.name).sort(), [
    'sg_adopt_apply',
    'sg_adopt_commit_dirty',
    'sg_adopt_preview',
    'sg_project_finalize_new',
    'sg_project_status',
  ]);
  for (const tool of PROJECT_TOOLS) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(Object.hasOwn(tool.inputSchema.properties, 'approved'), false, tool.name);
  }
  assert.equal(
    PROJECT_TOOLS.find((tool) => tool.name === 'sg_adopt_preview').annotations.readOnlyHint,
    true,
  );
  assert.equal(
    PROJECT_TOOLS.find((tool) => tool.name === 'sg_project_status').annotations.readOnlyHint,
    true,
  );
});

test('adoption preview, baseline apply and project status use server-owned runner results', async (t) => {
  const projectRoot = existing(t);
  let releaseRunner;
  const runnerGate = new Promise((resolve) => {
    releaseRunner = resolve;
  });
  const services = {
    projectRoot,
    baselineRunner: async ({ command }) => {
      await runnerGate;
      return {
        commandId: command.id,
        status: 'passed',
        exitCode: 0,
        stdout: 'passed',
        stderr: '',
        durationMs: 1,
      };
    },
  };
  const initial = await callProjectTool(services, 'sg_project_status', {});
  assert.equal(initial.ok, true);
  assert.equal(initial.projectReady, false);
  const preview = await callProjectTool(services, 'sg_adopt_preview', {});
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const startedAt = Date.now();
  const applied = await callProjectTool(services, 'sg_adopt_apply', {
    previewHash: preview.previewHash,
  });
  assert.ok(Date.now() - startedAt < 1000, 'adoption start must return without executing baseline');
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.status, 'running');
  assert.equal(applied.previewHash, preview.previewHash);
  const running = await callProjectTool(services, 'sg_project_status', {});
  assert.equal(running.projectReady, false);
  assert.equal(running.baselineRun.status, 'running');
  releaseRunner();
  let settled;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    settled = await callProjectTool(services, 'sg_project_status', {});
    if (settled.projectReady || settled.baselineRun?.status === 'failed') break;
  }
  assert.equal(settled.projectReady, true, JSON.stringify(settled));
  assert.equal(settled.baselineRun.status, 'completed');
  assert.equal(loadProjectReadiness({ projectRoot }).canStartChange, true);
  assert.equal(git(projectRoot, ['status', '--porcelain=v1', '--untracked-files=all']), '');
  assert.equal(
    fs.existsSync(
      path.join(
        projectRoot,
        '.specgate',
        'codex',
        'baseline-runs',
        settled.baselineRun.runId,
        'summary.json',
      ),
    ),
    true,
  );
  const ready = await callProjectTool(services, 'sg_project_status', {});
  assert.equal(ready.projectReady, true);
  assert.equal(ready.profile.mode, 'adopted');
});

test('failed background baseline remains observable and never creates readiness', async (t) => {
  const projectRoot = existing(t);
  const services = {
    projectRoot,
    baselineRunner: async () => {
      throw new Error('runner exploded');
    },
  };
  const preview = await callProjectTool(services, 'sg_adopt_preview', {});
  const started = await callProjectTool(services, 'sg_adopt_apply', {
    previewHash: preview.previewHash,
  });
  assert.equal(started.status, 'running');
  let status;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    status = await callProjectTool(services, 'sg_project_status', {});
    if (status.baselineRun?.status === 'failed') break;
  }
  assert.equal(status.projectReady, false);
  assert.equal(status.baselineRun.status, 'failed');
  assert.equal(status.baselineRun.code, 'BASELINE_RUN_FAILED');
  assert.equal(loadProjectReadiness({ projectRoot }).ok, false);
});

test('dirty adoption commit calls only the server-owned approval provider', async (t) => {
  const projectRoot = existing(t);
  fs.writeFileSync(
    path.join(projectRoot, 'backend', 'pom.xml'),
    '<project><name>x</name></project>\n',
  );
  let approvalInput;
  const services = {
    projectRoot,
    dirtyApprovalProvider: {
      requestApproval: async (input) => {
        approvalInput = input;
        return {
          ok: true,
          record: {
            decision: 'approve',
            artifactHash: input.artifactHash,
            paths: [...input.paths],
          },
        };
      },
    },
  };
  const preview = await callProjectTool(services, 'sg_adopt_preview', {});
  assert.equal(preview.needsBaselineCommit, true);
  const committed = await callProjectTool(services, 'sg_adopt_commit_dirty', {
    previewHash: preview.previewHash,
    paths: preview.dirty.files.map((entry) => entry.path),
    message: 'chore: adopt project',
  });
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.equal(approvalInput.artifactHash, preview.previewHash);
  assert.equal(git(projectRoot, ['status', '--porcelain=v1', '--untracked-files=all']), '');
});

test('unknown tools, extra credentials and unavailable providers fail closed', async (t) => {
  const projectRoot = existing(t);
  assert.equal((await callProjectTool({ projectRoot }, 'sg_unknown', {})).code, 'UNKNOWN_TOOL');
  assert.equal(
    (await callProjectTool({ projectRoot }, 'sg_adopt_preview', { approved: true })).code,
    'INVALID_ARGUMENT',
  );
  const preview = await callProjectTool({ projectRoot }, 'sg_adopt_preview', {});
  const noRunner = await callProjectTool(
    { projectRoot, baselineRunner: async () => assert.fail('must not run') },
    'sg_adopt_apply',
    { previewHash: preview.previewHash, approved: true },
  );
  assert.equal(noRunner.code, 'INVALID_ARGUMENT');
});
