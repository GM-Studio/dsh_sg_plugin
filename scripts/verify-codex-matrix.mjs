import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewInit, executeInit } from '../src/codex/init.js';
import { verifyProject, validateVerificationEvidence } from '../src/codex/verify.js';
import { JAVA_PRESETS } from '../src/codex/core/java/java-versions.js';

// Generates only isolated acceptance fixtures. It never initializes the plugin
// repository, modifies a user project, downloads SDKs or updates Golden hashes.
export async function verifyMatrix({ output, concurrency = 2 } = {}) {
  const directory = path.resolve(output);
  if (fs.existsSync(path.join(directory, 'matrix.json')))
    throw new Error(
      'Evidence already exists; choose a new output directory to retain previous runs',
    );
  fs.mkdirSync(directory, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-acceptance-'));
  const report = {
    scope: 'codex-java-vue-windows-matrix',
    startedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    workspace,
    concurrency,
    sdkDownloads: false,
    goldenUpdated: false,
    linux: 'not-run',
    presets: JAVA_PRESETS.map((preset) => ({ preset: preset.id, status: 'not-run' })),
  };
  const save = () =>
    fs.writeFileSync(path.join(directory, 'matrix.json'), JSON.stringify(report, null, 2) + '\n');
  save();
  let next = 0;
  async function run() {
    while (next < report.presets.length) {
      const entry = report.presets[next++];
      entry.root = path.join(workspace, entry.preset);
      entry.startedAt = new Date().toISOString();
      entry.status = 'generating';
      save();
      const evidenceDirectory = path.join(directory, entry.preset);
      fs.mkdirSync(evidenceDirectory);
      try {
        const preview = previewInit({ root: entry.root, preset: entry.preset });
        fs.writeFileSync(
          path.join(evidenceDirectory, 'preview.json'),
          JSON.stringify(preview, null, 2) + '\n',
        );
        if (!preview.ok) throw new Error(preview.code + ': ' + preview.message);
        const generated = await executeInit({
          root: entry.root,
          preset: entry.preset,
          previewHash: preview.previewHash,
        });
        fs.writeFileSync(
          path.join(evidenceDirectory, 'generation.json'),
          JSON.stringify(generated, null, 2) + '\n',
        );
        if (!generated.ok) throw new Error(generated.code + ': ' + generated.message);
        entry.status = 'verifying';
        save();
        const progressFile = path.join(evidenceDirectory, 'progress.txt');
        const result = await verifyProject(
          { root: entry.root, timeoutMs: 300000 },
          {
            onProgress: (event) => {
              fs.appendFileSync(
                progressFile,
                JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n',
              );
              process.stdout.write(JSON.stringify({ preset: entry.preset, ...event }) + '\n');
            },
          },
        );
        fs.writeFileSync(
          path.join(evidenceDirectory, 'verification.json'),
          JSON.stringify(result, null, 2) + '\n',
        );
        const validation = validateVerificationEvidence({ root: entry.root });
        fs.writeFileSync(
          path.join(evidenceDirectory, 'evidence-validation.json'),
          JSON.stringify(validation, null, 2) + '\n',
        );
        entry.status =
          result.ok && validation.ok
            ? 'passed'
            : result.report?.status === 'blocked'
              ? 'not-run'
              : 'failed';
        entry.code = result.code;
        entry.failedStage = result.report?.failedStage || null;
        entry.checks = result.report?.checks || [];
        entry.reason = result.ok ? validation.message || null : result.message;
        for (const [source, destination] of [
          ['.specgate/codex-verify-runs', 'codex-runs'],
          ['.specgate/verify-runs', 'legacy-runs'],
        ]) {
          const sourceDirectory = path.join(entry.root, source);
          if (fs.existsSync(sourceDirectory))
            fs.cpSync(sourceDirectory, path.join(evidenceDirectory, destination), {
              recursive: true,
            });
        }
      } catch (error) {
        entry.status = 'failed';
        entry.reason = error.message;
      }
      entry.endedAt = new Date().toISOString();
      save();
      process.stdout.write(
        JSON.stringify({
          preset: entry.preset,
          status: entry.status,
          code: entry.code,
          reason: entry.reason,
        }) + '\n',
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, Math.max(1, concurrency)) }, run));
  report.endedAt = new Date().toISOString();
  report.status =
    process.platform === 'win32' && report.presets.every((entry) => entry.status === 'passed')
      ? 'passed'
      : 'incomplete';
  save();
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output')
    throw new Error('Usage: node scripts/verify-codex-matrix.mjs --output <evidence-directory>');
  const result = await verifyMatrix({ output: args[1] });
  process.stdout.write(
    JSON.stringify({
      status: result.status,
      evidence: path.resolve(args[1]),
      workspace: result.workspace,
    }) + '\n',
  );
  if (result.status !== 'passed') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
