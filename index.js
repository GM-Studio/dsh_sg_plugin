import { registerCommands } from './src/commands.js';
import { registerGuards } from './src/guards.js';
import { registerPrompt } from './src/prompt.js';
import { createRuntime } from './src/runtime.js';
import { registerSkills } from './src/skills.js';
import { registerTools } from './src/tools.js';

export const name = 'specgate';
export const inject = ['tools'];

export function apply(ctx, config = {}) {
  const runtime = createRuntime(ctx, config);

  ctx.effect(() => {
    const disposers = [];
    const track = (value) => {
      if (typeof value === 'function') disposers.push(value);
      else if (value && typeof value.dispose === 'function') {
        disposers.push(() => value.dispose());
      }
    };

    const safe = (label, register) => {
      try {
        track(register());
      } catch (error) {
        console.warn(`[specgate] failed to register ${label}:`, error);
      }
    };

    /**
     * Registrations behind an optional service must wait for that service.
     * Registering at apply time with `ctx.get()` silently drops commands,
     * skills, or prompt sections when the owning plugin loads later.
     */
    const use = (services, label, register) => {
      safe(label, () => {
        if (typeof ctx.inject === 'function') {
          return ctx.inject(services, (child) => register(child));
        }
        const available = services.every(
          (service) => typeof ctx.get === 'function' && ctx.get(service),
        );
        return available ? register(ctx) : undefined;
      });
    };

    safe('tools', () => registerTools(ctx, runtime));
    use(['commands'], 'commands', (child) => registerCommands(child, runtime));
    use(['systemPrompt'], 'prompt', (child) => registerPrompt(child, runtime));
    safe('guards', () => registerGuards(ctx, runtime));
    use(['skills'], 'skills', (child) => registerSkills(child, runtime));

    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch {
          // ignore teardown errors
        }
      }
    };
  });
}
