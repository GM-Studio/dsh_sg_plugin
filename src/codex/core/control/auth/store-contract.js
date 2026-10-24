// Authentication stores expose one serializable async transaction boundary.
// A normally returned denial commits its failure audit and rate-limit changes;
// throwing aborts the complete transaction. All returned records are detached.
export const AUTH_KINDS = Object.freeze([
  'users',
  'devices',
  'sessions',
  'challenges',
  'nonces',
  'rateLimits',
]);

export const AUTH_ROLES = Object.freeze(['owner', 'approver', 'viewer', 'customer_acceptor']);

export const AUTH_IDS = Object.freeze(Object.fromEntries(AUTH_KINDS.map((kind) => [kind, 'id'])));

export function authKind(kind) {
  if (!AUTH_KINDS.includes(kind)) throw new TypeError('Unknown authentication record kind');
  return kind;
}

export function authId(kind, record) {
  const value = record?.[AUTH_IDS[authKind(kind)]];
  if (typeof value !== 'string' || value.length < 1 || value.length > 128)
    throw new TypeError('Authentication record id is invalid');
  return value;
}

export const copyAuthRecord = (value) => structuredClone(value);
