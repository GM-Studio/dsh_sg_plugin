import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(value) {
  if (typeof value !== 'string' || /[^A-Z2-7=\s]/i.test(value))
    throw new TypeError('Invalid base32 secret');
  const normalized = value.toUpperCase().replace(/[=\s]/g, '');
  let bits = 0;
  let current = 0;
  const output = [];
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new TypeError('Invalid base32 secret');
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(bytes = 20) {
  if (!Number.isSafeInteger(bytes) || bytes < 10 || bytes > 64)
    throw new TypeError('TOTP secret size is invalid');
  return encodeBase32(randomBytes(bytes));
}

function hotp(secret, counter, digits = 6) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

export function currentTotp(secret, { clock = Date.now, stepSeconds = 30, digits = 6 } = {}) {
  return hotp(secret, Math.floor(clock() / 1000 / stepSeconds), digits);
}

export function verifyTotp(
  secret,
  code,
  { clock = Date.now, stepSeconds = 30, digits = 6, window = 1 } = {},
) {
  if (typeof code !== 'string' || !new RegExp(`^\\d{${digits}}$`).test(code)) return false;
  if (typeof secret !== 'string' || !secret) return false;
  const counter = Math.floor(clock() / 1000 / stepSeconds);
  for (let offset = -window; offset <= window; offset += 1) {
    let expected;
    try {
      expected = hotp(secret, counter + offset, digits);
    } catch {
      return false;
    }
    const left = Buffer.from(expected);
    const right = Buffer.from(code);
    if (left.length === right.length && timingSafeEqual(left, right)) return true;
  }
  return false;
}

export function createStepUpAuthority({
  secret,
  clock = Date.now,
  window = 1,
  stepSeconds = 30,
} = {}) {
  if (typeof secret !== 'string' || !secret)
    throw new TypeError('A configured MFA secret is required');
  decodeBase32(secret);
  return Object.freeze({
    available: true,
    verify(code) {
      return verifyTotp(secret, code, { clock, window, stepSeconds }) ? 'step-up' : null;
    },
  });
}
