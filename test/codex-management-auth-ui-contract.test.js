import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src/codex/management/public');

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

test('management UI discovers account and pairing modes before opening a session', () => {
  const html = read('index.html');
  const app = read('app.js');

  assert.match(app, /\/api\/auth\/methods/);
  assert.match(app, /state\.authMode\s*=\s*body\.mode/);
  assert.match(app, /body\.mode\s*===\s*'account'/);
  assert.match(html, /id="account-login-form"/);
  assert.match(html, /id="pairing-form"/);
  assert.match(html, /id="login-username"/);
  assert.match(html, /id="login-password"/);
  assert.match(html, /id="login-totp"/);
  assert.match(html, /id="login-device-name"/);
  assert.match(html, /id="login-device-confirmation"/);
});

test('account login sends an opaque persistent device identity and new-device confirmation', () => {
  const app = read('app.js');

  assert.match(app, /specgate\.auth\.deviceId/);
  assert.match(app, /randomUUID\(\)/);
  assert.match(app, /localStorage\.setItem\(DEVICE_ID_STORAGE_KEY, deviceId\)/);
  assert.match(app, /deviceId,/);
  assert.match(app, /deviceName:/);
  assert.match(app, /deviceConfirmationCode:/);
  assert.match(app, /\/api\/auth\/login/);
  assert.match(app, /state\.csrfToken\s*=\s*body\.csrfToken/);
});

test('attention nonces are redeemed after login and never create or persist a session', () => {
  const app = read('app.js');

  assert.match(app, /hash\.get\('attention'\)/);
  assert.match(app, /hash\.get\('nonce'\)/);
  assert.match(app, /history\.replaceState/);
  assert.match(app, /\/api\/auth\/attention\/redeem/);
  assert.match(app, /\{\s*nonce\s*\}/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*nonce/i);
  assert.doesNotMatch(app, /document\.cookie[\s\S]{0,120}nonce/i);
  assert.doesNotMatch(app, /openPairingSession\(\s*(?:state\.)?deepLink\.nonce\s*\)/);
});

test('high-risk account mutations exchange TOTP for a one-time step-up proof', () => {
  const app = read('app.js');
  const html = read('index.html');

  assert.match(app, /\/api\/auth\/step-up\/challenge/);
  assert.match(app, /\/api\/auth\/step-up\/verify/);
  assert.match(app, /body:\s*\{\s*action:\s*stepUpAction,\s*resourceId\s*\}/);
  assert.match(app, /challengeId/);
  assert.match(app, /totpCode/);
  assert.match(app, /payload\.stepUpProof\s*=\s*proof/);
  assert.match(app, /state\.authMode\s*===\s*'pairing'[\s\S]{0,180}stepUpCode/);
  assert.doesNotMatch(app, /state\.authMode\s*===\s*'account'[\s\S]{0,180}stepUpCode/);
  assert.match(app, /delete payload\.stepUpProof/);
  assert.match(app, /finally\s*\{[\s\S]{0,160}stepUpCode\.value\s*=\s*''/);
  assert.match(app, /STEP_UP_REQUIRED/);
  assert.match(app, /CHALLENGE_EXPIRED/);
  assert.match(app, /reopenActionDialog/);
  assert.match(html, /id="step-up-code"/);
  assert.match(html, /id="action-error"/);
});

test('authenticated security view lists devices and provides proof-based revoke and logout', () => {
  const html = read('index.html');
  const app = read('app.js');

  assert.match(html, /data-view="security"/);
  assert.match(html, /id="view-security"/);
  assert.match(html, /id="device-list"/);
  assert.match(html, /id="logout"/);
  assert.match(app, /\/api\/auth\/devices/);
  assert.match(app, /\/api\/auth\/devices\/revoke/);
  assert.match(app, /\/api\/auth\/logout/);
  assert.match(app, /当前设备/);
  assert.match(app, /stepUpProof/);
  assert.match(app, /stepUpAction:\s*'device\.revoke'/);
  assert.match(app, /body:\s*\{\s*deviceId\s*\}/);
});
