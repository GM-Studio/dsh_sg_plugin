import { registerCommands } from './src/v3/commands.js';
import { registerGuards } from './src/v3/guards.js';
import { createRuntime } from './src/v3/runtime.js';
import { registerTools } from './src/v3/tools.js';
import { poolDisposeAll } from './src/v3/pool.js';

export const name = 'specgate';
export const inject = ['tools', 'agents'];

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
    safe('guards', () => registerGuards(ctx, runtime));

    return () => {
      poolDisposeAll().catch(() => {});
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
