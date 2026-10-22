import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewInit, executeInit } from '../src/codex/init.js';
import { verifyProject, validateVerificationEvidence } from '../src/codex/verify.js';
import {
  GOLDEN_MANIFEST,
  JAVA_PRESETS,
  platformVerificationRecord,
} from '../src/codex/core/java/java-versions.js';

// Generates only isolated acceptance fixtures. It never initializes the plugin
// repository, modifies a user project, downloads SDKs or updates Golden hashes.
// Unexecuted checks are recorded, never claimed: one invocation records exactly
// one platform (`--platform`, defaulting to `process.platform`) under
// `platforms[<platform>]` and leaves every other required platform as `not-run`,
// and unexecuted verification stages stay `not-run`.
export async function verifyMatrix({ output, concurrency = 2, platform = process.platform } = {}) {
  const requiredPlatforms = GOLDEN_MANIFEST.requiredPlatforms || [];
  if (!requiredPlatforms.includes(platform))
    throw new Error(
      'Unsupported matrix platform: ' +
        platform +
        '; expected one of ' +
        requiredPlatforms.join('|'),
    );
  const directory = path.resolve(output);
  if (fs.existsSync(directory) && fs.readdirSync(directory).length > 0)
    throw new Error(
      'Evidence already exists; choose a new output directory to retain previous runs',
    );
  fs.mkdirSync(directory, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-acceptance-'));
  const report = {
    scope: 'codex-java-vue-dual-platform-matrix',
    startedAt: new Date().toISOString(),
    platform,
    arch: process.arch,
    node: process.version,
    workspace,
    concurrency,
    sdkDownloads: false,
    goldenUpdated: false,
    // Honesty marker: this invocation vouches only for its own platform. The
    // Linux platform stays `not-run` unless `--platform linux` actually runs it.
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
      let validation = null;
      let result = null;
      try {
        const preview = previewInit({
          root: entry.root,
          preset: entry.preset,
          company: 'specgate',
          business: 'tasks',
        });
        fs.writeFileSync(
          path.join(evidenceDirectory, 'preview.json'),
          JSON.stringify(preview, null, 2) + '\n',
        );
        if (!preview.ok) throw new Error(preview.code + ': ' + preview.message);
        const generated = await executeInit({
          root: entry.root,
          preset: entry.preset,
          company: 'specgate',
          business: 'tasks',
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
        result = await verifyProject(
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
        validation = validateVerificationEvidence({ root: entry.root });
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
      // Persist the platform-scoped record through the shared helper so the
      // matrix JSON and any later manifest update use one shape. A `passed`
      // entry carries the real validation evidence (runId + sourceHash); the
      // helper refuses to fabricate it.
      try {
        const update = platformVerificationRecord(entry.preset, {
          platform,
          result: entry.status,
          verifiedAt: entry.endedAt,
          evidence:
            entry.status === 'passed'
              ? validation
              : result?.report
                ? {
                    ok: false,
                    code: result.code,
                    status: result.report.status,
                    failedStage: result.report.failedStage || null,
                  }
                : null,
        });
        entry.platforms = { [update.platform]: update.record };
      } catch (error) {
        entry.status = 'failed';
        entry.reason = 'golden record refused: ' + error.message;
        entry.platforms = { [platform]: { result: 'failed', verifiedAt: null, evidence: null } };
      }
      save();
      process.stdout.write(
        JSON.stringify({
          preset: entry.preset,
          platform,
          status: entry.status,
          code: entry.code,
          reason: entry.reason,
        }) + '\n',
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, Math.max(1, concurrency)) }, run));
  report.endedAt = new Date().toISOString();
  const allPassed = report.presets.every((entry) => entry.status === 'passed');
  report.status = platform === 'win32' && allPassed ? 'passed' : 'incomplete';
  // `linux` stays `not-run` unconditionally: a single invocation only ever
  // vouches for its own `platform`, so this run never claims Linux acceptance.
  // Per-platform truth lives in `platform` and `presets[].platforms[<platform>]`.
  save();
  return report;
}

function parseArgs(args) {
  let output = null;
  let platform = process.platform;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--output') {
      output = args[index + 1];
      index += 1;
    } else if (arg === '--platform') {
      platform = args[index + 1];
      index += 1;
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  if (!output)
    throw new Error(
      'Usage: node scripts/verify-codex-matrix.mjs --output <evidence-directory> [--platform win32|linux]',
    );
  return { output, platform };
}

async function main() {
  const { output, platform } = parseArgs(process.argv.slice(2));
  const result = await verifyMatrix({ output, platform });
  process.stdout.write(
    JSON.stringify({
      status: result.status,
      platform: result.platform,
      evidence: path.resolve(output),
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
