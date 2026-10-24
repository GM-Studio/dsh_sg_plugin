export const AUTH_ACTION_POLICIES = Object.freeze({
  pause: 'session',
  resume: 'step-up',
  retry: 'step-up',
  request_changes: 'step-up',
  approve: 'step-up',
  cancel: 'step-up',
  accept_delivery: 'step-up',
  'device.revoke': 'step-up',
});

const authLevels = new Set(['session', 'step-up']);

export function requiredAuth(action) {
  if (typeof action !== 'string' || !Object.hasOwn(AUTH_ACTION_POLICIES, action)) return null;
  return AUTH_ACTION_POLICIES[action];
}

export function mutationAuth(action, resourceId) {
  const authLevel = requiredAuth(action);
  if (!authLevel || !authLevels.has(authLevel)) return null;
  return {
    action,
    resourceId,
    authLevel,
    stepUpRequired: authLevel === 'step-up',
  };
}

export const mutationAuthRequirement = mutationAuth;
export const describeMutation = mutationAuth;
