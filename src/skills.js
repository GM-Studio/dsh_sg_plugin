import { adaptContent, listSkillAssets } from './assets.js';

export function registerSkills(ctx, runtime) {
  const skills =
    ctx.skills ||
    (typeof ctx.get === 'function' ? ctx.get('skills') : undefined);
  if (!skills) return () => {};

  const language = runtime?.global?.language || 'zh';
  const disposers = [];
  for (const skill of listSkillAssets(language)) {
    try {
      disposers.push(
        skills.register({
          name: skill.name,
          description: skill.description || `SpecGate skill ${skill.name}`,
          whenToUse: skill.whenToUse,
          content: adaptContent(skill.body, language),
          path: skill.file,
          source: 'dsh-plugin-specgate',
          resourceBase: { kind: 'directory', path: skill.dir },
          invocation: {
            modelInvocable: !skill.disableModelInvocation,
            userInvocable: skill.userInvocable,
          },
          provider: 'specgate',
        }),
      );
    } catch (error) {
      console.warn(`[specgate] failed to register skill ${skill.name}:`, error);
    }
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // ignore teardown errors
      }
    }
  };
}
