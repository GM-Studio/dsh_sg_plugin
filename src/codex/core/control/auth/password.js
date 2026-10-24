import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const DEFAULTS = Object.freeze({
  n: 16_384,
  r: 8,
  p: 1,
  keyLength: 32,
});
const LIMITS = Object.freeze({
  minN: 16_384,
  maxN: 262_144,
  minR: 1,
  maxR: 32,
  minP: 1,
  maxP: 4,
  minKeyLength: 16,
  maxKeyLength: 64,
  minSaltLength: 16,
  maxSaltLength: 64,
  maxMemoryBytes: 256 * 1024 * 1024,
  maxPasswordLength: 1024,
});
const HASH_PATTERN = /^\$scrypt\$n=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

function powerOfTwo(value) {
  return Number.isSafeInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function boundedParameters({ n, r, p, keyLength }) {
  return (
    powerOfTwo(n) &&
    n >= LIMITS.minN &&
    n <= LIMITS.maxN &&
    Number.isSafeInteger(r) &&
    r >= LIMITS.minR &&
    r <= LIMITS.maxR &&
    Number.isSafeInteger(p) &&
    p >= LIMITS.minP &&
    p <= LIMITS.maxP &&
    Number.isSafeInteger(keyLength) &&
    keyLength >= LIMITS.minKeyLength &&
    keyLength <= LIMITS.maxKeyLength &&
    128 * n * r <= LIMITS.maxMemoryBytes
  );
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length > 0 && decoded.toString('base64url') === value ? decoded : null;
}

function maximumMemory({ n, r, p }) {
  return Math.min(
    LIMITS.maxMemoryBytes,
    Math.max(64 * 1024 * 1024, 256 * n * r + 128 * p + 1024 * 1024),
  );
}

export function parsePasswordHash(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 1024) return false;
  const match = HASH_PATTERN.exec(encoded);
  if (!match) return false;
  const parameters = {
    n: Number(match[1]),
    r: Number(match[2]),
    p: Number(match[3]),
  };
  const salt = decodeBase64Url(match[4]);
  const hash = decodeBase64Url(match[5]);
  if (
    !boundedParameters({ ...parameters, keyLength: hash?.length ?? 0 }) ||
    !salt ||
    salt.length < LIMITS.minSaltLength ||
    salt.length > LIMITS.maxSaltLength
  )
    return false;
  return { ...parameters, salt, hash };
}

export async function hashPassword(password, options = {}) {
  if (
    typeof password !== 'string' ||
    password.length < 1 ||
    password.length > LIMITS.maxPasswordLength
  )
    throw new TypeError('Password must be a non-empty bounded string');
  const parameters = {
    n: options.n ?? DEFAULTS.n,
    r: options.r ?? DEFAULTS.r,
    p: options.p ?? DEFAULTS.p,
    keyLength: options.keyLength ?? DEFAULTS.keyLength,
  };
  if (!boundedParameters(parameters)) throw new TypeError('Password hash parameters are invalid');
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, parameters.keyLength, {
    N: parameters.n,
    r: parameters.r,
    p: parameters.p,
    maxmem: maximumMemory(parameters),
  });
  return [
    '$scrypt',
    `n=${parameters.n},r=${parameters.r},p=${parameters.p}`,
    salt.toString('base64url'),
    Buffer.from(derived).toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password, encoded, options = {}) {
  if (
    typeof password !== 'string' ||
    password.length < 1 ||
    password.length > LIMITS.maxPasswordLength
  )
    return false;
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  if (options.maxMemoryBytes !== undefined) {
    if (
      !Number.isSafeInteger(options.maxMemoryBytes) ||
      options.maxMemoryBytes < 1024 * 1024 ||
      options.maxMemoryBytes > LIMITS.maxMemoryBytes
    )
      return false;
    if (128 * parsed.n * parsed.r > options.maxMemoryBytes) return false;
  }
  try {
    const derived = Buffer.from(
      await scrypt(password, parsed.salt, parsed.hash.length, {
        N: parsed.n,
        r: parsed.r,
        p: parsed.p,
        maxmem: options.maxMemoryBytes ?? maximumMemory({ n: parsed.n, r: parsed.r, p: parsed.p }),
      }),
    );
    return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

export const createPasswordHash = hashPassword;
export const checkPassword = verifyPassword;
