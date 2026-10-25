export const MAX_AUTOMATIC_RETRIES = 2;
export const RETRY_CATEGORIES = Object.freeze(['development', 'test', 'review']);

export function makeCheckpoint(state, label = state.phase) {
  return {
    id: `${state.changeId}:${state.version}`,
    phase: state.phase,
    version: state.version,
    label,
    recordedAt: new Date().toISOString(),
  };
}

export function countFailure(previous, category, error, totalFailures) {
  const failures = (previous?.failures ?? 0) + 1;
  return {
    category,
    failures,
    automaticRetries: Math.min(failures, MAX_AUTOMATIC_RETRIES),
    lastError: error,
    totalFailures: totalFailures ?? failures,
    retryAllowed: (totalFailures ?? failures) <= MAX_AUTOMATIC_RETRIES,
  };
}
