import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyAdoptedProject } from '../src/codex/adopted-verification.js';
import { loadProjectReadiness } from '../src/codex/project-state.js';

function git(root, args) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

const projectRoot = process.argv[2];
if (!projectRoot || !path.isAbsolute(projectRoot)) {
  process.stderr.write(
    'Usage: node scripts/verify-adopted-pilot.mjs <absolute-adopted-project-root>\n',
  );
  process.exitCode = 1;
} else {
  const readiness = loadProjectReadiness({ projectRoot });
  if (!readiness.ok || readiness.profile.mode !== 'adopted') {
    process.stderr.write(
      JSON.stringify({
        ok: false,
        code: readiness.code || 'ADOPTED_PROFILE_REQUIRED',
        message: readiness.message || 'Project is not an adopted ready project',
      }) + '\n',
    );
    process.exitCode = 1;
  } else {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-adopted-pilot-'));
    const worktree = path.join(temporaryRoot, 'worktree');
    let added = false;
    try {
      const create = git(readiness.profile.root, [
        'worktree',
        'add',
        '--detach',
        '--force',
        worktree,
        'HEAD',
      ]);
      if (create.status !== 0)
        throw Object.assign(new Error(create.stderr || 'Cannot create verification worktree'), {
          code: 'WORKTREE_FAILED',
        });
      added = true;
      const head = git(worktree, ['rev-parse', 'HEAD']);
      if (head.status !== 0)
        throw Object.assign(new Error(head.stderr || 'Cannot read worktree commit'), {
          code: 'COMMIT_REQUIRED',
        });
      const result = await verifyAdoptedProject({
        profile: readiness.profile,
        baseline: readiness.baseline,
        worktree,
        commit: head.stdout.trim(),
      });
      process.stdout.write(
        JSON.stringify(
          {
            ok: result.ok,
            code: result.code || null,
            report: result.report || null,
            newFailures: result.newFailures || [],
          },
          null,
          2,
        ) + '\n',
      );
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      process.stderr.write(
        JSON.stringify({
          ok: false,
          code: error.code || 'ADOPTED_PILOT_FAILED',
          message: error.message,
        }) + '\n',
      );
      process.exitCode = 1;
    } finally {
      if (added) git(readiness.profile.root, ['worktree', 'remove', '--force', worktree]);
      else fs.rmSync(temporaryRoot, { recursive: true, force: true });
      if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive: true, force: true });
      git(readiness.profile.root, ['worktree', 'prune']);
    }
  }
}
