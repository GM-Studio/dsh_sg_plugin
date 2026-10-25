import { createHash } from 'node:crypto';

// The storage layer additionally checks an external monotonic audit anchor.
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Only JSON values are accepted');
}

export const hashValue = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

export function createEvent({ state, type, payload, previousHash, timestamp }) {
  const body = {
    schemaVersion: 1,
    sequence: state.version,
    timestamp: timestamp ?? new Date().toISOString(),
    type,
    changeId: state.changeId,
    previousHash,
    payload,
    state,
  };
  return { ...body, hash: hashValue(body) };
}

export function verifyEventChain(content) {
  const invalid = (message) => ({ ok: false, code: 'AUDIT_CORRUPT', message });
  if (typeof content !== 'string') return invalid('Event history must be text');
  if (!content) return { ok: true, events: [], headHash: null };
  if (!content.endsWith('\n')) return invalid('Event history ends with an incomplete record');
  const lines = content.slice(0, -1).split('\n');
  const events = [];
  let previousHash = null;
  for (let index = 0; index < lines.length; index++) {
    try {
      const event = JSON.parse(lines[index]);
      if (!event || typeof event !== 'object' || Array.isArray(event))
        return invalid(`Invalid event at sequence ${index + 1}`);
      const { hash, ...body } = event;
      if (
        event.schemaVersion !== 1 ||
        event.sequence !== index + 1 ||
        event.state?.version !== event.sequence ||
        event.state?.schemaVersion !== 1 ||
        event.changeId !== event.state?.changeId ||
        (typeof event.changeId !== 'string' && event.changeId !== null) ||
        typeof event.type !== 'string' ||
        !Number.isFinite(Date.parse(event.timestamp)) ||
        event.previousHash !== previousHash ||
        !/^[a-f0-9]{64}$/.test(hash) ||
        hashValue(body) !== hash
      )
        return invalid(`Event integrity check failed at sequence ${index + 1}`);
      events.push(event);
      previousHash = hash;
    } catch {
      return invalid(`Unreadable event at sequence ${index + 1}`);
    }
  }
  return { ok: true, events, headHash: previousHash };
}
