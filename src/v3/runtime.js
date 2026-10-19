import path from 'node:path';
import { load as loadState } from './state.js';
import { readConfig } from './change.js';

export function createRuntime(ctx, config = {}) {
  return new Runtime(ctx, config);
}

class Runtime {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config || {};
    this.lastCwd = this.config.root ? path.resolve(this.config.root) : process.cwd();
  }

  remember(cwd) {
    if (cwd) this.lastCwd = path.resolve(cwd);
    return this.lastCwd;
  }

  getCwd(agent) {
    try {
      const sessions = this.ctx.get('sessions');
      const workingDirectory = this.ctx.get('workingDirectory');
      if (agent && sessions && workingDirectory) {
        const session = sessions.get(agent.id);
        if (session) {
          const value = workingDirectory.get(session);
          if (value) return this.remember(value);
        }
      }
    } catch {
      // fall through to the last known cwd
    }
    return this.lastCwd;
  }

  project(agent) {
    const root = this.getCwd(agent);
    const loaded = loadState(root);
    return {
      root,
      state: loaded.ok ? loaded.state : null,
      stateError: loaded.ok ? null : loaded,
      config: readConfig(root),
    };
  }

  language(agent) {
    return this.config.language || this.project(agent).config?.language || 'zh';
  }

  service(name) {
    try {
      return typeof this.ctx.get === 'function' ? this.ctx.get(name) : undefined;
    } catch {
      return undefined;
    }
  }

  agentRunner() {
    return this.config.agentRunner || null;
  }
}
