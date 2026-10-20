import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeV4Result } from '../../src/v4/init.js';
import { recheckQuality } from '../../src/v4/build.js';

test('unverified scaffold is not described as completed initialization', () => {
  const text = summarizeV4Result({
    ok: true,
    complete: false,
    selection: { sides: [] },
    gaps: [{ tool: 'jdk', version: '8' }],
  });
  assert.match(text, /初始化未完成/);
  assert.match(text, /\/sg-env install/);
});

test('verification failure preserves partial work and never claims zero writes', () => {
  const text = summarizeV4Result({
    ok: false,
    changed: true,
    code: 'VERIFICATION_FAILED',
    message: 'build failed',
  });
  assert.match(text, /已有变更保留/);
  assert.doesNotMatch(text, /未变更项目/);
});

test('quality rerun does not imply a running end-to-end application', () => {
  const text = summarizeV4Result({ ok: true, requality: [{ side: 'api', status: 'passed' }] });
  assert.match(text, /质量补跑完成/);
  assert.match(text, /不等于运行闭环/);
});

test('missing report is a safe recheck failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-recheck-'));
  const result = await recheckQuality({ root, side: { id: 'api', stack: 'java' } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'REPORT_MISSING');
});
