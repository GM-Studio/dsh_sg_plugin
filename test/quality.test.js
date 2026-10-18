import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initProject } from '../src/init.js';
import { isQualityBlocked, recordQualityResult, stageAttempts } from '../src/quality.js';

test('a stage blocks after two failures and a pass resets it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-quality-state-'));
  initProject(root, { requirements: true, git: false });

  recordQualityResult(root, 'format', false, 'first');
  assert.equal(isQualityBlocked(root), false);
  assert.equal(stageAttempts(root, 'format'), 1);

  recordQualityResult(root, 'format', false, 'second');
  assert.equal(isQualityBlocked(root), true);
  assert.equal(stageAttempts(root, 'format'), 2);

  recordQualityResult(root, 'format', true, 'fixed');
  assert.equal(isQualityBlocked(root), false);
  assert.equal(stageAttempts(root, 'format'), 0);
});
