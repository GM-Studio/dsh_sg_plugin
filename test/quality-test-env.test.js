import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedTestEnvironment } from '../scripts/quality-test-env.mjs';

test('hook test environment strips repository-local variables without mutating parent', () => {
  const parent = {
    PATH: 'tools',
    GIT_DIR: 'source',
    git_index_file: 'index',
    GIT_CONFIG_PARAMETERS: 'hooks',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: 'unrelated-hooks',
  };
  const result = isolatedTestEnvironment(parent, [
    'GIT_DIR',
    'GIT_INDEX_FILE',
    'GIT_CONFIG_PARAMETERS',
  ]);
  assert.deepEqual(result, { PATH: 'tools', GIT_TERMINAL_PROMPT: '0' });
  assert.equal(parent.GIT_DIR, 'source');
  assert.equal(parent.git_index_file, 'index');
});
