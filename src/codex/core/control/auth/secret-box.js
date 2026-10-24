import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'sg-auth-v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function normalizeKey(key) {
  if (Buffer.isBuffer(key)) {
    if (key.length !== 32) throw new TypeError('Secret box requires a 32-byte key');
    return Buffer.from(key);
  }
  if (typeof key === 'string') {
    if (/^[a-f0-9]{64}$/i.test(key)) return Buffer.from(key, 'hex');
    try {
      const decoded = Buffer.from(key, 'base64url');
      if (decoded.length === 32 && decoded.toString('base64url') === key.replace(/=+$/, ''))
        return decoded;
    } catch {
      // Fall through to the bounded type error below.
    }
  }
  throw new TypeError('Secret box requires a 32-byte key');
}

function aad(context) {
  if (context === undefined || context === null) {
    return Buffer.from('specgate-auth-secret-box-v1\0');
  }
  if (typeof context !== 'string' || context.length > 512)
    throw new TypeError('Secret box context is invalid');
  return Buffer.from(`specgate-auth-secret-box-v1\0${context}`, 'utf8');
}

export function createSecretBox(key) {
  const normalizedKey = normalizeKey(key);
  return Object.freeze({
    seal(plaintext, context) {
      if (typeof plaintext !== 'string') throw new TypeError('Secret box plaintext is invalid');
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', normalizedKey, iv, {
        authTagLength: TAG_BYTES,
      });
      cipher.setAAD(aad(context));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [
        PREFIX,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.');
    },
    open(sealed, context) {
      if (typeof sealed !== 'string' || sealed.length > 64 * 1024)
        throw new TypeError('Sealed secret is invalid');
      const parts = sealed.split('.');
      if (parts.length !== 4 || parts[0] !== PREFIX || !parts[1] || !parts[2])
        throw new TypeError('Sealed secret is invalid');
      const iv = Buffer.from(parts[1], 'base64url');
      const tag = Buffer.from(parts[2], 'base64url');
      const ciphertext = Buffer.from(parts[3], 'base64url');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
        throw new TypeError('Sealed secret is invalid');
      const decipher = createDecipheriv('aes-256-gcm', normalizedKey, iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(aad(context));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
  });
}

export function sealSecret(key, plaintext, context) {
  return createSecretBox(key).seal(plaintext, context);
}

export function openSecret(key, sealed, context) {
  return createSecretBox(key).open(sealed, context);
}

export const encryptSecret = sealSecret;
export const decryptSecret = openSecret;
