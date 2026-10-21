#!/usr/bin/env node
// Hooks inspect Git blobs; formatting never runs inside a hook.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { changedFiles, exportSnapshot } from './quality-snapshot.mjs';
import { runChecks } from './quality-checks.mjs';
import { isolatedTestEnvironment } from './quality-test-env.mjs';
function git(root, args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', ...options }).trim();
}
export async function inspectSnapshot({ root, ref, base, stage, execute }) {
  const files = changedFiles(root, ref, base);
  const fingerprint = git(
    root,
    ref === 'index' ? ['ls-files', '--stage', '-z'] : ['rev-parse', ref],
  );
  if (!files.length) {
    console.log('[quality-gate] No changes.');
    return;
  }
  const directory = path.join(root, '.specgate', 'hooks-runs', randomUUID().slice(0, 8));
  fs.mkdirSync(directory, { recursive: true });
  let success = false;
  const env = isolatedTestEnvironment(
    process.env,
    git(root, ['rev-parse', '--local-env-vars']).split(/\r?\n/),
  );
  env.SG_QUALITY_REPOSITORY = root;
  env.SG_QUALITY_LOG_ROOT = directory;
  env.npm_config_cache = path.join(root, '.specgate', 'npm-cache');
  env.GIT_CEILING_DIRECTORIES = path.dirname(directory);
  try {
    const tracked = exportSnapshot(root, ref, directory);
    const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'));
    const installed = JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules', '.package-lock.json'), 'utf8'),
    );
    for (const [name, pkg] of Object.entries(lock.packages || {})) {
      if (
        name &&
        !pkg.optional &&
        (installed.packages?.[name]?.version !== pkg.version ||
          (pkg.integrity && installed.packages?.[name]?.integrity !== pkg.integrity))
      )
        throw new Error('Dependencies differ from snapshot lock: ' + name + '. Run npm ci first.');
    }
    fs.symlinkSync(
      path.join(root, 'node_modules'),
      path.join(directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    console.log('[quality-gate] ' + stage + ' snapshot: ' + directory);
    const report = { stage, ref, base, files, status: 'running' };
    fs.writeFileSync(path.join(directory, 'quality-report.json'), JSON.stringify(report, null, 2));
    const bytes = new Map(
      tracked.map((name) => [name, fs.readFileSync(path.join(directory, name))]),
    );
    await runChecks({ root: directory, files, stage, env, execute });
    for (const [name, initial] of bytes)
      if (!initial.equals(fs.readFileSync(path.join(directory, name))))
        throw new Error('Checked snapshot changed: ' + name);
    const compare = fs.mkdtempSync(path.join(root, '.specgate', 'hooks-runs', 'compare-'));
    try {
      const finalFingerprint = git(
        root,
        ref === 'index' ? ['ls-files', '--stage', '-z'] : ['rev-parse', ref],
      );
      if (fingerprint !== finalFingerprint) throw new Error('Git snapshot changed during checks');
      const finalTracked = exportSnapshot(root, ref, compare);
      if (JSON.stringify(tracked) !== JSON.stringify(finalTracked))
        throw new Error('Git snapshot file list changed during checks');
      for (const [name, initial] of bytes)
        if (!initial.equals(fs.readFileSync(path.join(compare, name))))
          throw new Error('Git snapshot changed during checks: ' + name);
    } finally {
      fs.rmSync(compare, { recursive: true, force: true });
    }
    report.status = 'passed';
    // Keep command/runtime evidence, not only a boolean after removing the large fixture.
    const evidence = directory + '-evidence';
    fs.mkdirSync(evidence, { recursive: true });
    const logs = path.join(directory, '.specgate', 'quality-logs');
    if (fs.existsSync(logs)) fs.cpSync(logs, path.join(evidence, 'commands'), { recursive: true });
    const collect = (from, relative = '') => {
      if (!fs.existsSync(from)) return;
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (['node_modules', 'target', 'dist', 'coverage', '.git'].includes(entry.name)) continue;
        const name = path.join(relative, entry.name);
        const file = path.join(from, entry.name);
        if (entry.isDirectory() && entry.name === 'verify-runs')
          fs.cpSync(file, path.join(evidence, name), { recursive: true });
        else if (entry.isDirectory()) collect(file, name);
        else if (['results.json', 'verify-report.json', 'commands.jsonl'].includes(entry.name)) {
          const to = path.join(evidence, name);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(file, to);
        }
      }
    };
    collect(path.join(directory, '.specgate'));
    report.evidence = evidence;
    fs.writeFileSync(path.join(directory, 'quality-report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(
      directory + '-summary.json',
      JSON.stringify({ ...report, checkedAt: new Date().toISOString(), fingerprint }, null, 2),
    );
    success = true;
  } catch (error) {
    fs.writeFileSync(path.join(directory, 'quality-failure.txt'), error.stack || error.message);
    throw new Error(error.message + '\nEvidence: ' + directory, { cause: error });
  } finally {
    const link = path.join(directory, 'node_modules');
    if (fs.existsSync(link)) {
      if (process.platform === 'win32') fs.rmdirSync(link);
      else fs.unlinkSync(link);
    }
    if (success) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}
async function main() {
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const args = process.argv.slice(2);
  if (args.some((arg) => !/^--(stage=(commit|push|ci)|base=.+|check)$/.test(arg)))
    throw new Error('Hooks are check-only. Use npm run gate:fix for explicit formatting.');
  const stage = args.find((arg) => arg.startsWith('--stage='))?.slice(8) || 'commit';
  const baseArg = args.find((arg) => arg.startsWith('--base='))?.slice(7);
  if (stage === 'commit') return inspectSnapshot({ root, ref: 'index', stage });
  const input = stage === 'push' && !process.stdin.isTTY ? fs.readFileSync(0, 'utf8').trim() : '';
  const targets = input ? input.split(/\r?\n/).map((line) => line.split(/\s+/)) : [];
  if (targets.length) {
    for (const [, ref, , remote] of targets) {
      if (/^0+$/.test(ref)) continue;
      if (!/^[a-f0-9]{40,64}$/.test(ref) || !/^[a-f0-9]{40,64}$/.test(remote))
        throw new Error('Invalid pre-push input');
      await inspectSnapshot({ root, ref, base: /^0+$/.test(remote) ? null : remote, stage });
    }
  } else {
    const base = baseArg
      ? /^0+$/.test(baseArg)
        ? null
        : baseArg
      : git(root, ['rev-parse', '@{upstream}']);
    await inspectSnapshot({ root, ref: 'HEAD', base, stage });
  }
  console.log('[quality-gate] All required checks passed.');
}
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[quality-gate] BLOCKED: ' + error.message);
    process.exitCode = 1;
  });
}
