import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStepUpAuthority,
  currentTotp,
  decodeBase32,
  encodeBase32,
  generateTotpSecret,
} from '../src/codex/control/step-up.js';

test('base32 and TOTP produce deterministic valid codes', () => {
  const secret = encodeBase32(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(decodeBase32(secret).toString(), '12345678901234567890');
  const code = currentTotp(secret, { clock: () => 59000 });
  assert.equal(code, '287082');
});

test('step-up verification accepts a bounded clock window only', () => {
  const secret = generateTotpSecret();
  const at = 1_700_000_000_000;
  const authority = createStepUpAuthority({ secret, clock: () => at, window: 1 });
  assert.equal(authority.verify(currentTotp(secret, { clock: () => at })), 'step-up');
  assert.equal(authority.verify('000000'), null);
  assert.equal(authority.verify('not-a-code'), null);
  assert.equal(authority.verify(currentTotp(secret, { clock: () => at + 120000 })), null);
});
