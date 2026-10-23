import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyAdoptedProject } from '../src/codex/adopted-verification.js';
import { loadProjectReadiness } from '../src/codex/project-state.js';
import { createTemporaryDirectory } from '../src/codex/core/temp.js';

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
    const temporary = createTemporaryDirectory('specgate-adopted-pilot-');
    const temporaryRoot = temporary.path;
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
      try {
        temporary.cleanup();
      } catch (error) {
        process.stderr.write(`[specgate] pilot workspace cleanup failed: ${error.message}\n`);
      }
      git(readiness.profile.root, ['worktree', 'prune']);
    }
  }
}
