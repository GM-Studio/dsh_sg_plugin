import fs from 'node:fs';
import path from 'node:path';
import { validFileRule } from './task-policy.js';

// A command must produce a new report on this invocation. Never remove frozen
// inputs or historical evidence to make an output path reusable.
export function prepareFreshReport(root, relative) {
  const reject = () => {
    throw Object.assign(
      new Error('Report output must be an ordinary transient JSON report inside .specgate'),
      { code: 'UNSAFE_REPORT_PATH' },
    );
  };
  if (
    !validFileRule(relative) ||
    relative.includes('*') ||
    !relative.startsWith('.specgate/') ||
    relative.startsWith('.specgate/codex/changes/') ||
    !/(?:report|result)[^/]*\.json$/i.test(path.basename(relative))
  )
    reject();
  let current = root;
  const parts = relative.split('/');
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) reject();
  }
  const target = path.join(root, relative);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) reject();
    fs.unlinkSync(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
