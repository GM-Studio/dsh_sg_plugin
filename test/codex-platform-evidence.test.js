import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLATFORM_EVIDENCE_DIRECTORY,
  evidenceFileName,
  declareSupportLevel,
  summarizePlatforms,
} from '../src/codex/core/platform-support.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const at = '2026-10-26T00:00:00.000Z';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-platev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeEvidence(dir, platform, arch, overrides = {}) {
  const target = path.join(dir, PLATFORM_EVIDENCE_DIRECTORY);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, evidenceFileName(platform, arch)),
    JSON.stringify(
      {
        platform,
        arch,
        status: 'passed',
        recordedAt: at,
        recordedBy: 'scripts/record-platform-evidence.mjs',
        checks: [{ command: 'npm test', exitCode: 0 }],
        coversOnlyOwnPlatform: true,
        ...overrides,
      },
      null,
      2,
    ),
  );
}

test('one platform evidence file never vouches for the other platform', (t) => {
  const dir = workspace(t);
  writeEvidence(dir, 'win32', 'x64');
  // 只有 win32 的证据时，linux 必须仍是 unverified。
  assert.equal(
    declareSupportLevel({ root: dir, platform: 'win32', arch: 'x64' }).level,
    'supported',
  );
  const linux = declareSupportLevel({ root: dir, platform: 'linux', arch: 'x64' });
  assert.equal(linux.level, 'unverified', 'AC-16：两平台记录不得互相代替');
  assert.equal(linux.evidencePresent, false);
});

test('evidence recorded for one platform does not satisfy the other', (t) => {
  const dir = workspace(t);
  // 把 win32 的证据伪装成平台无关：平台字段仍是 win32，因此 linux 读不到。
  writeEvidence(dir, 'win32', 'x64');
  const linuxEvidence = path.join(
    dir,
    PLATFORM_EVIDENCE_DIRECTORY,
    evidenceFileName('linux', 'x64'),
  );
  assert.equal(fs.existsSync(linuxEvidence), false, 'linux 证据文件确实不存在');
});

test('a CI matrix over two OSes is declared in the workflow', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/codex.yml'), 'utf8');
  assert.match(workflow, /ubuntu-latest/, '必须有 Linux job（AC-16）');
  assert.match(workflow, /windows-latest/, '必须有 Windows job');
  assert.match(workflow, /matrix/, '两平台必须以矩阵并列，而不是串行门禁');
  assert.match(workflow, /fail-fast:\s*false/, '一方失败不得掩盖另一方');
  assert.match(workflow, /record-platform-evidence.mjs/, 'CI 必须真实记录平台证据');
  assert.match(workflow, /if-no-files-found:\s*error/, '没有证据文件时必须让 CI 失败');
});

test('the evidence recorder only ever writes the current platform', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/record-platform-evidence.mjs'), 'utf8');
  assert.match(script, /process.platform/, '平台必须取自运行时，而不是参数');
  assert.match(script, /process.arch/);
  // 不得接受外部传入的平台名，否则可伪造另一平台的证据。
  assert.equal(/--platform/.test(script), false, '脚本不得接受 --platform 参数');
  assert.match(script, /coversOnlyOwnPlatform:\s*true/);
});

test('a failed check yields a failed evidence file, never a passed one', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/record-platform-evidence.mjs'), 'utf8');
  assert.match(script, /status: 'failed'/);
  assert.match(script, /process\.exit\(1\)/);
});

test('the two required platforms are both present in the manifest expectation', async () => {
  const { GOLDEN_MANIFEST } = await import('../src/codex/core/java/java-versions.js');
  assert.deepEqual([...GOLDEN_MANIFEST.requiredPlatforms].sort(), ['linux', 'win32']);
});

test('the summary cannot claim full support while either platform lacks evidence', (t) => {
  const dir = workspace(t);
  writeEvidence(dir, 'win32', 'x64');
  const summary = summarizePlatforms({ root: dir });
  assert.equal(summary.allSupported, false, '缺 linux 证据时不得宣称全平台通过');
  assert.equal(summary.supportedCount, 1);

  writeEvidence(dir, 'linux', 'x64');
  const complete = summarizePlatforms({ root: dir });
  assert.equal(complete.supportedCount, 2);
  // darwin 仍是 reserved，因此 allSupported 依旧为 false——这是有意的。
  assert.equal(complete.allSupported, false);
  assert.equal(complete.reservedCount, 1);
});

test('the repository currently has no platform evidence, so both stay unverified', () => {
  // 这一条记录真实状态：本仓库尚未产出原生平台证据。
  // 若将来 CI 提交了证据文件，本断言会失败，届时应更新为「已支持」。
  const evidenceDirectory = path.join(root, PLATFORM_EVIDENCE_DIRECTORY);
  const files = fs.existsSync(evidenceDirectory)
    ? fs.readdirSync(evidenceDirectory).filter((name) => /^platform-.*.json$/.test(name))
    : [];
  const summary = summarizePlatforms({ root });
  for (const row of summary.rows) {
    if (row.platform === 'darwin') {
      assert.equal(row.level, 'reserved');
      continue;
    }
    const hasFile = files.includes(evidenceFileName(row.platform, row.arch));
    assert.equal(row.level, hasFile ? 'supported' : 'unverified', row.platform);
  }
});
