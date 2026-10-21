import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadTemplateStyle } from './template-style.js';
import { verifyJavaProject } from '../v4/java-verify.js';
import { patchState } from './state.js';

/** Full final-source gate supplements task AC suites; legacy projects keep their current flow. */
export async function verifyTemplateProject({ root, worktree, change, task }) {
  const required = fs.existsSync(path.join(root, '.specgate/template-style.json'));
  const style = loadTemplateStyle(worktree, { required });
  if (!style.ok) return style;
  if (style.skipped) return { ok: true, skipped: true };
  const result = await verifyJavaProject({
    root: worktree,
    install: false,
    full: task?.id === 'INTEGRATION',
  });
  const directory = path.join(root, '.specgate/runs');
  fs.mkdirSync(directory, { recursive: true });
  const label = [change, task?.id || 'INTEGRATION'].join('-').replace(/[^a-zA-Z0-9_-]/g, '_');
  fs.writeFileSync(
    path.join(directory, 'quality-' + label + '.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        worktree,
        templateStyle: { version: style.version, manifestHash: style.manifestHash },
        ...result,
      },
      null,
      2,
    ) + '\n',
  );
  if (result.ok) {
    const phase = task?.id === 'INTEGRATION' ? 'VERIFIED' : 'SMOKE_PASSED';
    const verifiedReport = JSON.parse(
      fs.readFileSync(path.join(worktree, '.specgate/init-report.json'), 'utf8'),
    );
    const rootReportFile = path.join(root, '.specgate/init-report.json');
    const rootReport = fs.existsSync(rootReportFile)
      ? JSON.parse(fs.readFileSync(rootReportFile, 'utf8'))
      : {};
    fs.writeFileSync(
      rootReportFile,
      JSON.stringify(
        {
          ...rootReport,
          phase,
          initializationComplete: true,
          verification: verifiedReport.verification,
          execution: verifiedReport.execution,
        },
        null,
        2,
      ) + '\n',
    );
    patchState(root, (draft) => {
      draft.initialization = {
        ...(draft.initialization || {}),
        phase,
        initializationComplete: true,
        verification: verifiedReport.verification,
      };
    });
    try {
      execFileSync(
        'git',
        ['checkout', '--', '.specgate/init-report.json', '.specgate/state.json'],
        {
          cwd: worktree,
          stdio: 'ignore',
        },
      );
    } catch {
      // The task worktree may not have tracked metadata files in older projects.
    }
  }
  return result;
}
