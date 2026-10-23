// This provider is created only from the correlated native form response. It is
// scoped to safe initialization, never reusable as an H1 or H3 approval.
export function createNativeInitConsent({ response, identity, root, preset, policy }) {
  const confirmed =
    response?.action === 'accept' &&
    response.content?.confirm === true &&
    identity?.kind === 'user' &&
    typeof identity.id === 'string' &&
    typeof identity.source === 'string' &&
    ['保留已有文件，只补齐缺失文件', '在业务同名子目录中新建'].includes(policy);
  const binding = Object.freeze({
    root,
    preset,
    policy,
    actor: identity?.id,
    source: identity?.source,
  });
  return Object.freeze({
    async requestApproval(challenge) {
      const approved = Boolean(
        confirmed &&
        challenge.action === 'init' &&
        !challenge.gate &&
        challenge.root === binding.root &&
        challenge.preset === binding.preset &&
        challenge.strategy === 'keep-missing' &&
        Array.isArray(challenge.conflicts) &&
        challenge.conflicts.every((entry) => entry.decision === 'keep'),
      );
      return {
        approved,
        previewHash: challenge.previewHash,
        conflicts: approved
          ? challenge.conflicts.map((entry) => ({ path: entry.path, decision: 'keep' }))
          : [],
        receipt: {
          source: binding.source,
          actor: binding.actor,
          policy: binding.policy,
          root: binding.root,
          preset: binding.preset,
          confirmed,
        },
      };
    },
  });
}
