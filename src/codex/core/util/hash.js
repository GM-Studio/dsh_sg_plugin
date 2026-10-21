import crypto from 'node:crypto';

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/** Normalize text before hashing: CRLF to LF, trim trailing spaces, single final newline. */
export function norm(text) {
  const value = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+$/gm, '');
  return `${value.replace(/\n*$/, '')}\n`;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function digest(value) {
  const text = typeof value === 'string' ? norm(value) : canonicalJson(value);
  return `sha256:${sha256(text)}`;
}
